import { assert, expect } from "chai";
import { ETHTornado__factory, Verifier__factory, ETHTornado } from "../types/";

import { ethers } from "hardhat";
import { Contract, ContractFactory, BigNumber, BigNumberish } from "ethers";
// @ts-ignore
import { poseidonContract, buildPoseidon } from "circomlibjs";
// @ts-ignore
import { MerkleTree, Hasher } from "../src/merkleTree";
// @ts-ignore
import { groth16 } from "snarkjs";
import path from "path";

import { readFileSync } from "fs";

const ETH_AMOUNT = ethers.utils.parseEther("1");
const HEIGHT = 20;

function poseidonHash(poseidon: any, inputs: BigNumberish[]): string {
    const hash = poseidon(inputs.map((x) => BigNumber.from(x).toBigInt()));
    const hashStr = poseidon.F.toString(hash);
    const hashHex = BigNumber.from(hashStr).toHexString();

    return hashHex;
}

class PoseidonHasher implements Hasher {
    poseidon: any;

    constructor(poseidon: any) {
        this.poseidon = poseidon;
    }

    hash(left: string, right: string) {
        return poseidonHash(this.poseidon, [left, right]);
    }
}

class Deposit {
    private constructor(
        public readonly nullifier: Uint8Array,
        public poseidon: any,
        public leafIndex?: number
    ) {
        this.poseidon = poseidon;
    }
    static new(poseidon: any) {
        const nullifier = ethers.utils.randomBytes(15);
        return new this(nullifier, poseidon);
    }
    get commitment() {
        return poseidonHash(this.poseidon, [this.nullifier, 0]);
    }

    get nullifierHash() {
        if (!this.leafIndex && this.leafIndex !== 0)
            throw Error("leafIndex is unset yet");
        return poseidonHash(this.poseidon, [this.nullifier, 1, this.leafIndex]);
    }
}

function getPoseidonFactory(nInputs: number) {
    const bytecode = poseidonContract.createCode(nInputs);
    const abiJson = poseidonContract.generateABI(nInputs);
    const abi = new ethers.utils.Interface(abiJson);
    return new ContractFactory(abi, bytecode);
}

interface Proof {
    a: [BigNumberish, BigNumberish];
    b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]];
    c: [BigNumberish, BigNumberish];
}

function parseProof(proof: any): Proof {
    return {
        a: [proof.pi_a[0], proof.pi_a[1]],
        b: [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]],
        ],
        c: [proof.pi_c[0], proof.pi_c[1]],
    };
}

