"use client";

import { useEffect, useState } from "react";
import {
  connectInjected,
  demoAccount,
  EXPLORER,
  fmtGas,
  fmtMon,
  hasInjectedWallet,
  publicClient,
  switchToDemoAccount,
} from "@/lib/chain";
import { MeterBar, MeterLegend, mon, pct, useCountUp, type Burn, type Mode } from "./burn";
import { shortAddr, shortHash, type OptionKey } from "./replay";

const OPTIONS: { key: OptionKey; name: string; gasLimit: number }[] = [
  { key: "official", name: "官方建议 +7.5%", gasLimit: 114037 },
  { key: "wallet", name: "钱包默认 ×1.5", gasLimit: 159121 },
  { key: "h300", name: "写死", gasLimit: 300000 },
  { key: "h500", name: "写死", gasLimit: 500000 },
];
const DEMO_ADDRESS: `0x${string}` = demoAccount?.address ?? "0x4BF0C46573d5a033B55BA561f32f60Df13833345";
const MIN_BALANCE = 60_000_000_000_000_000n; // 0.06 MON

/** 第 4 版 · 量：发一笔普通的调用，经过 Backdraft，量出它真实用了多少。 */
export default function MeasureSheet({
  burn,
  mode,
  setMode,
}: {
  burn: Burn;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const [opt, setOpt] = useState<OptionKey>("h500");
  const [addr, setAddr] = useState<`0x${string}`>(DEMO_ADDRESS);
  const [own, setOwn] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);

  const option = OPTIONS.find((o) => o.key === opt) ?? OPTIONS[3];
  const { phase, result, running } = burn;

  useEffect(() => setHasWallet(hasInjectedWallet()), []);

  useEffect(() => {
    if (mode !== "live") return;
    let off = false;
    const t = setTimeout(
      () => {
        publicClient
          .getBalance({ address: addr })
          .then((b) => !off && setBalance(b))
          .catch(() => undefined);
      },
      burn.round > 0 ? 1500 : 0,
    );
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [mode, addr, burn.round]);

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
  const used = useCountUp(result?.mainGas ?? 0, phase === "grow", 1200);
  const shown = result !== null && (phase === "grow" || phase === "done");

  return (
    <section className="bd-screen" id="s4" aria-label="量">
      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>量</span>
        </div>
        <div className="bd-meta">
          {result ? (
            <>
              {result.source === "replay" && <span className="bd-notice">回放 · 真实交易记录</span>}
              <a href={`${EXPLORER}/tx/${result.hash}`} target="_blank" rel="noreferrer">
                交易 {shortHash(result.hash)} ↗
              </a>
            </>
          ) : (
            <span>Monad Testnet · 每一笔都是真实交易</span>
          )}
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
        <span className="bd-toggle" role="group" aria-label="数据来源" style={{ marginLeft: "auto" }}>
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
          <button type="button" className="bd-btn fire" disabled={disabled} onClick={() => burn.run(opt, option.gasLimit)}>
            {running ? "测量中…" : phase === "done" ? "再量一笔" : "量这一笔"}
          </button>
          <a className={`bd-btn${phase === "done" ? "" : " ghost"} bdm-next`} href="#s5">
            下一步：照着设 ↓
          </a>
        </div>
      </div>

      <div className="bd-stage" aria-live="polite">
        {phase === "idle" && (
          <>
            <h2 className="bd-headline xl">发一笔，量一次。</h2>
            <p className="bd-predict">
              {burn.notice ? (
                <span className="bd-notice">{burn.notice}</span>
              ) : lowBalance ? (
                <>这个账户余额不足 0.06 MON，发不了交易。可以切到回放。</>
              ) : (
                <>
                  这是一笔普通的调用，上限{option.name === "写死" ? "写死" : "设为"} <b>{fmtGas(option.gasLimit)}</b>
                  。经过 Backdraft，它会被量一次。
                </>
              )}
            </p>
          </>
        )}

        {phase === "sending" && (
          <>
            <h2 className="bd-headline xl">已发出，等待上链。</h2>
            <p className="bd-predict">
              上限 <b>{fmtGas(option.gasLimit)}</b> gas，全部按这个数扣费 · 已等待 <b>{burn.elapsed.toFixed(1)} s</b>
            </p>
          </>
        )}

        {shown && result && (
          <div className="bd-stage-line bdm-hero">
            <div className="bdm-ask">
              <span>申请</span>
              <b>{fmtGas(result.gasLimit)}</b>
            </div>
            <div className="bdm-used">
              <span>
                真实用了 <span className="bd-tag solid">实测</span>
              </span>
              <b className="bd-slab purple">{fmtGas(phase === "grow" ? used : result.mainGas)}</b>
            </div>
            <div className="bd-util-side">
              <span>只用了上限的 {pct(result.mainGas / result.gasLimit)}</span>
              {phase === "done" && result.samples !== null && (
                <p className="bd-claim bd-slam">这个数已经记到链上，第 {result.samples} 次。</p>
              )}
            </div>
          </div>
        )}
      </div>

      <MeterBar result={shown ? result : null} limit={option.gasLimit} sending={phase === "sending"} />
      <MeterLegend result={shown ? result : null} />

      <div className="bd-foot">
        {phase === "done" && result ? (
          <div>
            <div>
              区块浏览器上这笔交易显示 gasUsed = {fmtGas(result.receiptGasUsed)}。真实用量是合约在链上量出来的。 手续费{" "}
              <b>{mon(result.feeMon)} MON</b>。
            </div>
            <div>发交易的人没有多花一分钱，记录用的是这笔交易里本来要作废的 gas。</div>
          </div>
        ) : (
          <div>
            {mode === "replay"
              ? "回放模式：重放今天在 Monad 测试网上的真实交易记录，不发新交易。"
              : own
                ? "点“量这一笔”会弹出你钱包的确认窗口。交易由你的钱包发出。"
                : "实时模式：用演示账户在 Monad 测试网上发一笔真实交易，2 到 3 秒确认。"}
          </div>
        )}
      </div>
    </section>
  );
}
