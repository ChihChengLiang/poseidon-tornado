import { assert } from "chai";
import { ETHTornado__factory, Verifier__factory, ETHTornado } from "../types/"

import { ethers } from "hardhat"
import { ContractFactory, BigNumber, BigNumberish } from "ethers"
// @ts-ignore
import { createCode, generateABI } from "circomlib/src/poseidon_gencontract";
// @ts-ignore
import poseidon from "circomlib/src/poseidon";
import { MerkleTree, Hasher } from "../src/merkleTree"

const ETH_AMOUNT = ethers.utils.parseEther("1")
const HEIGHT = 20

function hash2(input1: BigNumberish, input2: BigNumberish): string {
    const hash = poseidon([input1, input2].map(x => BigNumber.from(x).toBigInt()))
    const bytes32 = ethers.utils.hexZeroPad(BigNumber.from(hash).toHexString(), 32)
    return bytes32
}

class PoseidonHasher implements Hasher {
    hash(left: string, right: string) {
        return hash2(left, right)
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
        return hash2(this.nullifier, this.secret)
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

    })
})
