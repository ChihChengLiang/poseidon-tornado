import { assert } from "chai";
import {
    ETHTornado__factory,
    PlonkVerifier__factory,
    ETHTornado,
} from "../types/";

import { ethers } from "hardhat";
import { ContractFactory, BigNumber, BigNumberish } from "ethers";
// @ts-ignore
import { createCode, generateABI } from "circomlib/src/poseidon_gencontract";
// @ts-ignore
import poseidon from "circomlib/src/poseidon";
import { MerkleTree, Hasher } from "../src/merkleTree";
// @ts-ignore
import { plonk } from "snarkjs";
import path from "path";

const ETH_AMOUNT = ethers.utils.parseEther("1");
const HEIGHT = 20;

function poseidonHash(inputs: BigNumberish[]): string {
    const hash = poseidon(inputs.map((x) => BigNumber.from(x).toBigInt()));
    const bytes32 = ethers.utils.hexZeroPad(
        BigNumber.from(hash).toHexString(),
        32
    );
    return bytes32;
}

async function getSerializedProof(proof: any): Promise<string> {
    const dummyPublicInput: string[] = [];
    const string = await plonk.exportSolidityCallData(proof, dummyPublicInput);
    const proofHexPart = string.split(",")[0];
    return proofHexPart;
}

class PoseidonHasher implements Hasher {
    hash(left: string, right: string) {
        return poseidonHash([left, right]);
    }
}

class Deposit {
    private constructor(
        public readonly nullifier: Uint8Array,
        public leafIndex?: number
    ) {}
    static new() {
        const nullifier = ethers.utils.randomBytes(15);
        return new this(nullifier);
    }
    get commitment() {
        return poseidonHash([this.nullifier, 0]);
    }

    get nullifierHash() {
        if (!this.leafIndex && this.leafIndex !== 0)
            throw Error("leafIndex is unset yet");
        return poseidonHash([this.nullifier, 1, this.leafIndex]);
    }
}

function getPoseidonFactory(nInputs: number) {
    const bytecode = createCode(nInputs);
    const abiJson = generateABI(nInputs);
    const abi = new ethers.utils.Interface(abiJson);
    return new ContractFactory(abi, bytecode);
}

describe("ETHTornado", function () {
    let tornado: ETHTornado;
    beforeEach(async function () {
        const [signer] = await ethers.getSigners();
        const poseidon = await getPoseidonFactory(2).connect(signer).deploy();
        tornado = await new ETHTornado__factory(signer).deploy(
            ETH_AMOUNT,
            HEIGHT,
            poseidon.address
        );
    });
    it("deposit and withdraw", async function () {
        const [userOldSigner, relayerSigner, userNewSigner] =
            await ethers.getSigners();
        const deposit = Deposit.new();
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

        const tree = new MerkleTree(HEIGHT, "test", new PoseidonHasher());
        assert.equal(await tree.root(), await tornado.roots(0));
        await tree.insert(deposit.commitment);
        assert.equal(tree.totalElements, await tornado.nextIndex());
        assert.equal(await tree.root(), await tornado.roots(1));

        const nullifierHash = deposit.nullifierHash;
        const recipient = await userNewSigner.getAddress();
        const relayer = await relayerSigner.getAddress();
        const fee = 0;
        const refund = 0;

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
            refund,
            // Private
            nullifier: BigNumber.from(deposit.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        };

        const wasmPath = path.join(__dirname, "../build/withdraw.wasm");
        const zkeyPath = path.join(__dirname, "../build/circuit_final.zkey");

        const { proof } = await plonk.fullProve(witness, wasmPath, zkeyPath);
        const proofHex = await getSerializedProof(proof);

        const txWithdraw = await tornado
            .connect(relayerSigner)
            .withdraw(
                root,
                nullifierHash,
                recipient,
                relayer,
                fee,
                refund,
                proofHex
            );
        const receiptWithdraw = await txWithdraw.wait();
        console.log("Withdraw gas cost", receiptWithdraw.gasUsed.toNumber());
    }).timeout(500000);
});
