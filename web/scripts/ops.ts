// Operations shared by the command line (backdraft.ts) and the MCP server (mcp.ts).
// Every function returns a plain JSON-serialisable object.
import { createWalletClient, encodeFunctionData, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import {
  ADDR,
  EXPLORER,
  RPC_URL,
  afterburnerAbi,
  currentFees,
  decodeReceipt,
  modelPredict,
  publicClient,
  readModel,
  readTotals,
} from "../src/lib/chain.ts";

export type CallTarget = { to: Hex; data: Hex; gas: number; from?: Hex };

export function signer() {
  const key = (process.env.BACKDRAFT_KEY ??
    process.env.AFTERBURNER_KEY ??
    process.env.NEXT_PUBLIC_DEMO_KEY) as Hex | undefined;
  if (!key) throw new Error("set BACKDRAFT_KEY to the private key that should send the transaction");
  return privateKeyToAccount(key);
}

const share = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 10_000n) / whole) / 10_000);

/** Queue, running totals and the state of the on-chain model. */
export async function status() {
  const [t, m] = await Promise.all([readTotals(), readModel()]);
  return {
    network: "Monad Testnet (10143)",
    backdraft: ADDR.afterburner,
    totals: {
      burns: t.burns,
      unitsOfWork: t.units,
      gasRecycled: t.gasRecycled,
      bountyPaidMon: formatEther(t.bountyPaid),
      heartbeats: t.beats,
    },
    jobs: t.jobs.map((j) => ({
      id: j.id,
      label: j.label,
      active: j.active,
      bountyPerGasGwei: Number(j.bountyPerGas) / 1e9,
      escrowMon: formatEther(j.escrow),
    })),
    gasModel: {
      address: ADDR.gasModel,
      steps: m.steps,
      loss: m.loss,
      predictedGasForN8: Math.round(modelPredict(m, 8)),
      measuredGasForN8: m.gases[m.ns.indexOf(8)],
    },
  };
}

/** Dry-run a call through Backdraft with exactly this gas limit. Sends nothing. */
export async function simulate({ to, data, gas, from }: CallTarget) {
  const sender = from ?? signer().address;
  const fees = await currentFees();
  const { result } = await publicClient.simulateContract({
    account: sender,
    address: ADDR.afterburner,
    abi: afterburnerAbi,
    functionName: "exec",
    args: [to, data],
    gas: BigInt(gas),
    gasPrice: fees.expected,
  });
  const fee = BigInt(gas) * fees.expected;
  return {
    simulated: true,
    gasLimit: gas,
    yourCallSucceeds: result[0],
    yourCallGas: Number(result[1]),
    recycledGas: Number(result[2]),
    unitsOfWork: Number(result[3]),
    feeMon: formatEther(fee),
    bountyMon: formatEther(result[4]),
    recoveredShareOfFee: share(result[4], fee),
    worthRecycling: result[2] > 0n,
  };
}

/** Send a call through Backdraft and report how the gas limit was really spent. */
export async function send({ to, data, gas }: CallTarget) {
  const acct = signer();
  const wallet = createWalletClient({ account: acct, chain: monadTestnet, transport: http(RPC_URL) });
  const fees = await currentFees();
  const before = await publicClient.getBalance({ address: acct.address });
  const hash = await wallet.sendTransaction({
    to: ADDR.afterburner,
    data: encodeFunctionData({ abi: afterburnerAbi, functionName: "exec", args: [to, data] }),
    gas: BigInt(gas),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  const tx = decodeReceipt(receipt, gas);
  await new Promise((r) => setTimeout(r, 1500)); // balances lag execution by a few blocks
  const after = await publicClient.getBalance({ address: acct.address });
  return {
    hash,
    explorer: `${EXPLORER}/tx/${hash}`,
    gasLimit: gas,
    receiptGasUsed: tx.receiptGasUsed, // equals the limit on Monad
    yourCallSucceeded: tx.mainOk,
    yourCallGas: tx.mainGas,
    recycledGas: tx.jobGas,
    unitsOfWork: tx.units,
    gasStillUnused: tx.gasLeft,
    feeMon: formatEther(tx.fee),
    bountyMon: formatEther(tx.bounty),
    recoveredShareOfFee: share(tx.bounty, tx.fee),
    balanceChangeMon: formatEther(after - before),
  };
}
