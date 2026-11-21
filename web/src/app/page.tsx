"use client";

import { useAccount, useBlockNumber, useConnect, useDisconnect } from "wagmi";
import { chain, EXPLORER_URL } from "@/lib/wagmi";

// Placeholder status page: proves the frontend can reach Monad testnet.
// Replace with the real app once the idea is fixed.
export default function Home() {
  const { data: blockNumber, isError } = useBlockNumber({ watch: true });
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold">Monad Blitz 广州</h1>

      <section className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
        <div className="flex justify-between">
          <span>网络</span>
          <span>
            {chain.name}（{chain.id}）
          </span>
        </div>
        <div className="mt-2 flex justify-between">
          <span>最新区块</span>
          <span className="font-mono tabular-nums">
            {isError ? "连接失败" : (blockNumber?.toString() ?? "…")}
          </span>
        </div>
      </section>

      <section className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
        {isConnected ? (
          <div className="flex items-center justify-between gap-3">
            <a
              className="truncate font-mono underline"
              href={`${EXPLORER_URL}/address/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              {address}
            </a>
            <button
              className="shrink-0 rounded-md border px-3 py-1.5"
              onClick={() => disconnect()}
            >
              断开
            </button>
          </div>
        ) : (
          <button
            className="rounded-md bg-black px-3 py-1.5 text-white disabled:opacity-50 dark:bg-white dark:text-black"
            disabled={isPending || connectors.length === 0}
            onClick={() => connect({ connector: connectors[0] })}
          >
            {isPending ? "连接中…" : "连接钱包"}
          </button>
        )}
      </section>
    </main>
  );
}
