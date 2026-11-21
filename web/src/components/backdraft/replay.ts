// Real transactions recorded on Monad testnet on 2026-11-21. Used for replay mode
// (no demo account, send failure, or timeout). Nothing here is invented.

export type OptionKey = "official" | "wallet" | "h300" | "h500";

/** One transaction that went through Backdraft and got measured. */
export type Measure = {
  source: "live" | "replay";
  gasLimit: number;
  /** 真实用量：合约在链上量出来的。 */
  mainGas: number;
  /** 结束时没用上的。 */
  gasLeft: number;
  /** gasLeft 是近似值（回放记录里没有这个读数），不显示精确数字。 */
  approx: boolean;
  receiptGasUsed: number;
  feeMon: number;
  /** 这笔写进流量计后的累计次数；没有写入时为 null。 */
  samples: number | null;
  hash: string;
};

// 回放时“记录与固定开销”按约 6 万估，没用上 = 上限 − 真实用量 − 60,000。
const OVERHEAD_APPROX = 60000;

export const REPLAY: Record<OptionKey, Measure> = {
  official: {
    source: "replay",
    gasLimit: 114037,
    mainGas: 62419,
    gasLeft: 17375,
    approx: false,
    receiptGasUsed: 114037,
    feeMon: 0.011517737,
    samples: null,
    hash: "0x2d34fc3f2765b4f65358002f42a798a622c9af1f30f264a42ed6660f4b817f42",
  },
  wallet: {
    source: "replay",
    gasLimit: 159121,
    mainGas: 62419,
    gasLeft: 62459,
    approx: false,
    receiptGasUsed: 159121,
    feeMon: 0.016071221,
    samples: null,
    hash: "0xd9b80b7256d020bd34934baa630bc86d019906849144efa4c20f07e3a2da2a01",
  },
  h300: {
    source: "replay",
    gasLimit: 300000,
    mainGas: 62419,
    gasLeft: 300000 - 62419 - OVERHEAD_APPROX,
    approx: true,
    receiptGasUsed: 300000,
    feeMon: 0.0303,
    samples: null,
    hash: "0xccf4844d7c9bd62ae47ebe5a55d9c2e22561a25dba3e3f03be2efd9d063a355e",
  },
  h500: {
    source: "replay",
    gasLimit: 500000,
    mainGas: 62427,
    gasLeft: 500000 - 62427 - OVERHEAD_APPROX,
    approx: true,
    receiptGasUsed: 500000,
    feeMon: 0.0505,
    samples: 1,
    hash: "0x7ec501ef6ad409c0ce18f4aa5da0afa4f303c8f0a6fb755d0bfd08cb895b5c6f",
  },
};

/** 第 5 版的回放：链上的建议值，和按建议直接发出的那一笔。 */
export const REPLAY_READ = {
  suggestion: { gasLimit: 88313, maxUsed: 62427, lastUsed: 62427, samples: 1 },
  hash: "0x626c357c0be80dd8398d0670250340514f5b5149b56a960065be9903c4c5a6e6",
  gasLimit: 88313,
  feeMon: 0.00892,
  directEstimate: 74081,
};

export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
