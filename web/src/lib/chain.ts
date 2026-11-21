import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEventLogs,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.monad.xyz";
export const EXPLORER = "https://testnet.monadscan.com";

export const ADDR = {
  afterburner: "0xAF019654d479917bd38ADa0648eb9AdbFfc6db79",
  gasModel: "0x54e95229e1259D1A16E9f242f9816413bF9634b1",
  demoApp: "0x9097f732659811c4119a28B887ED8f829E11a7A5",
  heartbeat: "0xc02fd9FC8aE928555f8F0672709D24EAa8fe3251",
} as const;

export const afterburnerAbi = parseAbi([
  "function exec(address target, bytes data) payable returns (bool mainOk, uint256 mainGas, uint256 jobGas, uint256 units, uint256 bounty)",
  "function jobCount() view returns (uint256)",
  "function jobs(uint256) view returns (address target, uint64 minGas, bool active, address poster, uint64 bountyPerGas, uint128 escrow, uint64 maxGas, uint32 fails)",
  "function labelOf(uint256) view returns (string)",
  "function totalBurns() view returns (uint32)",
  "function totalUnits() view returns (uint48)",
  "function totalGasRecycled() view returns (uint64)",
  "function totalBountyPaid() view returns (uint96)",
  "event Burned(address indexed sender, address indexed target, bool mainOk, uint256 mainGas, uint256 jobGas, uint256 units, uint256 bounty, uint256 gasLeft)",
  "event JobRan(uint256 indexed id, address indexed sender, uint256 gasUsed, uint256 units, uint256 bounty)",
  "event JobFailed(uint256 indexed id, uint256 gasUsed)",
]);

export const gasModelAbi = parseAbi([
  "function state() view returns (int64 w, int64 b, uint32 steps, uint32 epoch, uint32 loss, uint32 xScale, uint32 yScale)",
  "function history() view returns (uint32[])",
  "function dataset() view returns (uint32[] ns, uint32[] gases)",
  "function predict(uint256 n) view returns (uint256)",
]);

export const demoAppAbi = parseAbi([
  "function crunch(uint256 n) returns (bytes32)",
  "function soldOut()",
  "function calls() view returns (uint256)",
]);

export const heartbeatAbi = parseAbi(["function beats() view returns (uint64)"]);

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL, { retryCount: 3, retryDelay: 400 }),
  pollingInterval: 400,
});

const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_KEY as Hex | undefined;
export const demoAccount = DEMO_KEY ? privateKeyToAccount(DEMO_KEY) : undefined;
export const walletClient = demoAccount
  ? createWalletClient({
      account: demoAccount,
      chain: monadTestnet,
      transport: http(RPC_URL, { retryCount: 2, retryDelay: 400 }),
    })
  : undefined;

// ---------------------------------------------------------------- reads

export type ModelState = {
  w: number;
  b: number;
  steps: number;
  epoch: number;
  loss: number;
  xScale: number;
  yScale: number;
  history: number[];
  ns: number[];
  gases: number[];
};

export async function readModel(): Promise<ModelState> {
  const [state, history, dataset] = await Promise.all([
    publicClient.readContract({ address: ADDR.gasModel, abi: gasModelAbi, functionName: "state" }),
    publicClient.readContract({ address: ADDR.gasModel, abi: gasModelAbi, functionName: "history" }),
    publicClient.readContract({ address: ADDR.gasModel, abi: gasModelAbi, functionName: "dataset" }),
  ]);
  return {
    w: Number(state[0]) / 1e9,
    b: Number(state[1]) / 1e9,
    steps: state[2],
    epoch: state[3],
    loss: state[4] / 1e6,
    xScale: state[5],
    yScale: state[6],
    history: history.map((v) => v / 1e6),
    ns: dataset[0].map(Number),
    gases: dataset[1].map(Number),
  };
}

/** Gas the on-chain model predicts for input size n (same arithmetic as the contract). */
export function modelPredict(m: Pick<ModelState, "w" | "b" | "xScale" | "yScale">, n: number) {
  const y = m.w * (n / m.xScale - 0.5) + m.b;
  return Math.max(0, y * m.yScale);
}

export type Job = {
  id: number;
  label: string;
  target: string;
  active: boolean;
  bountyPerGas: bigint;
  escrow: bigint;
};

export type Totals = {
  burns: number;
  units: number;
  gasRecycled: number;
  bountyPaid: bigint;
  beats: number;
  jobs: Job[];
};

