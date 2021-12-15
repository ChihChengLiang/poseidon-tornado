# Use existing public phase 1 setup
curl -o build/phase1_final.ptau https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau

# Untrusted phase 2
npx snarkjs powersoftau prepare phase2 build/phase1_final.ptau build/phase2_final.ptau -v

npx snarkjs zkey new build/withdraw.r1cs build/phase2_final.ptau build/circuit_final.zkey

npx snarkjs zkey export verificationkey build/circuit_final.zkey build/verification_key.json


npx snarkjs zkey export solidityverifier build/circuit_final.zkey build/Verifier.sol
# Fix solidity version (and want the command to work on both linux and mac)
cd build/ && sed 's/0\.6\.11/0\.7\.3/g' Verifier.sol > tmp.txt && mv tmp.txt Verifier.sol
