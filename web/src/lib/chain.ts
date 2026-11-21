import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  fallback,
  http,
  parseAbi,
  parseEventLogs,
  type EIP1193Provider,
  type Hex,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.monad.xyz";
export const EXPLORER = "https://testnet.monadscan.com";

export const ADDR = {
  afterburner: "0xb22CA6B2090367F2487Caf0133Be3B2b18E7f607",
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
  "function stats(address target, bytes4 selector) view returns (uint64 last, uint64 max, uint64 avg, uint32 count, uint32 updatedAt)",
  "function suggest(address target, bytes4 selector) view returns (uint256 callGas, uint256 samples)",
  "function suggestTxGasLimit(address target, bytes data) view returns (uint256)",
  "event Recorded(address indexed target, bytes4 indexed selector, uint256 gasUsed, uint256 maxGas, uint256 samples)",
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

// The public endpoint rate-limits (HTTP 429) under a burst of reads, so every
// request falls through to two other public Monad testnet endpoints in turn.
const RPC_URLS = [RPC_URL, "https://monad-testnet.drpc.org", "https://rpc.ankr.com/monad_testnet"];
const transport = () =>
  fallback(
    RPC_URLS.map((url) => http(url, { retryCount: 1, retryDelay: 300, timeout: 10_000 })),
    { rank: false },
  );

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: transport(),
  pollingInterval: 400,
});

const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_KEY as Hex | undefined;
export const demoAccount = DEMO_KEY ? privateKeyToAccount(DEMO_KEY) : undefined;
export const walletClient = demoAccount
  ? createWalletClient({
      account: demoAccount,
      chain: monadTestnet,
      transport: transport(),
    })
  : undefined;

// ------------------------------------------------- the visitor's own wallet

let injected: { client: WalletClient; address: Hex } | undefined;

function injectedProvider(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

/** Is there a browser wallet (window.ethereum) we could connect to? */
export function hasInjectedWallet(): boolean {
  return injectedProvider() !== undefined;
}

/**
 * Connect the visitor's browser wallet and switch it to Monad Testnet. From
 * then on sendExec() is signed by that wallet, so the leftover gas being burned
 * and the bounty coming back are the visitor's own. Throws if they decline.
 */
export async function connectInjected(): Promise<Hex> {
  const provider = injectedProvider();
  if (!provider) throw new Error("no browser wallet found");
  const client = createWalletClient({ chain: monadTestnet, transport: custom(provider) });
  const [address] = await client.requestAddresses();
  try {
    await client.switchChain({ id: monadTestnet.id });
  } catch {
    await client.addChain({ chain: monadTestnet });
    await client.switchChain({ id: monadTestnet.id });
  }
  injected = { client, address };
  return address;
}

/** Go back to the built-in demo account. */
export function switchToDemoAccount(): void {
  injected = undefined;
}

export function usingOwnWallet(): boolean {
  return injected !== undefined;
}

/** The address transactions are currently sent from. */
export function activeAddress(): Hex | undefined {
  return injected?.address ?? demoAccount?.address;
}

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

// ------------------------------------------------------------ the gas oracle

export type Suggestion = {
  /** Gas limit the oracle suggests for sending this call directly; 0 if never measured. */
  gasLimit: number;
  /** Largest real usage of this function measured on-chain so far. */
  maxUsed: number;
  /** Most recent measurement. */
  lastUsed: number;
  /** How many times this function has been measured. */
  samples: number;
};

/** Ask the on-chain oracle what gas limit this call needs. */
export async function readSuggestion(call: CallKind): Promise<Suggestion> {
  const data = appCalldata(call);
  const selector = data.slice(0, 10) as Hex;
  const ab = { address: ADDR.afterburner, abi: afterburnerAbi } as const;
  const [gasLimit, stat] = await Promise.all([
    publicClient.readContract({ ...ab, functionName: "suggestTxGasLimit", args: [ADDR.demoApp, data] }),
    publicClient.readContract({ ...ab, functionName: "stats", args: [ADDR.demoApp, selector] }),
  ]);
  return { gasLimit: Number(gasLimit), lastUsed: Number(stat[0]), maxUsed: Number(stat[1]), samples: stat[3] };
}

export type DirectTx = {
  hash: Hex;
  gasLimit: number;
  gasPrice: bigint;
  fee: bigint;
  status: "success" | "reverted";
};

/** Send the call straight to the app (not through Backdraft) with the given gas limit. */
export async function sendDirect(call: CallKind, gasLimit: number, fees: Fees): Promise<DirectTx> {
  const request = {
    to: ADDR.demoApp,
    data: appCalldata(call),
    gas: BigInt(gasLimit),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  } as const;
  let hash: Hex;
  if (injected) {
    hash = await injected.client.sendTransaction({ ...request, account: injected.address, chain: monadTestnet });
  } else {
    if (!walletClient || !demoAccount) throw new Error("no demo account configured");
    hash = await walletClient.sendTransaction(request);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return {
    hash,
    gasLimit,
    gasPrice: receipt.effectiveGasPrice,
    fee: BigInt(gasLimit) * receipt.effectiveGasPrice,
    status: receipt.status,
  };
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
  /** What this transaction wrote to the gas oracle (null if nothing was recorded). */
  recorded: { gasUsed: number; samples: number } | null;
};

export async function sendExec(call: CallKind, gasLimit: number, fees: Fees): Promise<SentTx> {
  const request = {
    to: ADDR.afterburner,
    data: execCalldata(call),
    gas: BigInt(gasLimit),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  } as const;
  let hash: Hex;
  if (injected) {
    hash = await injected.client.sendTransaction({ ...request, account: injected.address, chain: monadTestnet });
  } else {
    if (!walletClient || !demoAccount) throw new Error("no demo account configured");
    hash = await walletClient.sendTransaction(request);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return decodeReceipt(receipt, gasLimit);
}

export function decodeReceipt(receipt: TransactionReceipt, gasLimit: number): SentTx {
  const logs = parseEventLogs({ abi: afterburnerAbi, logs: receipt.logs });
  const burned = logs.find((l) => l.eventName === "Burned");
  const runs = logs.filter((l) => l.eventName === "JobRan");
  const rec = logs.find((l) => l.eventName === "Recorded");
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
    recorded: rec && rec.eventName === "Recorded" ? { gasUsed: Number(rec.args.gasUsed), samples: Number(rec.args.samples) } : null,
    jobRuns: runs.map((r) =>
      r.eventName === "JobRan"
        ? { id: Number(r.args.id), gasUsed: Number(r.args.gasUsed), units: Number(r.args.units), bounty: r.args.bounty }
        : { id: 0, gasUsed: 0, units: 0, bounty: 0n },
    ),
  };
}

/**
 * How much of the gas a transaction reserved actually got executed.
 * `before` is what the same call would have used if sent directly (pass the
 * result of estimateDirect; for a call that reverts we fall back to the
 * measured call gas plus the 21,000 base cost). `after` is what was executed
 * once the leftover had been burned on jobs.
 */
export function utilization(
  tx: Pick<SentTx, "gasLimit" | "gasLeft" | "mainGas">,
  directEstimate: number | null,
): { before: number; after: number } {
  const direct = directEstimate ?? tx.mainGas + 21_000;
  return {
    before: Math.min(1, direct / tx.gasLimit),
    after: Math.min(1, (tx.gasLimit - tx.gasLeft) / tx.gasLimit),
  };
}

export const fmtGas = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtMon = (wei: bigint, digits = 5) => (Number(wei) / 1e18).toFixed(digits);
