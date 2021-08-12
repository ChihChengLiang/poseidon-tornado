import { assert } from "chai";
import { ETHTornado__factory, Verifier__factory, ETHTornado } from "../types/"

import { ethers } from "hardhat"
import { ContractFactory, BigNumber } from "ethers"
// @ts-ignore
import { createCode, generateABI } from "circomlib/src/poseidon_gencontract";

const ETH_AMOUNT = ethers.utils.parseEther("1")
const HEIGHT = 20


function getPoseidonFactory(nInputs: number) {
    const bytecode = createCode(nInputs)
    const abiJson = generateABI(nInputs)
    const abi = new ethers.utils.Interface(abiJson)
    return new ContractFactory(abi, bytecode)
}

function toBytes32(value: number) {
    return ethers.utils.hexZeroPad(BigNumber.from(value).toHexString(), 32)
}

describe("ETHTornado", function () {
    let tornado: ETHTornado;
    beforeEach(async function () {
        const [signer] = await ethers.getSigners();
        const verifier = await new Verifier__factory(signer).deploy()
        const poseidon = await getPoseidonFactory(2).connect(signer).deploy()
        tornado = await new ETHTornado__factory(signer).deploy(verifier.address, ETH_AMOUNT, HEIGHT, poseidon.address);
    })
    it("deposit", async function () {
        const commitment = toBytes32(42)
        const tx = await tornado.deposit(commitment, { value: ETH_AMOUNT })
        const receipt = await tx.wait()
        const events = await tornado.queryFilter(tornado.filters.Deposit(), receipt.blockHash)
        assert.equal(events[0].args.commitment, commitment)
    })
})