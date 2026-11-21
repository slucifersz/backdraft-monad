"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  activeAddress,
  currentFees,
  estimateDirect,
  fmtGas,
  publicClient,
  sendExec,
  usingOwnWallet,
  utilization,
  type CallKind,
} from "@/lib/chain";
import { REPLAY, type BurnResult } from "./replay";

export type Phase = "idle" | "sending" | "call" | "burn" | "done";
export type Mode = "live" | "replay";
export type Util = { before: number; after: number };
export type Prediction = { mainGas: number; jobGas: number; units: number; bountyMon: number };

// crunch(8) 直接发出时需要的 gas（数据集里 n=8 的实测值），用于回放记录的利用率。
const DIRECT_CRUNCH8 = 74081;
const SEND_TIMEOUT_MS = 25_000;
const WALLET_TIMEOUT_MS = 90_000;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const trainSteps = (units: number) => Math.max(0, units - 1);
export const mon = (n: number) => n.toFixed(5);
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
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

export function replayUtil(r: BurnResult): Util {
  return utilization(r, r.mainOk ? DIRECT_CRUNCH8 : null);
}

export function useCountUp(target: number, run: boolean, ms = 700) {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (!run || prefersReducedMotion()) {
      setV(target);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - t0) / ms);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

export type Burn = ReturnType<typeof useBurn>;

/** One transaction's life: send (or replay) → your call → burn cell by cell → done. */
export function useBurn(cfg: {
  lock: RefObject<boolean>;
  mode: Mode;
  initial?: BurnResult;
  onDone?: (r: BurnResult) => void;
}) {
  const [phase, setPhase] = useState<Phase>(cfg.initial ? "done" : "idle");
  const [result, setResult] = useState<BurnResult | null>(cfg.initial ?? null);
  const [util, setUtil] = useState<Util | null>(cfg.initial ? replayUtil(cfg.initial) : null);
  const [lit, setLit] = useState(cfg.initial?.units ?? 0);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [balBefore, setBalBefore] = useState<bigint | null>(null);
  const [balAfter, setBalAfter] = useState<bigint | null>(null);
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
    setUtil(null);
    setLit(0);
    setNotice(null);
  }, []);

  const run = useCallback(async (kind: "normal" | "fail", replayKey: keyof typeof REPLAY, gasLimit: number) => {
    const { lock, mode, onDone } = latest.current;
    if (lock.current) return;
    lock.current = true;
    const reduced = prefersReducedMotion();
    setNotice(null);
    setResult(null);
    setUtil(null);
    setLit(0);
    setElapsed(0);
    setBalBefore(null);
    setBalAfter(null);
    setPhase("sending");

    let res: BurnResult | null = null;
    let u: Util | null = null;
    const from = activeAddress();
    if (mode === "live" && from) {
      const own = usingOwnWallet();
      try {
        const call: CallKind = kind === "fail" ? { kind: "soldOut" } : { kind: "crunch", n: 8 };
        const [fees, before, direct] = await Promise.all([
          currentFees(),
          publicClient.getBalance({ address: from }),
          estimateDirect(call, from),
        ]);
        const tx = await timeout(sendExec(call, gasLimit, fees), own ? WALLET_TIMEOUT_MS : SEND_TIMEOUT_MS);
        if (tx.status !== "success") throw new Error("reverted");
        res = {
          source: "live",
          gasLimit,
          mainOk: tx.mainOk,
          mainGas: tx.mainGas,
          jobGas: tx.jobGas,
          units: tx.units,
          gasLeft: tx.gasLeft,
          feeMon: Number(tx.fee) / 1e18,
          bountyMon: Number(tx.bounty) / 1e18,
          hash: tx.hash,
        };
        u = utilization(tx, direct);
        setBalBefore(before);
        setTimeout(() => {
          publicClient
            .getBalance({ address: from })
            .then((b) => alive.current && setBalAfter(b))
            .catch(() => undefined);
        }, 1500);
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
      u = replayUtil(res);
    }
    if (!alive.current) {
      lock.current = false;
      return;
    }

    setResult(res);
    setUtil(u);
    setPhase("call");
    await sleep(reduced ? 0 : 900);
    if (res.units > 0 && !reduced) {
      setPhase("burn");
      const stepMs = Math.min(120, Math.max(55, 2200 / res.units));
      for (let i = 1; i <= res.units; i++) {
        if (!alive.current) break;
        setLit(i);
        await sleep(stepMs);
      }
      await sleep(260);
    } else {
      setLit(res.units);
    }
    setPhase("done");
    setRound((r) => r + 1);
    lock.current = false;
    onDone?.(res);
  }, []);

  return {
    phase,
    result,
    util,
    lit,
    elapsed,
    notice,
    balBefore,
    balAfter,
    round,
    running: phase !== "idle" && phase !== "done",
    run,
    reset,
  };
}

