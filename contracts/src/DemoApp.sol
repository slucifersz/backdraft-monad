// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAfterburnerJob} from "./Afterburner.sol";

/// @title DemoApp
/// @notice Stands in for an ordinary application. It knows nothing about
/// Afterburner. `crunch(n)` does an amount of work that grows with `n`, so the
/// gas it needs is a straight line in `n` — the relationship GasModel learns.
contract DemoApp {
    uint256 internal constant ROUNDS_PER_UNIT = 24;

    bytes32 public digest;
    uint256 public calls;

    event Crunched(address indexed caller, uint256 n, bytes32 digest);

    function crunch(uint256 n) external returns (bytes32 h) {
        h = digest;
        uint256 rounds = n * ROUNDS_PER_UNIT;
        for (uint256 i; i < rounds; ++i) {
            h = keccak256(abi.encode(h, i));
        }
        digest = h;
        unchecked {
            ++calls;
        }
        emit Crunched(msg.sender, n, h);
    }

    /// @notice Always fails, like minting an NFT that has already sold out.
    function soldOut() external pure {
        revert("sold out");
    }
}

/// @title Heartbeat
/// @notice The simplest kind of keeper job: something that just needs somebody
/// to call it now and then. It does not need to happen at any particular moment.
contract Heartbeat is IAfterburnerJob {
    uint64 public beats;
    uint64 public lastBeat;

    event Beat(uint256 beats, uint256 at);

    function work() external returns (uint256 units) {
        unchecked {
            beats += 1;
        }
        lastBeat = uint64(block.timestamp);
        emit Beat(beats, block.timestamp);
        return 1;
    }
}
