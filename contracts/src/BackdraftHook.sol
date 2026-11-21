// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBackdraft {
    function burn(address payable beneficiary) external returns (uint256 jobGas, uint256 units, uint256 bounty);
}

/// @title BackdraftHook
/// @notice Inherit this and add `recycle` to a function: whatever gas the caller
/// left unused is spent on Backdraft's job queue when the function finishes, and
/// the bounty goes to the caller. The caller your application sees does not change.
///
/// The hook can never make your function fail: it is skipped when too little gas
/// is left to be worth it, and any error inside Backdraft is swallowed.
abstract contract BackdraftHook {
    IBackdraft public immutable BACKDRAFT;
    /// @dev Below this there is nothing worth recycling, and not enough to do it safely.
    uint256 internal constant MIN_LEFTOVER = 150_000;

    constructor(IBackdraft backdraft) {
        BACKDRAFT = backdraft;
    }

    /// @notice Bounty goes to whoever called the function.
    modifier recycle() {
        _;
        _recycleTo(payable(msg.sender));
    }

    /// @notice Bounty goes to an address the application chooses, e.g. its treasury.
    modifier recycleTo(address payable beneficiary) {
        _;
        _recycleTo(beneficiary);
    }

    function _recycleTo(address payable beneficiary) private {
        if (gasleft() > MIN_LEFTOVER) {
            try BACKDRAFT.burn(beneficiary) {} catch {}
        }
    }
}

/// @title HookedApp
/// @notice An application that integrates Backdraft with one word: `recycle`.
contract HookedApp is BackdraftHook {
    bytes32 public digest;
    uint256 public calls;
    address public lastCaller;

    event Crunched(address indexed caller, uint256 n);

    constructor(IBackdraft backdraft) BackdraftHook(backdraft) {}

    function crunch(uint256 n) external recycle returns (bytes32 h) {
        h = digest;
        uint256 rounds = n * 24;
        for (uint256 i; i < rounds; ++i) {
            h = keccak256(abi.encode(h, i));
        }
        digest = h;
        lastCaller = msg.sender;
        unchecked {
            ++calls;
        }
        emit Crunched(msg.sender, n);
    }
}
