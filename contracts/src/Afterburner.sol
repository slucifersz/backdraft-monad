// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A job is any contract that can turn a gas budget into useful work.
/// It is called with a capped amount of gas and must return how many units of
/// work it completed (0 = nothing to do, no bounty is paid).
interface IAfterburnerJob {
    function work() external returns (uint256 units);
}

/// @title Afterburner
/// @notice On Monad a transaction is charged for its gas *limit*, not for the gas
/// it uses, and nothing is refunded. Whatever is left when a call finishes has
/// already been paid for and is about to be thrown away. Afterburner spends that
/// leftover on a queue of posted jobs and pays the job bounty back to the sender.
///
/// The bounty per gas is capped below the gas price of the transaction, so the
/// refund is always smaller than what the gas cost: setting a tight gas limit is
/// still the cheapest thing to do. Afterburner only recovers part of the safety
/// margin a sender has to leave anyway.
contract Afterburner {
    struct Job {
        // slot 1
        address target;
        uint64 minGas; // do not start the job with less than this
        bool active;
        // slot 2
        address poster;
        uint64 bountyPerGas; // wei paid per unit of gas the job actually used
        // slot 3
        uint128 escrow; // wei left to pay out
        uint64 maxGas; // per-burn cap, 0 = no cap
        uint32 fails; // consecutive failed runs
    }

    /// @dev Gas held back after the last job to pay the sender, update stats and emit.
    uint256 public constant RESERVE = 50_000;
    /// @dev Gas needed to load one more job from storage before it can be called.
    uint256 internal constant JOB_OVERHEAD = 40_000;
    /// @dev A sender never gets back more than 90% of what the recycled gas cost.
    uint256 public constant MAX_REFUND_BPS = 9_000;
    uint256 internal constant MAX_FAILS = 3;
    /// @dev Cold account access for the job contract is charged on top of the forwarded gas.
    uint256 internal constant CALL_OVERHEAD = 12_000;

    Job[] public jobs;
    mapping(uint256 => string) public labelOf;
    mapping(address => uint256) public claimable;

    // one storage slot of running totals
    uint32 public totalBurns;
    uint48 public totalUnits;
    uint64 public totalGasRecycled;
    uint96 public totalBountyPaid;

    uint256 private _lock = 1;

    event JobPosted(uint256 indexed id, address indexed target, address indexed poster, uint256 bountyPerGas, uint256 escrow, string label);
    event JobToppedUp(uint256 indexed id, uint256 amount);
    event JobClosed(uint256 indexed id, uint256 refunded);
    event JobRan(uint256 indexed id, address indexed sender, uint256 gasUsed, uint256 units, uint256 bounty);
    event JobFailed(uint256 indexed id, uint256 gasUsed);
    /// @param mainOk    did the sender's own call succeed
    /// @param mainGas   gas the sender's own call really used (measured on-chain;
    ///                  receipts on Monad report the gas limit instead)
    /// @param jobGas    leftover gas that was turned into job work
    /// @param gasLeft   gas still unused when the transaction was about to end
    event Burned(
        address indexed sender,
        address indexed target,
        bool mainOk,
        uint256 mainGas,
        uint256 jobGas,
        uint256 units,
        uint256 bounty,
        uint256 gasLeft
    );

    error Reentrancy();
    error NotPoster();
    error BadJob();

    modifier lock() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ------------------------------------------------------------------ jobs

    function postJob(address target, uint64 minGas, uint64 maxGas, uint64 bountyPerGas, string calldata label)
        external
        payable
        returns (uint256 id)
    {
        if (target == address(0) || target == address(this) || bountyPerGas == 0 || msg.value == 0) revert BadJob();
        id = jobs.length;
        jobs.push(
            Job({
                target: target,
                minGas: minGas,
                active: true,
                poster: msg.sender,
                bountyPerGas: bountyPerGas,
                escrow: uint128(msg.value),
                maxGas: maxGas,
                fails: 0
            })
        );
        labelOf[id] = label;
        emit JobPosted(id, target, msg.sender, bountyPerGas, msg.value, label);
    }

    function topUp(uint256 id) external payable {
        Job storage j = jobs[id];
        j.escrow += uint128(msg.value);
        j.active = true;
        j.fails = 0;
        emit JobToppedUp(id, msg.value);
    }

    function closeJob(uint256 id) external lock {
        Job storage j = jobs[id];
        if (msg.sender != j.poster) revert NotPoster();
        uint256 refund = j.escrow;
        j.escrow = 0;
        j.active = false;
        _pay(payable(msg.sender), refund);
        emit JobClosed(id, refund);
    }

    function setJobParams(uint256 id, uint64 minGas, uint64 maxGas, uint64 bountyPerGas) external {
        Job storage j = jobs[id];
        if (msg.sender != j.poster) revert NotPoster();
        if (bountyPerGas == 0) revert BadJob();
        j.minGas = minGas;
        j.maxGas = maxGas;
        j.bountyPerGas = bountyPerGas;
    }

    function jobCount() external view returns (uint256) {
        return jobs.length;
    }

    // ------------------------------------------------------------- burn paths

    /// @notice Wrapper path: make a call, then spend whatever gas is left on jobs.
    /// The application being called does not need to change. If the call reverts
    /// the transaction still succeeds, so a failed call can still earn back part
    /// of the gas it was charged for.
    function exec(address target, bytes calldata data)
        external
        payable
        lock
        returns (bool mainOk, uint256 mainGas, uint256 jobGas, uint256 units, uint256 bounty)
    {
        uint256 g = gasleft();
        (mainOk,) = target.call{value: msg.value}(data);
        mainGas = g - gasleft();
        if (!mainOk && msg.value != 0) _pay(payable(msg.sender), msg.value);

        (jobGas, units, bounty) = _burn(payable(msg.sender));
        emit Burned(msg.sender, target, mainOk, mainGas, jobGas, units, bounty, gasleft());
    }

    /// @notice Hook path: an application calls this at the end of its own function.
    function burn(address payable beneficiary) external lock returns (uint256 jobGas, uint256 units, uint256 bounty) {
        (jobGas, units, bounty) = _burn(beneficiary);
        emit Burned(beneficiary, msg.sender, true, 0, jobGas, units, bounty, gasleft());
    }

    function claim() external lock {
        uint256 amount = claimable[msg.sender];
        claimable[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "claim failed");
    }

    // ---------------------------------------------------------------- internals

    function _burn(address payable to) internal returns (uint256 jobGas, uint256 units, uint256 bounty) {
        uint256 n = jobs.length;
        uint256 rateCap = (tx.gasprice * MAX_REFUND_BPS) / 10_000;

        for (uint256 i; i < n; ++i) {
            if (gasleft() < RESERVE + JOB_OVERHEAD) break;
            Job storage j = jobs[i];
            if (!j.active) continue;

            // keep the reserve plus the cost of touching the job contract itself
            uint256 budget = gasleft() - RESERVE - CALL_OVERHEAD;
            uint256 cap = j.maxGas;
            if (cap != 0 && budget > cap) budget = cap;
            if (budget < j.minGas) continue;

            address target = j.target;
            uint256 done;
            bool ok;
            uint256 g = gasleft();
            // Low-level call that copies at most one word back, so a job cannot
            // burn the reserve by returning a huge blob.
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                mstore(ptr, 0x322e9f0400000000000000000000000000000000000000000000000000000000) // work()
                ok := call(budget, target, 0, ptr, 4, ptr, 32)
                if and(ok, gt(returndatasize(), 31)) { done := mload(ptr) }
            }
            uint256 used = g - gasleft();

            if (!ok) {
                uint32 fails = j.fails + 1;
                j.fails = fails;
                if (fails >= MAX_FAILS) j.active = false;
                emit JobFailed(i, used);
                continue;
            }
            if (done == 0) continue; // job had nothing to do

            uint256 rate = j.bountyPerGas;
            if (rate > rateCap) rate = rateCap;
            uint256 pay = used * rate;
            uint256 escrow = j.escrow;
            if (pay >= escrow) {
                pay = escrow;
                j.active = false;
            }
            j.escrow = uint128(escrow - pay);
            if (j.fails != 0) j.fails = 0;

            jobGas += used;
            units += done;
            bounty += pay;
            emit JobRan(i, to, used, done, pay);
        }

        if (jobGas != 0) {
            unchecked {
                totalBurns += 1;
                totalUnits += uint48(units);
                totalGasRecycled += uint64(jobGas);
                totalBountyPaid += uint96(bounty);
            }
        }
        if (bounty != 0) _pay(to, bounty);
    }

    function _pay(address payable to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: 30_000}("");
        if (!ok) claimable[to] += amount;
    }
}
