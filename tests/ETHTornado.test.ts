import { assert } from "chai";
import { ETHTornado__factory, Verifier__factory, ETHTornado } from "../types/"

import { ethers } from "hardhat"
import { ContractFactory, BigNumber, BigNumberish } from "ethers"
// @ts-ignore
import { createCode, generateABI } from "circomlib/src/poseidon_gencontract";
// @ts-ignore
import poseidon from "circomlib/src/poseidon";
import { MerkleTree, Hasher } from "../src/merkleTree"
// @ts-ignore
import { groth16 } from "snarkjs"
import path from "path";

const ETH_AMOUNT = ethers.utils.parseEther("1")
const HEIGHT = 20

function poseidonHash(inputs: BigNumberish[]): string {
    const hash = poseidon(inputs.map(x => BigNumber.from(x).toBigInt()))
    const bytes32 = ethers.utils.hexZeroPad(BigNumber.from(hash).toHexString(), 32)
    return bytes32
}

class PoseidonHasher implements Hasher {
    hash(left: string, right: string) {
        return poseidonHash([left, right])
    }
}

class Deposit {
    private constructor(public nullifier: Uint8Array, public secret: Uint8Array) { }
    static new() {
        const nullifier = ethers.utils.randomBytes(31)
        const secret = ethers.utils.randomBytes(31)
        return new this(nullifier, secret)
    }
    get commitment() {
        return poseidonHash([this.nullifier, this.secret])
    }

    get nullifierHash() {
        return poseidonHash([this.nullifier])
    }
}

function getPoseidonFactory(nInputs: number) {
    const bytecode = createCode(nInputs)
    const abiJson = generateABI(nInputs)
    const abi = new ethers.utils.Interface(abiJson)
    return new ContractFactory(abi, bytecode)
}

describe("ETHTornado", function () {
    let tornado: ETHTornado;
    beforeEach(async function () {
        const [signer] = await ethers.getSigners();
        const verifier = await new Verifier__factory(signer).deploy()
        const poseidon = await getPoseidonFactory(2).connect(signer).deploy()
        tornado = await new ETHTornado__factory(signer).deploy(verifier.address, ETH_AMOUNT, HEIGHT, poseidon.address);
    })
    it("deposit and withdraw", async function () {
        const deposit = Deposit.new()
        const tx = await tornado.deposit(deposit.commitment, { value: ETH_AMOUNT })
        const receipt = await tx.wait()
        const events = await tornado.queryFilter(tornado.filters.Deposit(), receipt.blockHash)
        assert.equal(events[0].args.commitment, deposit.commitment)

        const tree = new MerkleTree(HEIGHT, "test", new PoseidonHasher())
        assert.equal(await tree.root(), await tornado.roots(0))
        await tree.insert(deposit.commitment)
        assert.equal(tree.totalElements, await tornado.nextIndex())
        assert.equal(await tree.root(), await tornado.roots(1))

        const nullifierHash = deposit.nullifierHash
        const recipient = ethers.utils.hexlify(ethers.utils.randomBytes(20))
        const relayer = ethers.utils.hexlify(ethers.utils.randomBytes(20))
        const fee = 0
        const refund = 0

        const { root, path_elements, path_index } = await tree.path(0)

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
            secret: BigNumber.from(deposit.secret).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        }

        const wasmPath = path.join(__dirname, "../build/withdraw.wasm")
        const zkeyPath = path.join(__dirname, "../build/circuit_final.zkey")

        const { proof } = await groth16.fullProve(witness, wasmPath, zkeyPath);

        const a: [BigNumberish, BigNumberish] = [proof.pi_a[0], proof.pi_a[1]]
        const b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]] = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]]
        const c: [BigNumberish, BigNumberish] = [proof.pi_c[0], proof.pi_c[1]]

        await tornado.withdraw({ a, b, c }, root, nullifierHash, recipient, relayer, fee, refund)
    })
})
