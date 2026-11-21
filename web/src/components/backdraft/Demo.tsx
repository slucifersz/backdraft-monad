"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  currentFees,
  demoAccount,
  EXPLORER,
  fmtGas,
  fmtMon,
  publicClient,
  sendExec,
  simulateExec,
  type CallKind,
} from "@/lib/chain";
import { REPLAY, shortAddr, shortHash, type BurnResult, type OptionKey } from "./replay";

const OPTIONS: { key: OptionKey; name: string; note: string; gasLimit: number }[] = [
  { key: "official", name: "官方建议", note: "估算 +7.5%", gasLimit: 114037 },
  { key: "wallet", name: "钱包默认", note: "估算 ×1.5", gasLimit: 159121 },
  { key: "h300", name: "写死", note: "脚本和机器人常见", gasLimit: 300000 },
  { key: "h500", name: "写死", note: "主网常见的整数上限", gasLimit: 500000 },
];
const FAIL_GAS_LIMIT = 300000;
const DEMO_ADDRESS = demoAccount?.address ?? "0x4BF0C46573d5a033B55BA561f32f60Df13833345";
const MIN_BALANCE = 60_000_000_000_000_000n; // 0.06 MON
const SEND_TIMEOUT_MS = 25_000;

type Phase = "idle" | "sending" | "call" | "burn" | "done";
type Mode = "live" | "replay";
type Prediction = { jobGas: number; units: number; bountyMon: number };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const steps = (units: number) => Math.max(0, units - 1);
const mon = (n: number) => n.toFixed(5);

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

