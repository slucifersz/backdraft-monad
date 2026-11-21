#!/usr/bin/env node
// Backdraft command line. Runs with plain Node 22.18+ / 24 (no build step):
//
//   node --env-file=.env.local scripts/backdraft.ts status
//   node --env-file=.env.local scripts/backdraft.ts sim  --to 0x.. --data 0x.. --gas 300000
//   node --env-file=.env.local scripts/backdraft.ts send --to 0x.. --data 0x.. --gas 300000
//   node --env-file=.env.local scripts/backdraft.ts send --crunch 8 --gas 300000      (demo app)
//   node --env-file=.env.local scripts/backdraft.ts send --sold-out --gas 300000      (a call that fails)
//
// The signing key is read from BACKDRAFT_KEY (or NEXT_PUBLIC_DEMO_KEY). Every
// command prints one JSON object on stdout so an agent can parse it.
import type { Hex } from "viem";
import { ADDR, appCalldata } from "../src/lib/chain.ts";
import { send, simulate, status } from "./ops.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (argv[i + 1] ?? "");
};
const has = (name: string) => argv.includes(`--${name}`);

function target() {
  const gas = Number(flag("gas") ?? 300_000);
  const from = flag("from") as Hex | undefined;
  if (has("crunch")) return { to: ADDR.demoApp as Hex, data: appCalldata({ kind: "crunch", n: Number(flag("crunch")) }), gas, from };
  if (has("sold-out")) return { to: ADDR.demoApp as Hex, data: appCalldata({ kind: "soldOut" }), gas, from };
  const to = flag("to") as Hex | undefined;
  if (!to) throw new Error("need --to <address> (or --crunch <n> / --sold-out for the demo app)");
  return { to, data: (flag("data") ?? "0x") as Hex, gas, from };
}

const commands: Record<string, () => Promise<unknown>> = {
  status,
  sim: () => simulate(target()),
  send: () => send(target()),
};

if (!cmd || !commands[cmd]) {
  console.error("usage: backdraft.ts <status|sim|send> [--to 0x.. --data 0x.. | --crunch <n> | --sold-out] [--gas <limit>]");
  process.exit(1);
}
commands[cmd]()
  .then((out) => console.log(JSON.stringify(out, null, 2)))
  .catch((e) => {
    console.error(e.shortMessage ?? e.message ?? e);
    process.exit(1);
  });
