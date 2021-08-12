
# Lame untrusted setup
npx snarkjs powersoftau new bn128 14 build/pot12_0000.ptau -v
npx snarkjs powersoftau contribute build/pot12_0000.ptau build/pot12_0001.ptau --name="First contribution" -v -e="some random text"
npx snarkjs powersoftau prepare phase2 build/pot12_0001.ptau build/pot12_final.ptau -v


npx snarkjs zkey new build/withdraw.r1cs build/pot12_final.ptau build/circuit_final.zkey

npx snarkjs zkey export verificationkey build/circuit_final.zkey build/verification_key.json


npx snarkjs zkey export solidityverifier build/circuit_final.zkey build/Verifier.sol
# Fix solidity version
sed -i '.sol' 's/0.6.11/0.7.3/' build/Verifier.sol
