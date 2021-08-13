# Tornado Cash but with Poseidon Hash

We copy and modify the Tornado Cash and implement the optimization suggestions in the a Tornado [audit report](https://tornado.cash/audits/TornadoCash_cryptographic_review_ABDK.pdf).

Specifically we

- Use Poseidon Hash for tree hashing, nullifier hashing, and commitment construction
- Use the following suggested construction to allow nullifier reuse

```
commitment = PoseidonHash(nullifier, 0)
nullifierHash = PoseidonHash(nullifier, 1, leafIndex)
```

## Build

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