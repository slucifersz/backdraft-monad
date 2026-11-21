// Real transactions recorded on Monad testnet on 2026-11-21. Used for replay mode
// (no demo account, send failure, or timeout). Nothing here is invented.

export type OptionKey = "official" | "wallet" | "h300" | "h500";

export type BurnResult = {
  source: "live" | "replay";
  gasLimit: number;
  mainOk: boolean;
  mainGas: number;
  jobGas: number;
  units: number;
  gasLeft: number;
  feeMon: number;
  bountyMon: number;
  hash: string;
};

export const REPLAY: Record<OptionKey | "failed", BurnResult> = {
  official: {
    source: "replay",
    gasLimit: 114037,
    mainOk: true,
    mainGas: 62419,
    jobGas: 0,
    units: 0,
    gasLeft: 17375,
    feeMon: 0.011517737,
    bountyMon: 0,
    hash: "0x2d34fc3f2765b4f65358002f42a798a622c9af1f30f264a42ed6660f4b817f42",
  },
  wallet: {
    source: "replay",
    gasLimit: 159121,
    mainOk: true,
    mainGas: 62419,
    jobGas: 0,
    units: 0,
    gasLeft: 62459,
    feeMon: 0.016071221,
    bountyMon: 0,
    hash: "0xd9b80b7256d020bd34934baa630bc86d019906849144efa4c20f07e3a2da2a01",
  },
  h300: {
    source: "replay",
    gasLimit: 300000,
    mainOk: true,
    mainGas: 62419,
    jobGas: 126377,
    units: 8,
    gasLeft: 49323,
    feeMon: 0.0303,
    bountyMon: 0.00631885,
    hash: "0xccf4844d7c9bd62ae47ebe5a55d9c2e22561a25dba3e3f03be2efd9d063a355e",
  },
  h500: {
    source: "replay",
    gasLimit: 500000,
    mainOk: true,
    mainGas: 62419,
    jobGas: 323478,
    units: 27,
    gasLeft: 52222,
    feeMon: 0.0505,
    bountyMon: 0.0161739,
    hash: "0x6ffdf56732704dfcc234139d50a90c48b3cf05c482c70564fefebd5970decd4d",
  },
  failed: {
    source: "replay",
    gasLimit: 300000,
    mainOk: false,
    mainGas: 10679,
    jobGas: 179069,
    units: 15,
    gasLeft: 48489,
    feeMon: 0.0303,
    bountyMon: 0.00895345,
    hash: "0xf2307214cca7021717cbc6f7861bdf3df69456807b08829541d11ab7163df1dc",
  },
};

export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
