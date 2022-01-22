# Tornado Cash but with Poseidon Hash

[![Node.js CI](https://github.com/ChihChengLiang/poseidon-tornado/actions/workflows/node.js.yml/badge.svg)](https://github.com/ChihChengLiang/poseidon-tornado/actions/workflows/node.js.yml)

WARNING: This project is unaudited, please don't use in the production.

We copy and modify the [Tornado Cash](https://github.com/tornadocash/tornado-core) and implement the optimization suggestions in the a Tornado [audit report](https://tornado.cash/audits/TornadoCash_cryptographic_review_ABDK.pdf).

Specifically we

- Use Poseidon Hash for tree hashing, nullifier hashing, and commitment construction
- Use the following suggested construction to allow nullifier reuse

```
commitment = PoseidonHash(nullifier, 0)
nullifierHash = PoseidonHash(nullifier, 1, leafIndex)
```

## Build

First, you must have the Circom 2 compiler installed. See [installation
instructions](https://docs.circom.io/getting-started/installation/) for details.

The build step compiles the circuit, does untrusted setup, generates verifier contract, and compiles all the contracts. It could take a while at the setup step.

```sh
npm install
npm run build
```

```sh
npm run test
```

## Benchmark

```sh
npm run info
```
