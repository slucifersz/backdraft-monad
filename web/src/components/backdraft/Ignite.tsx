"use client";

import { useEffect, useState } from "react";
import {
  connectInjected,
  currentFees,
  demoAccount,
  EXPLORER,
  fmtGas,
  fmtMon,
  hasInjectedWallet,
  publicClient,
  simulateExec,
  switchToDemoAccount,
} from "@/lib/chain";
import { BurnOverlay, GasBar, Legend, mon, pct, trainSteps, useCountUp, type Burn, type Mode, type Prediction } from "./burn";
import { REPLAY, shortAddr, shortHash, type OptionKey } from "./replay";

const OPTIONS: { key: OptionKey; name: string; gasLimit: number }[] = [
  { key: "official", name: "官方建议 +7.5%", gasLimit: 114037 },
  { key: "wallet", name: "钱包默认 ×1.5", gasLimit: 159121 },
  { key: "h300", name: "写死", gasLimit: 300000 },
  { key: "h500", name: "写死", gasLimit: 500000 },
];
const FAIL_GAS_LIMIT = 300000;
const DEMO_ADDRESS: `0x${string}` = demoAccount?.address ?? "0x4BF0C46573d5a033B55BA561f32f60Df13833345";
const MIN_BALANCE = 60_000_000_000_000_000n; // 0.06 MON

function TxLink({ burn }: { burn: Burn }) {
  if (!burn.result) return null;
  return (
    <>
      {burn.result.source === "replay" && <span className="bd-notice">回放 · 真实交易记录</span>}
      <a href={`${EXPLORER}/tx/${burn.result.hash}`} target="_blank" rel="noreferrer">
        交易 {shortHash(burn.result.hash)} ↗
      </a>
    </>
  );
}

/* ------------------------------------------------------------ 第 4 版 · 点火 */

