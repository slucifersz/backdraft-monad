"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  activeAddress,
  currentFees,
  estimateDirect,
  EXPLORER,
  fmtGas,
  readSuggestion,
  sendDirect,
  usingOwnWallet,
  type Suggestion,
} from "@/lib/chain";
import {
  CALL,
  SEND_TIMEOUT_MS,
  WALLET_TIMEOUT_MS,
  prefersReducedMotion,
  sleep,
  timeout,
  useCountUp,
  type Mode,
} from "./burn";
import { REPLAY, REPLAY_READ, shortHash, type Measure } from "./replay";

const SCALE = 500000; // 两根长条共用的比例尺：满宽 = 500,000 gas
const SHRINK_MS = 1900;

type Tight = {
  source: "live" | "replay";
  hash: string;
  gasLimit: number;
  feeMon: number;
  /** estimateDirect 的返回值：这笔调用直接发需要多少（估算）。 */
  est: number | null;
};
type Phase = "idle" | "sending" | "shrink" | "done";

const fee = (n: number) => n.toFixed(4);

/** 第 5 版 · 读：读一次链上的建议值，按它直接发一笔，和写死的那一笔上下对比。 */
export default function ReadSheet({
  active,
  lock,
  mode,
  loose,
  round,
}: {
  active: boolean;
  lock: RefObject<boolean>;
  mode: Mode;
  /** 本场在第 4 版用上限 500,000 实时发过的那一笔；没有就用今天下午的真实交易。 */
  loose: Measure | null;
  round: number;
}) {
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [sugSource, setSugSource] = useState<"live" | "replay">("live");
  const [phase, setPhase] = useState<Phase>("idle");
  const [tight, setTight] = useState<Tight | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 进入这一版时读一次链上的建议值；第 4 版每量完一笔，再读一次。
  useEffect(() => {
    if (!active) return;
    let off = false;
    if (mode !== "live") {
      setSug(REPLAY_READ.suggestion);
      setSugSource("replay");
      return;
    }
    readSuggestion(CALL)
      .then((s) => {
        if (off) return;
        setSug(s);
        setSugSource("live");
      })
      .catch(() => {
        if (off) return;
        setSug(REPLAY_READ.suggestion);
        setSugSource("replay");
      });
    return () => {
      off = true;
    };
  }, [active, mode, round]);

  useEffect(() => {
    if (phase !== "sending") return;
    const t0 = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => clearInterval(timer);
  }, [phase]);

  const first = loose ?? REPLAY.h500;
  const empty = sug !== null && sug.samples === 0;
  const busy = phase === "sending" || phase === "shrink";

  const run = async () => {
    if (lock.current || !sug || sug.gasLimit === 0) return;
    lock.current = true;
    const reduced = prefersReducedMotion();
    setNotice(null);
    setTight(null);
    setElapsed(0);
    setPhase("sending");

    let res: Tight | null = null;
    const from = activeAddress();
    if (mode === "live" && sugSource === "live" && from) {
      const own = usingOwnWallet();
      try {
        const [fees, est] = await Promise.all([currentFees(), estimateDirect(CALL, from)]);
        const tx = await timeout(sendDirect(CALL, sug.gasLimit, fees), own ? WALLET_TIMEOUT_MS : SEND_TIMEOUT_MS);
        if (tx.status !== "success") throw new Error("reverted");
        res = { source: "live", hash: tx.hash, gasLimit: tx.gasLimit, feeMon: Number(tx.fee) / 1e18, est };
      } catch {
        if (own) {
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
      res = {
        source: "replay",
        hash: REPLAY_READ.hash,
        gasLimit: REPLAY_READ.gasLimit,
        feeMon: REPLAY_READ.feeMon,
        est: REPLAY_READ.directEstimate,
      };
    }
    if (!alive.current) {
      lock.current = false;
      return;
    }
    setTight(res);
    setPhase("shrink");
    await sleep(reduced ? 0 : SHRINK_MS + 500);
    setPhase("done");
    lock.current = false;
  };

  // 回放的第二笔要和回放的第一笔比（同一天下午的两笔真实交易）。
  const base = tight?.source === "replay" ? REPLAY.h500 : first;
  const saved = tight ? Math.max(0, 1 - tight.feeMon / base.feeMon) : 0;
  const limitNow = useCountUp(tight?.gasLimit ?? SCALE, phase === "shrink", SHRINK_MS, SCALE);
  const savedNow = useCountUp(saved * 100, phase === "done", 600);
  const w = (n: number) => `${Math.min(100, (n / SCALE) * 100)}%`;

  return (
    <section className="bd-screen" id="s5" aria-label="读">
      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>读</span>
        </div>
        <div className="bd-meta">
          {tight ? (
            <>
              {tight.source === "replay" && <span className="bd-notice">回放 · 真实交易记录</span>}
              <a href={`${EXPLORER}/tx/${tight.hash}`} target="_blank" rel="noreferrer">
                交易 {shortHash(tight.hash)} ↗
              </a>
            </>
          ) : (
            <span>suggestTxGasLimit(target, data) · 读一次链</span>
          )}
        </div>
      </header>

      <div className="bdr-head">
        <div>
          <h2 className="bd-headline xl">下一笔，照着设。</h2>
          {empty ? (
            <p className="bdr-reading">
              链上还没有这类调用的记录。<a href="#s4">先去第 4 版量一笔。</a>
            </p>
          ) : (
            <p className="bdr-reading">
              <span className="bd-tag solid">实测</span>
              {sug ? (
                <>
                  链上记了 <b>{sug.samples}</b> 次 · 这类调用最多用过 <b>{fmtGas(sug.maxUsed)}</b> gas · 建议上限{" "}
                  <b className="hot">{fmtGas(sug.gasLimit)}</b>
                  {sugSource === "replay" && <span className="bd-note">回放 · 今天下午的读数</span>}
                </>
              ) : (
                <>正在读链上的建议值…</>
              )}
            </p>
          )}
        </div>
        <div className="bdr-act">
          <button type="button" className="bd-btn fire" disabled={busy || !sug || sug.gasLimit === 0} onClick={run}>
            {phase === "sending" ? `已发出 ${elapsed.toFixed(1)} s` : phase === "done" ? "再按建议发一笔" : "按链上建议直接发"}
          </button>
          <span className="bd-note">
            {notice ?? "这一笔不经过 Backdraft，直接发给应用，上限用的就是链上给的那个数。"}
          </span>
        </div>
      </div>

      <div className="bdr-compare">
        <div className="bdr-row">
          <div className="bdr-label">
            <b>写死的那一笔</b>
            <span>
              {base.source === "replay" ? "今天下午的真实交易" : "刚才在第 4 版发的"} ·{" "}
              <a href={`${EXPLORER}/tx/${base.hash}`} target="_blank" rel="noreferrer">
                {shortHash(base.hash)} ↗
              </a>
            </span>
          </div>
          <div className="bdr-track">
            <div className="bdr-bar" style={{ width: w(base.gasLimit) }}>
              <i className="call" style={{ width: `${(base.mainGas / SCALE) * 100}cqw` }} />
              <i className="left bd-hatch" />
            </div>
          </div>
          <dl className="bdr-nums">
            <div>
              <dt>上限</dt>
              <dd>{fmtGas(base.gasLimit)}</dd>
            </div>
            <div>
              <dt>真实用量</dt>
              <dd>{fmtGas(base.mainGas)}</dd>
            </div>
            <div>
              <dt>手续费</dt>
              <dd>{fee(base.feeMon)} MON</dd>
            </div>
          </dl>
        </div>

        <div className="bdr-row">
          <div className="bdr-label">
            <b>按链上建议的这一笔</b>
            <span>{tight ? "直接发给应用，没有经过 Backdraft" : "还没有发。如果照旧写死，它会和上面一样长。"}</span>
          </div>
          <div className="bdr-track">
            {tight ? (
              <>
                <div className="bdr-was" aria-hidden="true">
                  <span>少申请了 {fmtGas(SCALE - tight.gasLimit)} gas，这部分不用再付钱</span>
                </div>
                <div className="bdr-bar shrink" style={{ width: w(tight.gasLimit) }}>
                  <i className="call" style={{ width: `${((tight.est ?? tight.gasLimit) / SCALE) * 100}cqw` }} />
                  <i className="left bd-hatch" />
                </div>
              </>
            ) : (
              <div className={`bdr-bar ghost${phase === "sending" ? " bd-hatch drift" : ""}`} style={{ width: "100%" }}>
                <span>{phase === "sending" ? "已发出，等待上链" : "下一笔"}</span>
              </div>
            )}
          </div>
          <dl className="bdr-nums">
            <div>
              <dt>上限</dt>
              <dd className={tight ? "hot" : ""}>
                {tight ? fmtGas(phase === "shrink" ? limitNow : tight.gasLimit) : "—"}
              </dd>
            </div>
            <div>
              <dt>
                真实用量 <em>估算</em>
              </dt>
              <dd>{tight ? (tight.est ? `约 ${fmtGas(tight.est)}` : "—") : "—"}</dd>
            </div>
            <div>
              <dt>手续费</dt>
              <dd>{tight ? `${fee(tight.feeMon)} MON` : "—"}</dd>
            </div>
          </dl>
        </div>
        <p className="bds-small">
          两根长条用同一个比例尺：满宽是 500,000 gas。下面那根的紫色段是 estimateDirect() 的估算（直接发的交易回执只给上限）；上限和手续费是回执里的精确值。
        </p>
      </div>

      <div className="bdr-result" aria-live="polite">
        {phase === "done" && tight ? (
          <div className="bdr-saved bd-slam">
            <span>手续费省了</span>
            <b>{Math.round(savedNow)}%</b>
            <span className="bd-tag solid">实测</span>
          </div>
        ) : (
          <div className="bdr-saved pending" aria-hidden="true">
            <span>手续费省了</span>
            <b>?</b>
          </div>
        )}
        <p className="bdr-line">
          第一笔教会了链。
          <br />
          之后的每一笔，
          <br />
          都不用再多付。
        </p>
      </div>
    </section>
  );
}