function useCountUp(target: number, run: boolean, ms = 700) {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (!run || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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

export default function Demo() {
  const [opt, setOpt] = useState<OptionKey>("h500");
  const [mode, setMode] = useState<Mode>(demoAccount ? "live" : "replay");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<BurnResult | null>(null);
  const [lit, setLit] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [usedPred, setUsedPred] = useState<Prediction | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balBefore, setBalBefore] = useState<bigint | null>(null);
  const [balAfter, setBalAfter] = useState<bigint | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);

  const option = OPTIONS.find((o) => o.key === opt) ?? OPTIONS[3];
  const running = phase !== "idle" && phase !== "done";

  useEffect(() => {
    alive.current = true;
    if (new URLSearchParams(window.location.search).has("replay")) setMode("replay");
    return () => {
      alive.current = false;
    };
  }, []);

  // 余额：实时模式下读一次，每笔交易后再读。
  useEffect(() => {
    if (mode !== "live" || !demoAccount) return;
    let off = false;
    publicClient
      .getBalance({ address: demoAccount.address })
      .then((b) => !off && setBalance(b))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [mode, round]);

  // 发送前的预测：实时模式用模拟接口，回放模式用真实记录。
  useEffect(() => {
    let off = false;
    const rec = REPLAY[opt];
    const fromRecord: Prediction = { jobGas: rec.jobGas, units: rec.units, bountyMon: rec.bountyMon };
    if (mode !== "live") {
      setPred(fromRecord);
      return;
    }
    setPred(null);
    (async () => {
      try {
        const fees = await currentFees();
        const o = await simulateExec({ kind: "crunch", n: 8 }, option.gasLimit, DEMO_ADDRESS, fees);
        if (!off) setPred({ jobGas: o.jobGas, units: o.units, bountyMon: Number(o.bounty) / 1e18 });
      } catch {
        if (!off) setPred(fromRecord);
      }
    })();
    return () => {
      off = true;
    };
  }, [opt, mode, round, option.gasLimit]);

  // 等待确认时的计时。
  useEffect(() => {
    if (phase !== "sending") return;
    const t0 = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => clearInterval(timer);
  }, [phase]);

  const run = useCallback(
    async (kind: "normal" | "fail") => {
      if (busy.current) return;
      busy.current = true;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const gasLimit = kind === "fail" ? FAIL_GAS_LIMIT : option.gasLimit;
      setNotice(null);
      setResult(null);
      setLit(0);
      setElapsed(0);
      setBalBefore(null);
      setBalAfter(null);
      setUsedPred(kind === "normal" ? pred : null);
      setPhase("sending");

      let res: BurnResult | null = null;
      if (mode === "live" && demoAccount) {
        try {
          const call: CallKind = kind === "fail" ? { kind: "soldOut" } : { kind: "crunch", n: 8 };
          const fees = await currentFees();
          const before = await publicClient.getBalance({ address: demoAccount.address });
          const tx = await timeout(sendExec(call, gasLimit, fees), SEND_TIMEOUT_MS);
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
          setBalBefore(before);
          const address = demoAccount.address;
          setTimeout(() => {
            publicClient
              .getBalance({ address })
              .then((b) => {
                if (!alive.current) return;
                setBalAfter(b);
                setBalance(b);
              })
              .catch(() => undefined);
          }, 1500);
        } catch {
          setNotice("实时发送失败或超时，下面是回放：真实交易记录");
        }
      }
      if (!res) {
        await sleep(reduced ? 0 : 1300);
        res = REPLAY[kind === "fail" ? "failed" : opt];
      }
      if (!alive.current) return;

      setResult(res);
      setPhase("call");
      await sleep(reduced ? 0 : 900);
      if (res.units > 0 && !reduced) {
        setPhase("burn");
        const stepMs = Math.min(120, Math.max(55, 2000 / res.units));
        for (let i = 1; i <= res.units; i++) {
          if (!alive.current) return;
          setLit(i);
          await sleep(stepMs);
        }
        await sleep(260);
      } else {
        setLit(res.units);
      }
      if (!alive.current) return;
      setPhase("done");
      setRound((r) => r + 1);
      busy.current = false;
    },
    [mode, opt, option.gasLimit, pred],
  );

  const pct = result && result.feeMon > 0 ? (result.bountyMon / result.feeMon) * 100 : 0;
  const pctShown = useCountUp(pct, phase === "done" && pct > 0);
  const overhead = result ? result.gasLimit - result.mainGas - result.jobGas - result.gasLeft : 0;
  const lowBalance = mode === "live" && balance !== null && balance < MIN_BALANCE;
  const sendDisabled = running || lowBalance;
  const shownLimit = result ? result.gasLimit : option.gasLimit;
  const predMatches =
    result &&
    result.source === "live" &&
    usedPred &&
    usedPred.jobGas === result.jobGas &&
    usedPred.units === result.units;

  return (
    <section className="bd-screen" id="try" aria-label="亲手试">
      {phase === "done" && result && result.jobGas > 0 && <div key={round} className="bd-flash" aria-hidden="true" />}

      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>亲手试</span>
        </div>
        <div className="bd-meta">
          <span>
            演示账户{" "}
            <a href={`${EXPLORER}/address/${DEMO_ADDRESS}`} target="_blank" rel="noreferrer">
              {shortAddr(DEMO_ADDRESS)}
            </a>
            {mode === "live" && balance !== null && <> · 余额 {fmtMon(balance, 4)} MON</>}
          </span>
          <span className="bd-toggle" role="group" aria-label="数据来源">
            <button type="button" aria-pressed={mode === "live"} disabled={!demoAccount || running} onClick={() => setMode("live")}>
              实时
            </button>
            <button type="button" aria-pressed={mode === "replay"} disabled={running} onClick={() => setMode("replay")}>
              回放
            </button>
          </span>
        </div>
      </header>

      <div className="bd-controls">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            className="bd-opt"
            aria-pressed={opt === o.key}
            disabled={running}
            onClick={() => {
              setOpt(o.key);
              setResult(null);
              setLit(0);
              setNotice(null);
              setPhase("idle");
            }}
          >
            <span>
              {o.name} · {o.note}
            </span>
            <b>{fmtGas(o.gasLimit)}</b>
          </button>
        ))}
        <div className="bd-actions">
          <button type="button" className="bd-btn fire" disabled={sendDisabled} onClick={() => run("normal")}>
            {running ? "进行中…" : "发送交易"}
          </button>
          <button type="button" className="bd-btn ghost" disabled={sendDisabled} onClick={() => run("fail")}>
            发一笔会失败的交易
          </button>
        </div>
      </div>

      <div className="bd-stage" aria-live="polite">
        {phase === "idle" && (
          <div className="bd-stage-line">
            <span className="bd-word">上限</span>
            <span className="bd-slab ink sm">{fmtGas(option.gasLimit)}</span>
            <span className="bd-tail">
              {lowBalance ? (
                <>
                  演示账户余额不足 0.06 MON，
                  <br />
                  先切到回放。
                </>
              ) : !pred ? (
                "正在模拟…"
              ) : pred.jobGas > 0 ? (
                <>
                  预测回收 {fmtGas(pred.jobGas)} gas
                  <br />
                  训练 {steps(pred.units)} 步
                  <br />
                  赚回 {mon(pred.bountyMon)} MON
                </>
              ) : (
                <>
                  预测：没有剩余可回收。
                  <br />
                  设得紧，
                  <br />
                  也不需要回收。
                </>
              )}
            </span>
          </div>
        )}

        {phase === "sending" && (
          <div className="bd-stage-line">
            <span className="bd-word">已发出</span>
            <span className="bd-slab ink sm">{elapsed.toFixed(1)} s</span>
            <span className="bd-tail">
              上限 {fmtGas(shownLimit)} gas，
              <br />
              全部按这个数扣费。
            </span>
          </div>
        )}

        {phase === "call" && result && (
          <div className="bd-stage-line">
            <span className="bd-word">{result.mainOk ? "你的调用" : "调用失败"}</span>
            <span className="bd-slab purple sm bd-slam">{fmtGas(result.mainGas)}</span>
            <span className="bd-tail">
              gas。{result.mainOk ? "事情做完了。" : "手续费照样全额扣。"}
              <br />
              剩下的呢？
            </span>
          </div>
        )}

        {phase === "burn" && result && (
          <div className="bd-stage-line">
            <span className="bd-word">回燃</span>
            <span className="bd-slab">{lit}</span>
            <span className="bd-tail">
              / {result.units} 个工作单位
              <br />
              {steps(result.units)} 步训练 + 1 次心跳
            </span>
          </div>
        )}

        {phase === "done" && result && (
          <>
            {!result.mainOk && <span className="bd-tag solid">调用失败 · 抢一个已经售罄的 NFT · 手续费照扣</span>}
            {result.jobGas > 0 ? (
              <div className="bd-stage-line">
                <span className="bd-word">赚回</span>
                <span className="bd-slab bd-slam">{pctShown.toFixed(1)}%</span>
                <span className="bd-tail">
                  的
                  <br />
                  手续费
                </span>
              </div>
            ) : (
              <div className="bd-stage-line">
                <span className="bd-word">回收</span>
                <span className="bd-slab purple bd-slam">0</span>
                <span className="bd-tail">
                  上限设得紧，没有剩余可回收，
                  <br />
                  也不需要回收。这是最划算的设法。
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <div className="bd-bar" role="img" aria-label={`gas 上限 ${fmtGas(shownLimit)} 的去向`}>
          {!result ? (
            <div className={`bd-bar-idle bd-hatch${phase === "sending" ? " drift" : ""}`}>
              <span>
                gas 上限 {fmtGas(shownLimit)} · {phase === "sending" ? "等待确认" : "发送后看它去了哪里"}
              </span>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      <div className={`bd-legend${result ? "" : " dim"}`}>
        <div className={`call${result ? "" : " dim"}`}>
          <span>你的调用{result && !result.mainOk ? "（失败）" : ""}</span>
          <b>{result ? fmtGas(result.mainGas) : "—"}</b>
        </div>
        <div className={`job${result ? "" : " dim"}`}>
          <span>
            回收执行的任务
            {result && result.units > 0 ? ` · ${steps(result.units)} 步训练 + 1 次心跳` : ""}
          </span>
          <b>{result ? fmtGas(result.jobGas) : "—"}</b>
        </div>
        <div className={`left${result ? "" : " dim"}`}>
          <span>仍未用到</span>
          <b>{result ? fmtGas(result.gasLeft) : "—"}</b>
        </div>
        <div className={`over${result ? "" : " dim"}`}>
          <span>固定开销</span>
          <b>{result ? fmtGas(overhead) : "—"}</b>
        </div>
      </div>

      <div className="bd-foot">
        {phase === "done" && result ? (
          <>
            <div>
              <div>
                手续费 <b>{mon(result.feeMon)} MON</b> · 赚回 <b>{mon(result.bountyMon)} MON</b>
                {balBefore !== null && balAfter !== null && (
                  <>
                    {" "}
                    · 余额 <b>{fmtMon(balBefore)}</b> → <b>{fmtMon(balAfter)} MON</b>
                  </>
                )}
                {predMatches && <> · 发送前的预测与链上实际完全一致</>}
              </div>
              <div>
                区块浏览器上这笔交易显示 gasUsed = {fmtGas(result.gasLimit)}。上面的分段是合约在链上量出来的。
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              {result.source === "replay" && <span className="bd-notice">回放：真实交易记录</span>}{" "}
              <a href={`${EXPLORER}/tx/${result.hash}`} target="_blank" rel="noreferrer">
                交易 {shortHash(result.hash)} ↗
              </a>
            </div>
          </>
        ) : (
          <div>
            {notice ? (
              <span className="bd-notice">{notice}</span>
            ) : mode === "replay" ? (
              "回放模式：点“发送交易”会重放今天在 Monad 测试网上的真实交易记录，不发新交易。"
            ) : (
              "实时模式：点“发送交易”会用演示账户在 Monad 测试网上发一笔真实交易，2 到 3 秒确认。"
            )}
          </div>
        )}
      </div>
    </section>
  );
}
