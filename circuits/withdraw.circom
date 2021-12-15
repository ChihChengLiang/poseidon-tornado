include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "merkleTree.circom";

template Withdraw(levels) {
    signal input root;
    signal input nullifierHash;
    signal input recipient; // not taking part in any computations
    signal input relayer;  // not taking part in any computations
    signal input fee;      // not taking part in any computations
    signal private input nullifier;
    signal private input pathElements[levels];
    signal private input pathIndices[levels];

    component leafIndexNum = Bits2Num(levels);
    for (var i = 0; i < levels; i++) {
        leafIndexNum.in[i] <== pathIndices[i];
    }

    component nullifierHasher = Poseidon(3);
    // ### Something is missing here
    // complete the input to the Poseidon hash function
    // example:
    //  nullifierHasher.inputs[0] <== ?????;
    //  nullifierHasher.inputs[1] <== ?????;
    nullifierHasher.out === nullifierHash;

    component commitmentHasher = Poseidon(2);
    // ### Something is missing here too
    // complete the input to the Poseidon hash function

    component tree = MerkleTreeChecker(levels);
    // ### Uncomment the following lines and complete the input variable
    // tree.leaf <== ????;
    // tree.root <== ????;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Add hidden signals to make sure that tampering with recipient or fee will invalidate the snark proof
    // Most likely it is not required, but it's better to stay on the safe side and it only takes 2 constraints
    // Squares are used to prevent optimizer from removing those constraints
    signal recipientSquare;
    signal feeSquare;
    signal relayerSquare;
    recipientSquare <== recipient * recipient;
    feeSquare <== fee * fee;
    relayerSquare <== relayer * relayer;
}

component main = Withdraw(20);
