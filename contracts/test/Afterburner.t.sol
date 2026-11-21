// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Afterburner, IAfterburnerJob} from "../src/Afterburner.sol";
import {GasModel} from "../src/GasModel.sol";
import {DemoApp, Heartbeat} from "../src/DemoApp.sol";

contract HungryJob is IAfterburnerJob {
    uint256 public x;

    function work() external returns (uint256) {
        while (true) x += 1; // burns everything it is given, then runs out of gas
        return 1;
    }
}

contract BombJob is IAfterburnerJob {
    function work() external pure returns (uint256) {
        assembly {
            return(0, 200000) // tries to hand back a huge return blob
        }
    }
}

contract ReenterJob is IAfterburnerJob {
    Afterburner public ab;

    constructor(Afterburner ab_) {
        ab = ab_;
    }

    function work() external returns (uint256) {
        ab.burn(payable(address(this))); // must be rejected by the lock
        return 1;
    }
}

contract AfterburnerTest is Test {
    Afterburner ab;
    GasModel model;
    DemoApp app;
    Heartbeat beat;
    address user = address(0xBEEF);
    uint256 constant GAS_PRICE = 100 gwei;

    function setUp() public {
        ab = new Afterburner();
        model = new GasModel();
        app = new DemoApp();
        beat = new Heartbeat();

        // gas(n) is a straight line plus a little noise
        uint32[] memory ns = new uint32[](16);
        uint32[] memory gs = new uint32[](16);
        for (uint32 i; i < 16; ++i) {
            ns[i] = (i + 1) * 2;
            gs[i] = 30_000 + ns[i] * 3_500 + (i % 3) * 400;
        }
        model.setData(ns, gs, 32, 200_000);

        vm.deal(address(this), 100 ether);
        vm.deal(user, 10 ether);
        ab.postJob{value: 1 ether}(address(beat), 30_000, 80_000, 50 gwei, "heartbeat");
        ab.postJob{value: 5 ether}(address(model), 150_000, 0, 50 gwei, "train gas model");
        vm.txGasPrice(GAS_PRICE);
    }

    function _exec(uint256 gasLimit, bytes memory data)
        internal
        returns (bool ok, uint256 mainGas, uint256 jobGas, uint256 units, uint256 bounty)
    {
        vm.prank(user, user);
        (ok, mainGas, jobGas, units, bounty) = ab.exec{gas: gasLimit}(address(app), data);
    }

    function test_leftoverGasRunsJobsAndPaysSender() public {
        uint256 before = user.balance;
        (bool ok, uint256 mainGas, uint256 jobGas, uint256 units, uint256 bounty) =
            _exec(600_000, abi.encodeCall(DemoApp.crunch, (8)));

        assertTrue(ok);
        assertEq(app.calls(), 1);
        assertGt(units, 1, "heartbeat + at least one training step");
        assertEq(beat.beats(), 1);
        assertGt(model.steps(), 0);
        assertEq(user.balance - before, bounty);
        // refund is always below what the recycled gas cost
        assertLe(bounty, (jobGas * GAS_PRICE * 9_000) / 10_000);
        assertGt(bounty, 0);
        console.log("mainGas", mainGas);
        console.log("jobGas", jobGas);
        console.log("steps", model.steps());
        console.log("bounty wei", bounty);
    }

    function test_tightLimitLeavesNothingToBurn() public {
        (bool ok,, uint256 jobGas, uint256 units, uint256 bounty) = _exec(150_000, abi.encodeCall(DemoApp.crunch, (8)));
        assertTrue(ok);
        assertEq(jobGas, 0);
        assertEq(units, 0);
        assertEq(bounty, 0);
    }

    function test_failedMainCallStillRecycles() public {
        uint256 before = user.balance;
        (bool ok,, uint256 jobGas,, uint256 bounty) = _exec(500_000, abi.encodeCall(DemoApp.soldOut, ()));
        assertFalse(ok);
        assertGt(jobGas, 0);
        assertEq(user.balance - before, bounty);
        assertGt(bounty, 0);
    }

    function test_bountyRateIsCappedBelowGasPrice() public {
        Afterburner ab2 = new Afterburner();
        Heartbeat hb = new Heartbeat();
        ab2.postJob{value: 1 ether}(address(hb), 30_000, 80_000, 10_000 gwei, "overpaying job");
        vm.txGasPrice(GAS_PRICE);
        vm.prank(user, user);
        (,, uint256 jobGas,, uint256 bounty) = ab2.exec{gas: 400_000}(address(app), abi.encodeCall(DemoApp.crunch, (1)));
        assertGt(jobGas, 0);
        assertEq(bounty, jobGas * ((GAS_PRICE * 9_000) / 10_000));
    }

    function test_badJobsCannotBreakTheSender() public {
        Afterburner ab2 = new Afterburner();
        HungryJob hungry = new HungryJob();
        BombJob bomb = new BombJob();
        ReenterJob re = new ReenterJob(ab2);
        Heartbeat hb = new Heartbeat();
        ab2.postJob{value: 1 ether}(address(hungry), 30_000, 100_000, 50 gwei, "hungry");
        ab2.postJob{value: 1 ether}(address(bomb), 30_000, 100_000, 50 gwei, "bomb");
        ab2.postJob{value: 1 ether}(address(re), 30_000, 100_000, 50 gwei, "reenter");
        ab2.postJob{value: 1 ether}(address(hb), 30_000, 80_000, 50 gwei, "heartbeat");

        vm.prank(user, user);
        (bool ok,,, uint256 units,) = ab2.exec{gas: 1_500_000}(address(app), abi.encodeCall(DemoApp.crunch, (4)));
        assertTrue(ok, "sender's call must survive bad jobs");
        assertEq(app.calls(), 1);
        assertEq(hb.beats(), 1, "good job still ran after the bad ones");
        assertGe(units, 1);
    }

    function test_modelLearnsTheLine() public {
        uint32 first;
        for (uint256 i; i < 12; ++i) {
            _exec(700_000, abi.encodeCall(DemoApp.crunch, (4)));
            if (i == 0) first = model.history()[0];
        }
        uint32[] memory h = model.history();
        console.log("steps", model.steps());
        console.log("first loss", first);
        console.log("last loss", h[h.length - 1]);
        console.log("predict(16)", model.predict(16));
        assertLt(h[h.length - 1], first / 20, "loss should fall a lot");
        // true value at n=16 is about 30_000 + 16*3_500 = 86_000
        assertApproxEqRel(model.predict(16), 86_400, 0.05e18);
    }

    function test_closeJobRefundsPoster() public {
        uint256 before = address(this).balance;
        ab.closeJob(0);
        assertEq(address(this).balance - before, 1 ether);
    }

    receive() external payable {}
}