/** The gas-limit bar: your call | burned cells | still unused | fixed overhead. */
export function GasBar({
  result,
  lit,
  limit,
  sending,
  pred,
}: {
  result: BurnResult | null;
  lit: number;
  limit: number;
  sending?: boolean;
  pred?: Prediction | null;
}) {
  if (result) {
    const overhead = result.gasLimit - result.mainGas - result.jobGas - result.gasLeft;
    return (
      <div className="bd-bar" role="img" aria-label={`gas 上限 ${fmtGas(result.gasLimit)} 的去向`}>
        <div className="bd-seg bd-seg-call" style={{ flexGrow: result.mainGas }}>
          {result.mainOk ? "" : "✕"}
        </div>
        {result.jobGas > 0 && (
          <div className="bd-seg bd-seg-job" style={{ flexGrow: result.jobGas }}>
            {Array.from({ length: result.units }, (_, i) => (
              <i key={i} className={`bd-cell bd-hatch${i < lit ? " lit" : ""}`} />
            ))}
          </div>
        )}
        <div className="bd-seg bd-hatch" style={{ flexGrow: result.gasLeft }} />
        <div className="bd-seg bd-seg-over" style={{ flexGrow: overhead }} />
      </div>
    );
  }
  // 发送前：按预测画虚线分段；发送中：紫色段先填上，后面闷烧。
  const main = pred?.mainGas ?? 0;
  const job = pred?.jobGas ?? 0;
  const rest = Math.max(0, limit - main - job);
  return (
    <div className="bd-bar ghost" role="img" aria-label={`gas 上限 ${fmtGas(limit)}，发送前的预测`}>
      {main > 0 && (
        <div className={`bd-seg bd-ghost-call${sending ? " filled" : ""}`} style={{ flexGrow: main }}>
          <span>你的调用</span>
        </div>
      )}
      {job > 0 && (
        <div className={`bd-seg bd-ghost-job bd-hatch${sending ? " drift" : ""}`} style={{ flexGrow: job }}>
          <span>{sending ? "已经付了钱，等着被点燃" : `预测可点燃 ${fmtGas(job)}`}</span>
        </div>
      )}
      <div className={`bd-seg bd-hatch${sending ? " drift" : ""}`} style={{ flexGrow: rest || 1 }}>
        {main === 0 && <span>gas 上限 {fmtGas(limit)}</span>}
      </div>
    </div>
  );
}

export function Legend({ result }: { result: BurnResult | null }) {
  const overhead = result ? result.gasLimit - result.mainGas - result.jobGas - result.gasLeft : 0;
  const dim = result ? "" : " dim";
  return (
    <div className="bd-legend">
      <div className={`call${dim}`}>
        <span>你的调用{result && !result.mainOk ? "（失败）" : ""}</span>
        <b>{result ? fmtGas(result.mainGas) : "—"}</b>
      </div>
      <div className={`job${dim}`}>
        <span>
          被点燃
          {result && result.units > 0 ? ` · ${trainSteps(result.units)} 步训练 + 1 次心跳` : ""}
        </span>
        <b>{result ? fmtGas(result.jobGas) : "—"}</b>
      </div>
      <div className={`left${dim}`}>
        <span>仍未用到</span>
        <b>{result ? fmtGas(result.gasLeft) : "—"}</b>
      </div>
      <div className={`over${dim}`}>
        <span>固定开销</span>
        <b>{result ? fmtGas(overhead) : "—"}</b>
      </div>
    </div>
  );
}

/**
 * 整屏一起烧：点燃时橙色一列一列从左到右烧过整个屏幕（和长条的格子同步），
 * 烧完整屏反成橙底，一个大数字占满屏幕，停一拍再落回版面。
 */
export function BurnOverlay({ burn, figure, caption }: { burn: Burn; figure: string; caption: string }) {
  const [climax, setClimax] = useState(false);
  const seen = useRef(burn.round);
  useEffect(() => {
    if (burn.round === seen.current) return;
    seen.current = burn.round;
    if (prefersReducedMotion()) return;
    setClimax(true);
    const t = setTimeout(() => setClimax(false), 1800);
    return () => clearTimeout(t);
  }, [burn.round]);

  const r = burn.result;
  if (!r || r.jobGas <= 0) return null;
  if (burn.phase === "burn") {
    return (
      <div className="bd-wall" aria-hidden="true">
        {Array.from({ length: r.units }, (_, i) => (
          <i key={i} className={i < burn.lit ? "lit" : ""} />
        ))}
      </div>
    );
  }
  if (climax && burn.phase === "done") {
    return (
      <div className="bd-climax" aria-hidden="true">
        <div className="bd-climax-fig">{figure}</div>
        <div className="bd-climax-cap">{caption}</div>
      </div>
    );
  }
  return null;
}
