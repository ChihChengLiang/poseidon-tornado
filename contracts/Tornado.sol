// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import "./MerkleTreeWithHistory.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Verifier.sol";

abstract contract Tornado is
    MerkleTreeWithHistory,
    ReentrancyGuard,
    PlonkVerifier
{
    uint256 public immutable denomination;

    mapping(bytes32 => bool) public nullifierHashes;

    event Deposit(
        bytes32 indexed commitment,
        uint32 leafIndex,
        uint256 timestamp
    );
    event Withdrawal(
        address to,
        bytes32 nullifierHash,
        address indexed relayer,
        uint256 fee
    );

    /**
    @param _denomination transfer amount for each deposit
    @param _merkleTreeHeight the height of deposits' Merkle Tree
    */
    constructor(
        uint256 _denomination,
        uint32 _merkleTreeHeight,
        address _hasher
    ) MerkleTreeWithHistory(_merkleTreeHeight, _hasher) {
        require(_denomination > 0, "denomination should be greater than 0");

        denomination = _denomination;
    }

    /**
    @dev Deposit funds into the contract. The caller must send (for ETH) or approve (for ERC20) value equal to or `denomination` of this instance.
    @param _commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
    function deposit(bytes32 _commitment) external payable nonReentrant {
        uint32 insertedIndex = _insert(_commitment);
        _processDeposit();

        emit Deposit(_commitment, insertedIndex, block.timestamp);
    }

    /** @dev this function is defined in a child contract */
    function _processDeposit() internal virtual;

    /**
    @dev Withdraw a deposit from the contract. `proof` is a zkSNARK proof data, and input is an array of circuit public inputs
    `input` array consists of:
      - merkle root of all deposits in the contract
      - hash of unique deposit nullifier to prevent double spends
      - the recipient of funds
      - optional fee that goes to the transaction sender (usually a relay)
    */
    function withdraw(
        bytes32 _root,
        bytes32 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund,
        bytes calldata _proof
    ) external payable nonReentrant {
        require(_fee <= denomination, "Fee exceeds transfer value");
        require(
            !nullifierHashes[_nullifierHash],
            "The note has been already spent"
        );
        require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one
        uint256[] memory pubSignals = new uint256[](6);
        pubSignals[0] = uint256(_root);
        pubSignals[1] = uint256(_nullifierHash);
        pubSignals[2] = uint256(_recipient);
        pubSignals[3] = uint256(_relayer);
        pubSignals[4] = _fee;
        pubSignals[5] = _refund;
        require(verifyProof(_proof, pubSignals), "Invalid withdraw proof");

        nullifierHashes[_nullifierHash] = true;
        _processWithdraw(_recipient, _relayer, _fee, _refund);
        emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);
    }

    /** @dev this function is defined in a child contract */
    function _processWithdraw(
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund
    ) internal virtual;

    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return nullifierHashes[_nullifierHash];
    }

    function isSpentArray(bytes32[] calldata _nullifierHashes)
        external
        view
        returns (bool[] memory spent)
    {
        spent = new bool[](_nullifierHashes.length);
        for (uint256 i = 0; i < _nullifierHashes.length; i++) {
            if (isSpent(_nullifierHashes[i])) {
                spent[i] = true;
            }
        }
    }
}
