# Use existing public setup
curl -o build/final.ptau https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau

npx snarkjs plonk setup build/withdraw.r1cs build/final.ptau build/circuit_final.zkey

npx snarkjs zkey export verificationkey build/circuit_final.zkey build/verification_key.json

npx snarkjs zkey export solidityverifier build/circuit_final.zkey build/Verifier.sol
# Fix solidity type. Can remove after https://github.com/iden3/snarkjs/pull/101/ is merged
cd build/ && sed 's/uint16\ constant\ n/uint32\ constant\ n/g' Verifier.sol > tmp.txt && mv tmp.txt Verifier.sol
