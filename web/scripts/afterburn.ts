#!/usr/bin/env node
// Afterburner command line. Runs with plain Node 22.18+ / 24 (no build step):
//
//   node --env-file=.env.local scripts/afterburn.ts status
//   node --env-file=.env.local scripts/afterburn.ts sim  --to 0x.. --data 0x.. --gas 300000
//   node --env-file=.env.local scripts/afterburn.ts send --to 0x.. --data 0x.. --gas 300000
//   node --env-file=.env.local scripts/afterburn.ts send --crunch 8 --gas 300000      (demo app)
//   node --env-file=.env.local scripts/afterburn.ts send --sold-out --gas 300000      (a call that fails)
//
// The signing key is read from AFTERBURNER_KEY (or NEXT_PUBLIC_DEMO_KEY). Every
// command prints one JSON object on stdout so an agent can parse it.
import { createWalletClient, encodeFunctionData, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import {
  ADDR,
  EXPLORER,
  RPC_URL,
  afterburnerAbi,
  appCalldata,
  currentFees,
  decodeReceipt,
  modelPredict,
  publicClient,
  readModel,
  readTotals,
} from "../src/lib/chain.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (argv[i + 1] ?? "");
};
const has = (name: string) => argv.includes(`--${name}`);
const out = (o: unknown) =>
  console.log(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

function target(): { to: Hex; data: Hex } {
  if (has("crunch")) return { to: ADDR.demoApp, data: appCalldata({ kind: "crunch", n: Number(flag("crunch")) }) };
  if (has("sold-out")) return { to: ADDR.demoApp, data: appCalldata({ kind: "soldOut" }) };
  const to = flag("to") as Hex | undefined;
  if (!to) throw new Error("need --to <address> (or --crunch <n> / --sold-out for the demo app)");
  return { to, data: (flag("data") ?? "0x") as Hex };
}

function account() {
  const key = (process.env.AFTERBURNER_KEY ?? process.env.NEXT_PUBLIC_DEMO_KEY) as Hex | undefined;
  if (!key) throw new Error("set AFTERBURNER_KEY to the private key that should send the transaction");
  return privateKeyToAccount(key);
}

async function status() {
  const [t, m] = await Promise.all([readTotals(), readModel()]);
  out({
    afterburner: ADDR.afterburner,
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
  });
}

async function sim() {
  const { to, data } = target();
  const gas = Number(flag("gas") ?? 300_000);
  const from = (flag("from") as Hex | undefined) ?? account().address;
  const fees = await currentFees();
  const { result } = await publicClient.simulateContract({
    account: from,
    address: ADDR.afterburner,
    abi: afterburnerAbi,
    functionName: "exec",
    args: [to, data],
    gas: BigInt(gas),
    gasPrice: fees.expected,
  });
  const fee = BigInt(gas) * fees.expected;
  out({
    simulated: true,
    gasLimit: gas,
    yourCallSucceeds: result[0],
    yourCallGas: Number(result[1]),
    recycledGas: Number(result[2]),
    unitsOfWork: Number(result[3]),
    feeMon: formatEther(fee),
    bountyMon: formatEther(result[4]),
    recoveredShareOfFee: Number((result[4] * 10_000n) / fee) / 10_000,
  });
}

async function send() {
  const { to, data } = target();
  const gas = Number(flag("gas") ?? 300_000);
  const acct = account();
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
  out({
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
    recoveredShareOfFee: Number((tx.bounty * 10_000n) / tx.fee) / 10_000,
    balanceChangeMon: formatEther(after - before),
  });
}

const commands: Record<string, () => Promise<void>> = { status, sim, send };
if (!cmd || !commands[cmd]) {
  console.error("usage: afterburn.ts <status|sim|send> [--to 0x.. --data 0x.. | --crunch <n> | --sold-out] [--gas <limit>]");
  process.exit(1);
}
commands[cmd]().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
