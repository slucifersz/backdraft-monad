"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { activeAddress, currentFees, fmtGas, sendExec, usingOwnWallet } from "@/lib/chain";
import { REPLAY, type Measure, type OptionKey } from "./replay";

export type Phase = "idle" | "sending" | "grow" | "done";
export type Mode = "live" | "replay";

export const SEND_TIMEOUT_MS = 25_000;
export const WALLET_TIMEOUT_MS = 90_000;
export const CALL = { kind: "crunch", n: 8 } as const;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const mon = (n: number) => n.toFixed(5);
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 记录与固定开销 = 上限 − 真实用量 − 没用上。 */
export const overheadOf = (m: Pick<Measure, "gasLimit" | "mainGas" | "gasLeft">) =>
  Math.max(0, m.gasLimit - m.mainGas - m.gasLeft);

export function useCountUp(target: number, run: boolean, ms = 700, from = 0) {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (!run || prefersReducedMotion()) {
      setV(target);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - t0) / ms);
      setV(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms, from]);
  return v;
}

export type Burn = ReturnType<typeof useMeasure>;

/** 一笔交易经过 Backdraft：发出（或回放）→ 紫色段长出来 → 停住。 */
export function useMeasure(cfg: { lock: RefObject<boolean>; mode: Mode; onDone?: (r: Measure) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Measure | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const alive = useRef(true);
  const latest = useRef(cfg);
  latest.current = cfg;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== "sending") return;
    const t0 = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => clearInterval(timer);
  }, [phase]);

  const reset = useCallback(() => {
    if (latest.current.lock.current) return;
    setPhase("idle");
    setResult(null);
    setNotice(null);
  }, []);

  const run = useCallback(async (replayKey: OptionKey, gasLimit: number) => {
    const { lock, mode, onDone } = latest.current;
    if (lock.current) return;
    lock.current = true;
    const reduced = prefersReducedMotion();
    setNotice(null);
    setResult(null);
    setElapsed(0);
    setPhase("sending");

    let res: Measure | null = null;
    if (mode === "live" && activeAddress()) {
      const own = usingOwnWallet();
      try {
        const fees = await currentFees();
        const tx = await timeout(sendExec(CALL, gasLimit, fees), own ? WALLET_TIMEOUT_MS : SEND_TIMEOUT_MS);
        if (tx.status !== "success") throw new Error("reverted");
        res = {
          source: "live",
          gasLimit,
          mainGas: tx.mainGas,
          gasLeft: tx.gasLeft,
          approx: false,
          receiptGasUsed: tx.receiptGasUsed,
          feeMon: Number(tx.fee) / 1e18,
          samples: tx.recorded ? tx.recorded.samples : null,
          hash: tx.hash,
        };
      } catch {
        if (own) {
          // 访客自己的钱包：拒绝或余额不足时不回放，回到待发状态。
          setNotice("你的钱包没有发出这笔交易（已拒绝、余额不足或超时）。");
          setPhase("idle");
          lock.current = false;
          return;
        }
        setNotice("实时发送失败或超时，已切到回放 · 真实交易记录");
      }
    }
    if (!res) {
      await sleep(reduced ? 0 : 1300);
      res = REPLAY[replayKey];
    }
    if (!alive.current) {
      lock.current = false;
      return;
    }

    setResult(res);
    setPhase("grow");
    await sleep(reduced ? 0 : 2100);
    setPhase("done");
    setRound((r) => r + 1);
    lock.current = false;
    onDone?.(res);
  }, []);

  return { phase, result, elapsed, notice, round, running: phase === "sending" || phase === "grow", run, reset };
}

/**
 * 三段长条，总长是 gas 上限：真实用量（紫）｜记录与固定开销（橙）｜没用上（斜线）。
 * 没有结果时只画出上限的外框。
 */
export function MeterBar({ result, limit, sending }: { result: Measure | null; limit: number; sending?: boolean }) {
  if (!result) {
    return (
      <div className="bd-bar bdm-bar empty" role="img" aria-label={`gas 上限 ${fmtGas(limit)}，还没有量`}>
        <div className={`bdm-void${sending ? " bd-hatch drift" : ""}`}>
          <span>{sending ? `已经按 ${fmtGas(limit)} 付了钱` : `gas 上限 ${fmtGas(limit)}`}</span>
        </div>
      </div>
    );
  }
  const over = overheadOf(result);
  const w = (n: number) => `${(n / result.gasLimit) * 100}%`;
  return (
    <div
      key={result.hash}
      className="bd-bar bdm-bar"
      role="img"
      aria-label={`上限 ${fmtGas(result.gasLimit)}，真实用了 ${fmtGas(result.mainGas)}`}
    >
      <div className="bdm-call" style={{ width: w(result.mainGas) }} />
      <div className="bdm-rec" style={{ width: w(over) }} />
      <div className="bdm-left bd-hatch" />
    </div>
  );
}

const approxGas = (n: number) => `约 ${fmtGas(Math.round(n / 1000) * 1000)}`;

export function MeterLegend({ result }: { result: Measure | null }) {
  const dim = result ? "" : " dim";
  return (
    <div className="bd-legend three">
      <div className={`call${dim}`}>
        <span>真实用量</span>
        <b>{result ? fmtGas(result.mainGas) : "—"}</b>
      </div>
      <div className={`job${dim}`}>
        <span>记录与固定开销</span>
        <b>{result ? (result.approx ? approxGas(overheadOf(result)) : fmtGas(overheadOf(result))) : "—"}</b>
      </div>
      <div className={`left${dim}`}>
        <span>没用上{result?.approx ? "（回放，近似）" : ""}</span>
        <b>{result ? (result.approx ? approxGas(result.gasLeft) : fmtGas(result.gasLeft)) : "—"}</b>
      </div>
    </div>
  );
}
