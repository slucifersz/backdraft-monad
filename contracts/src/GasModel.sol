// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAfterburnerJob} from "./Afterburner.sol";

/// @title GasModel
/// @notice A tiny linear model, gas ≈ w·n + b, trained entirely on-chain by
/// gradient descent. Every training step is paid for by leftover gas that
/// Afterburner recycles from other people's transactions.
///
/// The model learns how much gas a call needs as a function of its input size,
/// so the thing wasted gas trains is a predictor that helps waste less gas.
contract GasModel is IAfterburnerJob {
    int256 internal constant S = 1e9; // fixed-point scale
    uint256 internal constant MAX_POINTS = 16;
    int256 internal constant PACK = 1e4; // dataset precision
    int256 internal constant UNPACK = 1e5; // S / PACK
    uint256 internal constant NEW_WORD_GAS = 34_000;
    uint256 internal constant MAX_HISTORY = 4000;

    address public owner;

    // model state (one slot)
    int64 public w;
    int64 public b;
    uint32 public steps;
    uint32 public epoch;
    uint32 public lastLoss; // mean squared error on normalised data, scaled by 1e6
    uint32 public points;

    // normalisation: x = n / xScale - 0.5, y = gas / yScale
    uint32 public xScale;
    uint32 public yScale;
    // learning rates (scaled by 1e9) and gas thresholds
    uint32 public lrW = 500_000_000;
    uint32 public lrB = 50_000_000;
    uint32 public firstStepGas = 95_000;
    uint32 public stepGas = 18_000;

    /// Normalised dataset packed 16 values per word (int16, scaled by 1e4), so a
    /// training run touches two storage slots instead of one per point. On Monad
    /// a cold storage read costs 8,100 gas, which made this the biggest fixed cost.
    uint256 internal packedX;
    uint256 internal packedY;
    uint32[MAX_POINTS] public rawN;
    uint32[MAX_POINTS] public rawGas;

    /// loss history: 8 values (uint32, scaled by 1e6) per word, keyed by (epoch << 32 | index)
    mapping(uint256 => uint256) internal hist;

    event Trained(uint32 indexed epoch, uint32 steps, uint32 loss, int64 w, int64 b, uint256 stepsNow);
    event DataSet(uint256 points, uint32 xScale, uint32 yScale);
    event Reset(uint32 epoch);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ----------------------------------------------------------------- admin

    /// @notice Load measured (input size, gas) pairs and restart training.
    function setData(uint32[] calldata ns, uint32[] calldata gases, uint32 xScale_, uint32 yScale_) external onlyOwner {
        uint256 len = ns.length;
        require(len == gases.length && len > 1 && len <= MAX_POINTS, "bad data");
        xScale = xScale_;
        yScale = yScale_;
        uint256 px;
        uint256 py;
        for (uint256 i; i < len; ++i) {
            rawN[i] = ns[i];
            rawGas[i] = gases[i];
            int256 xv = (int256(uint256(ns[i])) * PACK) / int256(uint256(xScale_)) - PACK / 2;
            int256 yv = (int256(uint256(gases[i])) * PACK) / int256(uint256(yScale_));
            require(xv >= type(int16).min && xv <= type(int16).max && yv <= type(int16).max, "out of range");
            px |= uint256(uint16(int16(xv))) << (i * 16);
            py |= uint256(uint16(int16(yv))) << (i * 16);
        }
        packedX = px;
        packedY = py;
        points = uint32(len);
        emit DataSet(len, xScale_, yScale_);
        _reset();
    }

    function reset() external onlyOwner {
        _reset();
    }

    function tune(uint32 lrW_, uint32 lrB_, uint32 firstStepGas_, uint32 stepGas_) external onlyOwner {
        lrW = lrW_;
        lrB = lrB_;
        firstStepGas = firstStepGas_;
        stepGas = stepGas_;
    }

    function _reset() internal {
        w = 0;
        b = 0;
        steps = 0;
        lastLoss = 0;
        epoch += 1;
        emit Reset(epoch);
    }

    // ------------------------------------------------------------------ work

    /// @notice Run as many gradient-descent steps as the gas we were handed allows.
    function work() external returns (uint256 units) {
        uint256 n = points;
        if (n == 0 || gasleft() < firstStepGas) return 0;

        int256[] memory x = new int256[](n);
        int256[] memory y = new int256[](n);
        {
            uint256 px = packedX;
            uint256 py = packedY;
            for (uint256 i; i < n; ++i) {
                x[i] = int256(int16(uint16(px >> (i * 16)))) * UNPACK;
                y[i] = int256(int16(uint16(py >> (i * 16)))) * UNPACK;
            }
        }
        int256 w_ = w;
        int256 b_ = b;
        int256 lrw = int256(uint256(lrW));
        int256 lrb = int256(uint256(lrB));
        uint256 reserve = stepGas;
        uint256 s = steps;
        uint256 base = uint256(epoch) << 32;
        uint256 loss;

        while (true) {
            // Every 8th step opens a fresh history word. Writing a new storage slot is
            // the most expensive thing a step can do, so make sure it is affordable
            // before starting rather than running out of gas halfway through.
            if (gasleft() <= reserve + ((s & 7) == 0 ? NEW_WORD_GAS : 0)) break;
            int256 gw;
            int256 gb;
            int256 sq;
            int256 cnt = int256(n);
            // All values are 1e9 fixed-point numbers of order one, so products
            // stay far below the int256 range.
            unchecked {
                for (uint256 i; i < n; ++i) {
                    int256 xi = x[i];
                    int256 err = (w_ * xi) / S + b_ - y[i];
                    gw += (err * xi) / S;
                    gb += err;
                    sq += (err * err) / S;
                }
                w_ -= (lrw * (gw / cnt)) / S;
                b_ -= (lrb * (gb / cnt)) / S;
            }
            loss = uint256(sq / cnt) / 1000; // 1e9 -> 1e6 scale
            if (loss > type(uint32).max) loss = type(uint32).max;

            if (s < MAX_HISTORY) {
                uint256 key = base | (s >> 3);
                uint256 shift = (s & 7) << 5;
                hist[key] = (hist[key] & ~(uint256(0xffffffff) << shift)) | (loss << shift);
            }
            unchecked {
                ++s;
                ++units;
            }
        }
        if (units == 0) return 0;

        w = int64(w_);
        b = int64(b_);
        steps = uint32(s);
        lastLoss = uint32(loss);
        emit Trained(epoch, uint32(units), uint32(loss), int64(w_), int64(b_), s);
    }

    // ----------------------------------------------------------------- views

    /// @notice Gas the model expects a call with input size `n` to need.
    function predict(uint256 n) external view returns (uint256 gas) {
        int256 x = (int256(n) * S) / int256(uint256(xScale)) - S / 2;
        int256 yv = (int256(w) * x) / S + int256(b);
        if (yv <= 0) return 0;
        gas = (uint256(yv) * uint256(yScale)) / uint256(S);
    }

    function history() external view returns (uint32[] memory out) {
        uint256 len = steps < MAX_HISTORY ? steps : MAX_HISTORY;
        out = new uint32[](len);
        uint256 base = uint256(epoch) << 32;
        for (uint256 i; i < len; ++i) {
            out[i] = uint32(hist[base | (i >> 3)] >> ((i & 7) << 5));
        }
    }

    function dataset() external view returns (uint32[] memory ns, uint32[] memory gases) {
        uint256 len = points;
        ns = new uint32[](len);
        gases = new uint32[](len);
        for (uint256 i; i < len; ++i) {
            ns[i] = rawN[i];
            gases[i] = rawGas[i];
        }
    }

    function state()
        external
        view
        returns (int64 w_, int64 b_, uint32 steps_, uint32 epoch_, uint32 loss_, uint32 xScale_, uint32 yScale_)
    {
        return (w, b, steps, epoch, lastLoss, xScale, yScale);
    }
}