describe("ETHTornado", function () {
    let tornado: ETHTornado;
    let poseidon: any;
    let poseidonContract: Contract;

    before(async () => {
        poseidon = await buildPoseidon();
    });

    beforeEach(async function () {
        const [signer] = await ethers.getSigners();
        const verifier = await new Verifier__factory(signer).deploy();
        poseidonContract = await getPoseidonFactory(2).connect(signer).deploy();
        tornado = await new ETHTornado__factory(signer).deploy(
            verifier.address,
            ETH_AMOUNT,
            HEIGHT,
            poseidonContract.address
        );
    });

    it("generates same poseidon hash", async function () {
        const res = await poseidonContract["poseidon(uint256[2])"]([1, 2]);
        const res2 = poseidon([1, 2]);

        assert.equal(res.toString(), poseidon.F.toString(res2));
    }).timeout(500000);

    it("deposit and withdraw", async function () {
        const [userOldSigner, relayerSigner, userNewSigner] =
            await ethers.getSigners();
        const deposit = Deposit.new(poseidon);

        const tx = await tornado
            .connect(userOldSigner)
            .deposit(deposit.commitment, { value: ETH_AMOUNT });
        const receipt = await tx.wait();
        const events = await tornado.queryFilter(
            tornado.filters.Deposit(),
            receipt.blockHash
        );
        assert.equal(events[0].args.commitment, deposit.commitment);
        console.log("Deposit gas cost", receipt.gasUsed.toNumber());
        deposit.leafIndex = events[0].args.leafIndex;

        const tree = new MerkleTree(
            HEIGHT,
            "test",
            new PoseidonHasher(poseidon)
        );
        assert.equal(await tree.root(), await tornado.roots(0));
        await tree.insert(deposit.commitment);
        assert.equal(tree.totalElements, await tornado.nextIndex());
        assert.equal(await tree.root(), await tornado.roots(1));

        const nullifierHash = deposit.nullifierHash;
        const recipient = await userNewSigner.getAddress();
        const relayer = await relayerSigner.getAddress();
        const fee = 0;

        const { root, path_elements, path_index } = await tree.path(
            deposit.leafIndex
        );

        const witness = {
            // Public
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            nullifier: BigNumber.from(deposit.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        };

        const wasmPath = path.join(
            __dirname,
            "../build/withdraw_js/withdraw.wasm"
        );
        const zkeyPath = path.join(__dirname, "../build/circuit_final.zkey");

        // Use generated witness_calculator and groth16.prove instead of groth.fullProve
        //const { proof } = await groth16.fullProve(witness, wasmPath, zkeyPath);
        const wc = require("../build/withdraw_js/witness_calculator");
        const buffer = readFileSync(wasmPath);
        const witnessCalculator = await wc(buffer);
        const witnessBuffer = await witnessCalculator.calculateWTNSBin(
            witness,
            0
        );
        const { proof, _ } = await groth16.prove(zkeyPath, witnessBuffer);

        const solProof = parseProof(proof);

        const txWithdraw = await tornado
            .connect(relayerSigner)
            .withdraw(solProof, root, nullifierHash, recipient, relayer, fee);
        const receiptWithdraw = await txWithdraw.wait();
        console.log("Withdraw gas cost", receiptWithdraw.gasUsed.toNumber());
    }).timeout(500000);

    it("prevent a user withdrawing twice", async function () {
        const [userOldSigner, relayerSigner, userNewSigner] =
            await ethers.getSigners();
        const deposit = Deposit.new(poseidon);
        const tx = await tornado
            .connect(userOldSigner)
            .deposit(deposit.commitment, { value: ETH_AMOUNT });
        const receipt = await tx.wait();
        const events = await tornado.queryFilter(
            tornado.filters.Deposit(),
            receipt.blockHash
        );
        deposit.leafIndex = events[0].args.leafIndex;

        const tree = new MerkleTree(
            HEIGHT,
            "test",
            new PoseidonHasher(poseidon)
        );
        await tree.insert(deposit.commitment);

        const nullifierHash = deposit.nullifierHash;
        const recipient = await userNewSigner.getAddress();
        const relayer = await relayerSigner.getAddress();
        const fee = 0;

        const { root, path_elements, path_index } = await tree.path(
            deposit.leafIndex
        );

        const witness = {
            // Public
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            nullifier: BigNumber.from(deposit.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        };

        const wasmPath = path.join(
            __dirname,
            "../build/withdraw_js/withdraw.wasm"
        );
        const zkeyPath = path.join(__dirname, "../build/circuit_final.zkey");

        const wc = require("../build/withdraw_js/witness_calculator");
        const buffer = readFileSync(wasmPath);
        const witnessCalculator = await wc(buffer);
        const witnessBuffer = await witnessCalculator.calculateWTNSBin(
            witness,
            0
        );
        const { proof, _ } = await groth16.prove(zkeyPath, witnessBuffer);

        const solProof = parseProof(proof);

        // First withdraw
        await tornado
            .connect(relayerSigner)
            .withdraw(solProof, root, nullifierHash, recipient, relayer, fee);

        // Second withdraw
        await tornado
            .connect(relayerSigner)
            .withdraw(solProof, root, nullifierHash, recipient, relayer, fee)
            .then(
                () => {
                    assert.fail("Expect tx to fail");
                },
                (error) => {
                    expect(error.message).to.have.string(
                        "The note has been already spent"
                    );
                }
            );
    }).timeout(500000);
    it("prevent a user withdrawing from a non-existent root", async function () {
        const [honestUser, relayerSigner, attacker] = await ethers.getSigners();

        // An honest user makes a deposit
        // the point here is just to top up some balance in the tornado contract
        const depositHonest = Deposit.new(poseidon);
        const tx = await tornado
            .connect(honestUser)
            .deposit(depositHonest.commitment, { value: ETH_AMOUNT });
        const receipt = await tx.wait();
        const events = await tornado.queryFilter(
            tornado.filters.Deposit(),
            receipt.blockHash
        );
        depositHonest.leafIndex = events[0].args.leafIndex;

        // The attacker never made a deposit on chain
        const depositAttacker = Deposit.new(poseidon);
        depositAttacker.leafIndex = 1;

        // The attacker constructed a tree which includes their deposit
        const tree = new MerkleTree(
            HEIGHT,
            "test",
            new PoseidonHasher(poseidon)
        );
        await tree.insert(depositHonest.commitment);
        await tree.insert(depositAttacker.commitment);

        const nullifierHash = depositAttacker.nullifierHash;
        const recipient = await attacker.getAddress();
        const relayer = await relayerSigner.getAddress();
        const fee = 0;

        // Attacker construct the proof
        const { root, path_elements, path_index } = await tree.path(
            depositAttacker.leafIndex
        );

        const witness = {
            // Public
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            nullifier: BigNumber.from(depositAttacker.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        };

        const wasmPath = path.join(
            __dirname,
            "../build/withdraw_js/withdraw.wasm"
        );
        const zkeyPath = path.join(__dirname, "../build/circuit_final.zkey");

        const wc = require("../build/withdraw_js/witness_calculator");
        const buffer = readFileSync(wasmPath);
        const witnessCalculator = await wc(buffer);
        const witnessBuffer = await witnessCalculator.calculateWTNSBin(
            witness,
            0
        );
        const { proof, _ } = await groth16.prove(zkeyPath, witnessBuffer);

        const solProof = parseProof(proof);

        await tornado
            .connect(relayerSigner)
            .withdraw(solProof, root, nullifierHash, recipient, relayer, fee)
            .then(
                () => {
                    assert.fail("Expect tx to fail");
                },
                (error) => {
                    expect(error.message).to.have.string(
                        "Cannot find your merkle root"
                    );
                }
            );
    }).timeout(500000);
});