export async function readTotals(): Promise<Totals> {
  const ab = { address: ADDR.afterburner, abi: afterburnerAbi } as const;
  const [burns, units, gasRecycled, bountyPaid, count, beats] = await Promise.all([
    publicClient.readContract({ ...ab, functionName: "totalBurns" }),
    publicClient.readContract({ ...ab, functionName: "totalUnits" }),
    publicClient.readContract({ ...ab, functionName: "totalGasRecycled" }),
    publicClient.readContract({ ...ab, functionName: "totalBountyPaid" }),
    publicClient.readContract({ ...ab, functionName: "jobCount" }),
    publicClient.readContract({ address: ADDR.heartbeat, abi: heartbeatAbi, functionName: "beats" }),
  ]);
  const ids = Array.from({ length: Number(count) }, (_, i) => i);
  const jobs = await Promise.all(
    ids.map(async (id) => {
      const [j, label] = await Promise.all([
        publicClient.readContract({ ...ab, functionName: "jobs", args: [BigInt(id)] }),
        publicClient.readContract({ ...ab, functionName: "labelOf", args: [BigInt(id)] }),
      ]);
      return { id, label, target: j[0], active: j[2], bountyPerGas: j[4], escrow: j[5] } satisfies Job;
    }),
  );
  return {
    burns,
    units: Number(units),
    gasRecycled: Number(gasRecycled),
    bountyPaid,
    beats: Number(beats),
    jobs,
  };
}

// ----------------------------------------------------------- transactions

export type CallKind = { kind: "crunch"; n: number } | { kind: "soldOut" };

export function appCalldata(call: CallKind): Hex {
  return call.kind === "crunch"
    ? encodeFunctionData({ abi: demoAppAbi, functionName: "crunch", args: [BigInt(call.n)] })
    : encodeFunctionData({ abi: demoAppAbi, functionName: "soldOut" });
}

function execCalldata(call: CallKind): Hex {
  return encodeFunctionData({
    abi: afterburnerAbi,
    functionName: "exec",
    args: [ADDR.demoApp, appCalldata(call)],
  });
}

/** What calling the app directly, without Afterburner, would need (eth_estimateGas). */
export async function estimateDirect(call: CallKind, from: Hex): Promise<number | null> {
  try {
    const gas = await publicClient.estimateGas({ account: from, to: ADDR.demoApp, data: appCalldata(call) });
    return Number(gas);
  } catch {
    return null; // the call reverts, so there is nothing to estimate
  }
}

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; expected: bigint };

export async function currentFees(): Promise<Fees> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const base = block.baseFeePerGas ?? 100_000_000_000n;
  const tip = 1_000_000_000n;
  return { maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip, expected: base + tip };
}

export type Outcome = {
  mainOk: boolean;
  mainGas: number;
  jobGas: number;
  units: number;
  bounty: bigint;
};

/** Dry-run the wrapped transaction with exactly the gas limit we intend to send. */
export async function simulateExec(call: CallKind, gasLimit: number, from: Hex, fees: Fees): Promise<Outcome> {
  const { result } = await publicClient.simulateContract({
    account: from,
    address: ADDR.afterburner,
    abi: afterburnerAbi,
    functionName: "exec",
    args: [ADDR.demoApp, appCalldata(call)],
    gas: BigInt(gasLimit),
    gasPrice: fees.expected,
  });
  return {
    mainOk: result[0],
    mainGas: Number(result[1]),
    jobGas: Number(result[2]),
    units: Number(result[3]),
    bounty: result[4],
  };
}

export type SentTx = Outcome & {
  hash: Hex;
  gasLimit: number;
  receiptGasUsed: number;
  gasLeft: number;
  gasPrice: bigint;
  fee: bigint;
  status: "success" | "reverted";
  jobRuns: { id: number; gasUsed: number; units: number; bounty: bigint }[];
};

export async function sendExec(call: CallKind, gasLimit: number, fees: Fees): Promise<SentTx> {
  if (!walletClient || !demoAccount) throw new Error("no demo account configured");
  const hash = await walletClient.sendTransaction({
    to: ADDR.afterburner,
    data: execCalldata(call),
    gas: BigInt(gasLimit),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return decodeReceipt(receipt, gasLimit);
}

export function decodeReceipt(receipt: TransactionReceipt, gasLimit: number): SentTx {
  const logs = parseEventLogs({ abi: afterburnerAbi, logs: receipt.logs });
  const burned = logs.find((l) => l.eventName === "Burned");
  const runs = logs.filter((l) => l.eventName === "JobRan");
  const args = burned && burned.eventName === "Burned" ? burned.args : undefined;
  const gasPrice = receipt.effectiveGasPrice;
  return {
    hash: receipt.transactionHash,
    gasLimit,
    receiptGasUsed: Number(receipt.gasUsed),
    status: receipt.status,
    gasPrice,
    fee: BigInt(gasLimit) * gasPrice,
    mainOk: args?.mainOk ?? false,
    mainGas: Number(args?.mainGas ?? 0n),
    jobGas: Number(args?.jobGas ?? 0n),
    units: Number(args?.units ?? 0n),
    bounty: args?.bounty ?? 0n,
    gasLeft: Number(args?.gasLeft ?? 0n),
    jobRuns: runs.map((r) =>
      r.eventName === "JobRan"
        ? { id: Number(r.args.id), gasUsed: Number(r.args.gasUsed), units: Number(r.args.units), bounty: r.args.bounty }
        : { id: 0, gasUsed: 0, units: 0, bounty: 0n },
    ),
  };
}

export const fmtGas = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtMon = (wei: bigint, digits = 5) => (Number(wei) / 1e18).toFixed(digits);
