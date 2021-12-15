// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import "./Tornado.sol";

contract ETHTornado is Tornado {
    constructor(
        IVerifier _verifier,
        uint256 _denomination,
        uint32 _merkleTreeHeight,
        address _hasher
    ) Tornado(_verifier, _denomination, _merkleTreeHeight, _hasher) {}

    function _processDeposit() internal override {
        require(
            msg.value == denomination,
            "Please send `mixDenomination` ETH along with transaction"
        );
    }

    function _processWithdraw(
        address payable _recipient,
        address payable _relayer,
        uint256 _fee
    ) internal override {
        // sanity checks
        require(
            msg.value == 0,
            "Message value is supposed to be zero for ETH instance"
        );

        (bool success, ) = _recipient.call{ value: (denomination - _fee) }("");
        require(success, "payment to _recipient did not go thru");
        if (_fee > 0) {
            (success, ) = _relayer.call{ value: _fee }("");
            require(success, "payment to _relayer did not go thru");
        }
    }
}
