#!/usr/bin/env node
// Backdraft MCP server (stdio). Lets an agent ask "is this transaction worth
// recycling?" before it sends, and send through Backdraft when it is.
//
//   node --env-file=.env.local scripts/mcp.ts
//
// Tools:
//   backdraft_status    queue, running totals, state of the on-chain model
//   backdraft_simulate  dry-run a call with a given gas limit (sends nothing)
//   backdraft_send      send the call through Backdraft (needs BACKDRAFT_KEY)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "viem";
import { z } from "zod";
import { send, simulate, status } from "./ops.ts";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "a 20-byte hex address");
const hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "hex-encoded bytes");
const gas = z.number().int().min(21_000).max(30_000_000);

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e) }],
});

const server = new McpServer({ name: "backdraft", version: "0.1.0" });

server.registerTool(
  "backdraft_status",
  {
    title: "Backdraft status",
    description:
      "Read the Backdraft job queue on Monad Testnet: which jobs are waiting, what they pay per gas, how much gas has been recycled so far, and how far the on-chain gas model has been trained.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      return text(await status());
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "backdraft_simulate",
  {
    title: "Simulate a call through Backdraft",
    description:
      "Dry-run a contract call through Backdraft with exactly the gas limit you intend to use. Nothing is sent. On Monad the full gas limit is charged, so use this before sending: it reports how much gas your own call needs, how much leftover would be recycled into job work, and how much of the fee would come back as bounty. If worthRecycling is false, send the call directly with a tight limit instead.",
    inputSchema: {
      to: address.describe("Contract to call"),
      data: hex.default("0x").describe("Calldata for that contract"),
      gas: gas.describe("Gas limit you intend to set"),
      from: address.optional().describe("Sender address (defaults to the configured signer)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ to, data, gas, from }) => {
    try {
      return text(await simulate({ to: to as Hex, data: data as Hex, gas, from: from as Hex | undefined }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "backdraft_send",
  {
    title: "Send a call through Backdraft",
    description:
      "Send a contract call through Backdraft on Monad Testnet using the configured signer. After your call finishes, leftover gas is spent on queued jobs and the bounty is paid to the signer. Returns the real split of the gas limit (the receipt only shows the limit). Do not use this when the target contract depends on who the caller is: inside Backdraft the caller is the Backdraft contract. Always run backdraft_simulate first.",
    inputSchema: {
      to: address.describe("Contract to call"),
      data: hex.default("0x").describe("Calldata for that contract"),
      gas: gas.describe("Gas limit to set"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ to, data, gas }) => {
    try {
      return text(await send({ to: to as Hex, data: data as Hex, gas }));
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