export default function Ignite({
  burn,
  mode,
  setMode,
  onFail,
  autoTour,
  setAutoTour,
}: {
  burn: Burn;
  mode: Mode;
  setMode: (m: Mode) => void;
  onFail: () => void;
  autoTour: boolean;
  setAutoTour: (v: boolean) => void;
}) {
  const [opt, setOpt] = useState<OptionKey>("h500");
  const [pred, setPred] = useState<Prediction | null>(null);
  const [usedPred, setUsedPred] = useState<Prediction | null>(null);
  const [addr, setAddr] = useState<`0x${string}`>(DEMO_ADDRESS);
  const [own, setOwn] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);

  const option = OPTIONS.find((o) => o.key === opt) ?? OPTIONS[3];
  const { phase, result, util, lit, running } = burn;

  useEffect(() => setHasWallet(hasInjectedWallet()), []);

  useEffect(() => {
    if (mode !== "live") return;
    let off = false;
    publicClient
      .getBalance({ address: addr })
      .then((b) => !off && setBalance(b))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [mode, addr, burn.round, burn.balAfter]);

  // 发送前的预测：实时模式用模拟接口，回放模式用真实记录。
  useEffect(() => {
    let off = false;
    const rec = REPLAY[opt];
    const fromRecord: Prediction = {
      mainGas: rec.mainGas,
      jobGas: rec.jobGas,
      units: rec.units,
      bountyMon: rec.bountyMon,
    };
    if (mode !== "live") {
      setPred(fromRecord);
      return;
    }
    setPred(null);
    (async () => {
      try {
        const fees = await currentFees();
        const o = await simulateExec({ kind: "crunch", n: 8 }, option.gasLimit, addr, fees);
        if (!off)
          setPred({ mainGas: o.mainGas, jobGas: o.jobGas, units: o.units, bountyMon: Number(o.bounty) / 1e18 });
      } catch {
        if (!off) setPred(fromRecord);
      }
    })();
    return () => {
      off = true;
    };
  }, [opt, mode, addr, burn.round, option.gasLimit]);

  const connect = async () => {
    setWalletNote(null);
    try {
      const a = await connectInjected();
      setAddr(a);
      setOwn(true);
      setBalance(null);
      setMode("live");
      burn.reset();
    } catch {
      setWalletNote("没有连上钱包：在钱包里取消了，或没能切到 Monad Testnet。");
    }
  };
  const backToDemo = () => {
    switchToDemoAccount();
    setOwn(false);
    setAddr(DEMO_ADDRESS);
    setBalance(null);
    setWalletNote(null);
    if (!demoAccount) setMode("replay");
  };

  const lowBalance = mode === "live" && balance !== null && balance < MIN_BALANCE;
  const disabled = running || lowBalance;
  const fire = () => {
    setUsedPred(pred);
    burn.run("normal", opt, option.gasLimit);
  };

  const earned = result && result.feeMon > 0 ? (result.bountyMon / result.feeMon) * 100 : 0;
  const burned = !!result && result.jobGas > 0;
  const utilNow =
    util && result
      ? phase === "done"
        ? util.after
        : phase === "burn" && result.units > 0
          ? util.before + (util.after - util.before) * (lit / result.units)
          : util.before
      : 0;
  const utilDone = useCountUp(util?.after ?? 0, phase === "done" && burned, 450);
  const predMatches =
    result &&
    result.source === "live" &&
    usedPred &&
    usedPred.jobGas === result.jobGas &&
    usedPred.units === result.units;

  return (
    <section className="bd-screen" id="s4" aria-label="点火">
      <BurnOverlay
        burn={burn}
        figure={util ? pct(util.after) : ""}
        caption={util ? `这笔交易预留的算力，从 ${pct(util.before)} 用到了 ${pct(util.after)}` : ""}
      />

      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>点火</span>
        </div>
        <div className="bd-meta">
          {result ? <TxLink burn={burn} /> : <span>Monad Testnet · 每一笔都是真实交易</span>}
        </div>
      </header>

      <div className="bd-account">
        <span>
          {own ? <b className="bd-purple">正在使用你自己的钱包</b> : "演示账户"}{" "}
          <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
            {shortAddr(addr)}
          </a>
          {mode === "live" && balance !== null && <> · 余额 {fmtMon(balance, 4)} MON</>}
          {lowBalance && <b> · 余额不足 0.06 MON</b>}
        </span>
        {own ? (
          <button type="button" className="bd-link" disabled={running} onClick={backToDemo}>
            换回演示账户
          </button>
        ) : hasWallet ? (
          <button type="button" className="bd-link" disabled={running} onClick={connect}>
            用我自己的钱包
          </button>
        ) : (
          <span className="bd-note">没有检测到浏览器钱包</span>
        )}
        {walletNote && <span className="bd-notice">{walletNote}</span>}
        <a className="bd-link" href="#console" style={{ marginLeft: "auto", textDecoration: "none" }}>
          去控制台自己调一笔 ↓
        </a>
        <button
          type="button"
          className="bd-link"
          aria-pressed={autoTour}
          onClick={() => setAutoTour(!autoTour)}
        >
          烧完自动去看模型：{autoTour ? "开" : "关"}
        </button>
        <span className="bd-toggle" role="group" aria-label="数据来源">
          <button
            type="button"
            aria-pressed={mode === "live"}
            disabled={(!demoAccount && !own) || running}
            onClick={() => setMode("live")}
          >
            实时
          </button>
          <button type="button" aria-pressed={mode === "replay"} disabled={running || own} onClick={() => setMode("replay")}>
            回放
          </button>
        </span>
      </div>

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
              burn.reset();
            }}
          >
            <span>{o.name}</span>
            <b>{fmtGas(o.gasLimit)}</b>
          </button>
        ))}
        <div className="bd-actions">
          <button type="button" className="bd-btn fire" disabled={disabled} onClick={fire}>
            {running ? "燃烧中…" : phase === "done" ? "再点一次" : "点火"}
          </button>
          <button type="button" className="bd-btn ghost" disabled={running} onClick={onFail}>
            烧一笔会失败的 ↓
          </button>
        </div>
      </div>

      <div className="bd-stage" aria-live="polite">
        {phase === "idle" && (
          <>
            <h2 className="bd-headline xl">把一笔交易烧到底。</h2>
            <p className="bd-predict">
              {burn.notice ? (
                <span className="bd-notice">{burn.notice}</span>
              ) : lowBalance ? (
                <>这个账户余额不足 0.06 MON，点不了火。可以切到回放。</>
              ) : !pred ? (
                "正在模拟这笔交易…"
              ) : pred.jobGas > 0 ? (
                <>
                  预测：这笔调用自己只用 <b>{fmtGas(pred.mainGas)}</b>；剩余可点燃{" "}
                  <b>{fmtGas(pred.jobGas)}</b>；能训练 <b>{trainSteps(pred.units)}</b> 步；赚回{" "}
                  <b>{mon(pred.bountyMon)} MON</b>。
                </>
              ) : (
                <>
                  预测：这笔调用自己用 <b>{fmtGas(pred.mainGas)}</b>；没有剩余可点燃。设得紧，也不需要回收。
                </>
              )}
            </p>
          </>
        )}

        {phase === "sending" && (
          <>
            <h2 className="bd-headline xl">已上膛，等待上链。</h2>
            <p className="bd-predict">
              上限 <b>{fmtGas(option.gasLimit)}</b> gas，全部按这个数扣费 · 已等待 <b>{burn.elapsed.toFixed(1)} s</b>
            </p>
          </>
        )}

        {result && util && phase !== "idle" && phase !== "sending" && burned && (
          <div className="bd-stage-line">
            <span className="bd-util-from">{pct(util.before)}</span>
            <span className="bd-arrow" aria-hidden="true">
              →
            </span>
            <span key={phase === "done" ? "done" : "run"} className={`bd-slab${phase === "done" ? " bd-slam" : ""}`}>
              {pct(phase === "done" ? utilDone : utilNow)}
            </span>
            <div className="bd-util-side">
              <span>
                <span className="bd-tag solid">实测</span> 这笔交易预留的算力，用掉了多少
              </span>
              {phase === "done" ? (
                <p className="bd-claim">
                  同样的手续费，多训练了 {trainSteps(result.units)} 步链上模型。
                  <br />
                  发交易的人还赚回了 {earned.toFixed(1)}%。
                </p>
              ) : (
                <p className="bd-claim ink">
                  {phase === "call" ? "你的调用做完了。剩下的，点着。" : `回燃中 · 第 ${lit} / ${result.units} 格`}
                </p>
              )}
            </div>
          </div>
        )}

        {result && phase !== "idle" && phase !== "sending" && !burned && (
          <>
            <h2 className="bd-headline xl">设得够紧，没有可烧的。</h2>
            <p className="bd-predict">这正是该有的样子。把上限设紧，永远比回收更划算。</p>
          </>
        )}
      </div>

      <GasBar result={result} lit={lit} limit={option.gasLimit} sending={phase === "sending"} pred={pred} />
      <Legend result={result} />

      <div className="bd-foot">
        {phase === "done" && result ? (
          <div>
            <div className="bd-money">
              {burn.balBefore !== null && burn.balAfter !== null && (
                <>
                  点火前余额 <b>{fmtMon(burn.balBefore)}</b> → 点火后余额 <b>{fmtMon(burn.balAfter)}</b> MON ·{" "}
                </>
              )}
              手续费 <b>{mon(result.feeMon)} MON</b> · 赚回 <b>{mon(result.bountyMon)} MON</b>
              {predMatches && <> · 点火前的模拟与链上实际结果完全一致</>}
            </div>
            <div>
              区块浏览器上这笔交易显示 gasUsed = {fmtGas(result.gasLimit)}。上面的分段是合约在链上量出来的。
            </div>
          </div>
        ) : (
          <div>
            {mode === "replay"
              ? "回放模式：点火会重放今天在 Monad 测试网上的真实交易记录，不发新交易。"
              : own
                ? "点火会弹出你钱包的确认窗口。交易由你的钱包发出，赏金回到你的钱包。"
                : "实时模式：点火会用演示账户在 Monad 测试网上发一笔真实交易，2 到 3 秒确认。"}
          </div>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------- 第 6 版 · 失败也是燃料 */

export function FailSheet({ burn, mode }: { burn: Burn; mode: Mode }) {
  const { phase, result, lit, running } = burn;
  const earned = result && result.feeMon > 0 ? (result.bountyMon / result.feeMon) * 100 : 0;
  const shown = useCountUp(earned, phase === "done" && burn.round > 0);

  return (
    <section className="bd-screen" id="s6" aria-label="失败也是燃料">
      <BurnOverlay burn={burn} figure={`${earned.toFixed(1)}%`} caption="失败的交易，赚回的手续费" />

      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>失败也是燃料</span>
        </div>
        <div className="bd-meta">
          {result ? <TxLink burn={burn} /> : <span>上限 {fmtGas(FAIL_GAS_LIMIT)} gas · 写死</span>}
        </div>
      </header>

      <div className="bd-fail-head">
        <span className="bd-tag solid">调用失败 · 抢一个已经售罄的 NFT</span>
        <h2 className="bd-headline">
          在 <span className="bd-purple">Monad</span> 上，一笔失败的交易是纯粹的损失。
          <br />
          在这里，它是燃料。
        </h2>
      </div>

      <div className="bd-stage short" aria-live="polite">
        <div className="bd-stage-line">
          {phase === "sending" ? (
            <>
              <span className="bd-word">已发出</span>
              <span className="bd-slab ink sm">{burn.elapsed.toFixed(1)} s</span>
              <span className="bd-tail">
                这笔调用注定失败。
                <br />
                手续费照样全额扣。
              </span>
            </>
          ) : phase === "call" && result ? (
            <>
              <span className="bd-word">调用失败</span>
              <span className="bd-slab purple sm bd-slam">{fmtGas(result.mainGas)}</span>
              <span className="bd-tail">
                gas 就失败了。
                <br />
                剩下的，点着。
              </span>
            </>
          ) : phase === "burn" && result ? (
            <>
              <span className="bd-word">回燃</span>
              <span className="bd-slab sm">{lit}</span>
              <span className="bd-tail">
                / {result.units} 个工作单位
                <br />
                {trainSteps(result.units)} 步训练 + 1 次心跳
              </span>
            </>
          ) : result ? (
            <>
              <span className="bd-word">赚回</span>
              <span key={burn.round} className={`bd-slab${burn.round > 0 ? " bd-slam" : ""}`}>
                {shown.toFixed(1)}%
              </span>
              <span className="bd-tail">
                的手续费 <span className="bd-tag solid">实测</span>
                <br />
                连失败的交易，都在训练模型。
              </span>
            </>
          ) : null}
        </div>
      </div>

      <GasBar result={result} lit={lit} limit={FAIL_GAS_LIMIT} sending={phase === "sending"} />
      <Legend result={result} />

      <div className="bd-foot">
        <div>
          {result && phase === "done" ? (
            <div>
              手续费 <b>{mon(result.feeMon)} MON</b> · 赚回 <b>{mon(result.bountyMon)} MON</b>
              。区块浏览器上这笔交易显示 gasUsed = {fmtGas(result.gasLimit)}。
            </div>
          ) : (
            <div>{burn.notice ?? "上限 300,000 gas。交易里的调用会失败。"}</div>
          )}
          <div className="bd-note">
            失败的交易在 Monad 上照样按上限全额扣费。官方文档专门提醒过，钱包在估算失败时会把上限设得很高。
          </div>
        </div>
        <button
          type="button"
          className="bd-btn fire"
          disabled={running}
          onClick={() => burn.run("fail", "failed", FAIL_GAS_LIMIT)}
        >
          {running ? "燃烧中…" : "再烧一笔会失败的"}
          {mode === "replay" && !running ? "（回放）" : ""}
        </button>
      </div>
    </section>
  );
}
