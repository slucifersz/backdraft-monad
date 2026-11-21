"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  activeAddress,
  currentFees,
  demoAccount,
  estimateDirect,
  EXPLORER,
  fmtGas,
  fmtMon,
  publicClient,
  readSuggestion,
  sendDirect,
  sendExec,
  simulateExec,
  usingOwnWallet,
  type CallKind,
  type Fees,
  type Suggestion,
} from "@/lib/chain";
import { MeterBar, MeterLegend, mon, pct, sleep } from "@/components/backdraft/burn";
import { shortAddr, shortHash, type Measure } from "@/components/backdraft/replay";

const DEMO_ADDRESS: `0x${string}` = demoAccount?.address ?? "0x4BF0C46573d5a033B55BA561f32f60Df13833345";
const MIN_BALANCE = 60_000_000_000_000_000n; // 0.06 MON
const PRESETS = [114037, 159121, 300000, 500000];
// 流量计按“合约 + 函数”记录，读数用固定的 crunch(8) 去问。
const METER_CALL: CallKind = { kind: "crunch", n: 8 };

type Sim = {
  gasLimit: number;
  mainOk: boolean;
  mainGas: number;
  feeMon: number;
  direct: number | null;
};
type Row = { at: string; label: string; result: Measure };
type Line = { at: string; kind: "cmd" | "out" | "ok" | "err"; text: string };

const clock = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
const callLabel = (c: CallKind) => (c.kind === "crunch" ? `crunch(${c.n})` : "soldOut()");
const share = (m: Pick<Measure, "mainGas" | "gasLimit">) => pct(m.mainGas / m.gasLimit);

/** 控制台：自己构造一笔交易，试算，发出，看链上量出来的分段。 */
export default function ConsoleSheet({ active, lock }: { active: boolean; lock: RefObject<boolean> }) {
  const [n, setN] = useState(8);
  const [gasLimit, setGasLimit] = useState(500000);
  const [sim, setSim] = useState<Sim | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendingFor, setSendingFor] = useState(0);
  const [result, setResult] = useState<Measure | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [block, setBlock] = useState<{ number: bigint; gwei: number } | null>(null);
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [tight, setTight] = useState<{ hash: string; limit: number; feeMon: number; looseMon: number; looseLimit: number } | null>(
    null,
  );
  const [addr, setAddr] = useState<`0x${string}`>(DEMO_ADDRESS);
  const [own, setOwn] = useState(false);
  const fees = useRef<{ at: number; fees: Fees } | null>(null);
  const seq = useRef(0);
  const logEl = useRef<HTMLDivElement | null>(null);

  const call: CallKind = { kind: "crunch", n };
  const canSend = !!activeAddress() || own;

  const log = useCallback((kind: Line["kind"], text: string) => {
    setLines((l) => [...l.slice(-199), { at: clock(), kind, text }]);
  }, []);

  useEffect(() => {
    logEl.current?.scrollTo({ top: logEl.current.scrollHeight });
  }, [lines]);

  const getFees = useCallback(async () => {
    if (fees.current && Date.now() - fees.current.at < 8000) return fees.current.fees;
    const f = await currentFees();
    fees.current = { at: Date.now(), fees: f };
    return f;
  }, []);

  // backdraft_status：余额、区块、流量计的读数。
  const status = useCallback(
    async (announce: boolean, who: `0x${string}`) => {
      if (announce) log("cmd", "backdraft_status");
      const [b, blk, s] = await Promise.allSettled([
        publicClient.getBalance({ address: who }),
        publicClient.getBlock({ blockTag: "latest" }),
        readSuggestion(METER_CALL),
      ]);
      if (b.status === "fulfilled") setBalance(b.value);
      if (blk.status === "fulfilled")
        setBlock({ number: blk.value.number, gwei: Number(blk.value.baseFeePerGas ?? 0n) / 1e9 });
      if (s.status === "fulfilled") setSug(s.value); // 读不到时保留上一次的值
      if (announce) {
        if (s.status === "fulfilled") {
          log(
            "out",
            s.value.samples > 0
              ? `流量计 记了 ${s.value.samples} 次 · 最多用过 ${fmtGas(s.value.maxUsed)} gas · 建议上限 ${fmtGas(s.value.gasLimit)}`
              : "流量计 还没有这类调用的记录",
          );
        } else log("err", "读不到流量计：RPC 没有响应");
      }
    },
    [log],
  );

  const refreshSug = useCallback(async () => {
    try {
      setSug(await readSuggestion(METER_CALL));
    } catch {
      /* RPC 没响应时保留上一次读到的值 */
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (!active) return;
    // 钱包在第 4 版切换；翻到这一版时跟上当前账户。
    const a = activeAddress() ?? DEMO_ADDRESS;
    setAddr(a);
    setOwn(usingOwnWallet());
    if (started.current) {
      status(false, a);
      return;
    }
    started.current = true;
    status(true, a);
  }, [status, active]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => status(false, addr), 20000);
    return () => clearInterval(t);
  }, [status, addr, active]);

  // backdraft_simulate：用准备发送的那个上限，在链上试算一遍。
  const simulate = useCallback(
    async (c: CallKind, limit: number, who: `0x${string}`, announce: boolean) => {
      const my = ++seq.current;
      setSimBusy(true);
      if (announce) log("cmd", `backdraft_simulate ${callLabel(c)} gas=${fmtGas(limit)}`);
      try {
        const f = await getFees();
        const [o, direct] = await Promise.all([simulateExec(c, limit, who, f), estimateDirect(c, who)]);
        if (my !== seq.current) return;
        const s: Sim = {
          gasLimit: limit,
          mainOk: o.mainOk,
          mainGas: o.mainGas,
          feeMon: (limit * Number(f.expected)) / 1e18,
          direct,
        };
        setSim(s);
        if (announce)
          log("out", `${s.mainOk ? "调用" : "调用会失败，"}用 ${fmtGas(s.mainGas)} · 手续费 ${mon(s.feeMon)} MON`);
      } catch {
        if (my === seq.current && announce) log("err", "试算没有返回：RPC 没有响应，或这个上限不够执行。");
      } finally {
        if (my === seq.current) setSimBusy(false);
      }
    },
    [getFees, log],
  );

  // 拖动时自动试算（延迟 450 毫秒，不写日志）。
  useEffect(() => {
    if (busy || !active) return;
    const t = setTimeout(() => simulate(call, gasLimit, addr, false), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, gasLimit, addr, busy, active]);

  useEffect(() => {
    if (!sendingFor) return;
    const t0 = sendingFor;
    const timer = setInterval(() => setSendingFor((v) => (v ? t0 : 0)), 200);
    return () => clearInterval(timer);
  }, [sendingFor]);

  // backdraft_send：真实发出，返回链上量出来的分段。
  const send = async () => {
    if (busy || lock.current) return;
    const who = activeAddress();
    if (!who) {
      log("err", "没有可用的账户：请连接浏览器钱包。");
      return;
    }
    setBusy(true);
    lock.current = true;
    setResult(null);
    setSendingFor(Date.now());
    const c = call;
    const limit = gasLimit;
    log("cmd", `backdraft_send ${callLabel(c)} gas=${fmtGas(limit)}`);
    try {
      const [f, before] = await Promise.all([getFees(), publicClient.getBalance({ address: who })]);
      if (before < MIN_BALANCE) throw new Error("余额不足 0.06 MON");
      const tx = await sendExec(c, limit, f);
      if (tx.status !== "success") throw new Error("交易被回滚");
      const res: Measure = {
        source: "live",
        gasLimit: limit,
        mainGas: tx.mainGas,
        gasLeft: tx.gasLeft,
        approx: false,
        receiptGasUsed: tx.receiptGasUsed,
        feeMon: Number(tx.fee) / 1e18,
        samples: tx.recorded?.samples ?? null,
        hash: tx.hash,
      };
      setSendingFor(0);
      setResult(res);
      log("ok", `已上链 ${tx.hash}`);
      log("out", `Burned  mainOk=${tx.mainOk} mainGas=${fmtGas(tx.mainGas)} gasLeft=${fmtGas(tx.gasLeft)}`);
      log("out", `回执 gasUsed=${fmtGas(tx.receiptGasUsed)} · 真实用量占上限 ${share(res)}`);
      if (tx.recorded)
        log(
          "ok",
          `Recorded  流量计记下这类调用的真实用量 ${fmtGas(tx.recorded.gasUsed)} gas · 第 ${tx.recorded.samples} 次测量`,
        );
      refreshSug();

      setRows((r) => [{ at: clock(), label: callLabel(c), result: res }, ...r]);
      await sleep(1400);
      const after = await publicClient.getBalance({ address: who }).catch(() => null);
      if (after !== null) {
        setBalance(after);
        log("out", `余额 ${fmtMon(before)} → ${fmtMon(after)} MON · 手续费 ${mon(res.feeMon)}`);
      }
      status(false, who);
    } catch (e) {
      setSendingFor(0);
      const msg = e instanceof Error ? e.message.split("\n")[0] : "未知错误";
      log("err", `没有发出：${msg}`);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };

  // 问流量计要一个上限，然后不经过 Backdraft，直接把这笔调用发给应用。
  const sendTight = async () => {
    if (busy || lock.current || !sug || sug.gasLimit === 0) return;
    const who = activeAddress();
    if (!who) {
      log("err", "没有可用的账户：请连接浏览器钱包。");
      return;
    }
    setBusy(true);
    lock.current = true;
    const c = call;
    const limit = sug.gasLimit;
    const looseLimit = gasLimit;
    log("cmd", `meter.suggestTxGasLimit ${callLabel(c)}`);
    log("out", `链上记录 ${sug.samples} 次 · 最大真实用量 ${fmtGas(sug.maxUsed)} · 建议上限 ${fmtGas(limit)}`);
    try {
      const [f, need] = await Promise.all([getFees(), estimateDirect(c, who)]);
      if (need === null) throw new Error("这笔调用会失败，流量计不给失败的调用出建议");
      if (need > limit)
        throw new Error(`链上记录来自更小的输入，这一笔需要 ${fmtGas(need)}。先用“发送”走一遍，让流量计记下来`);
      log("cmd", `send ${callLabel(c)} gas=${fmtGas(limit)}  直接发给应用，不经过 Backdraft`);
      const tx = await sendDirect(c, limit, f);
      if (tx.status !== "success") throw new Error("交易被回滚");
      const feeMon = Number(tx.fee) / 1e18;
      const looseMon = (looseLimit * Number(tx.gasPrice)) / 1e18;
      setTight({ hash: tx.hash, limit, feeMon, looseMon, looseLimit });
      log("ok", `已上链 ${tx.hash}`);
      log(
        "ok",
        `手续费 ${mon(feeMon)} MON · 同一笔调用按上限 ${fmtGas(looseLimit)} 要 ${mon(looseMon)} MON · 省了 ${pct(1 - feeMon / looseMon)}`,
      );
      await sleep(1400);
      status(false, who);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : "未知错误";
      log("err", `没有发出：${msg}`);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };

  const shownFee = result ? result.feeMon : sim?.feeMon;
  const shownUsed = result ? result.mainGas : sim?.mainGas;
  const shownLimit = result ? result.gasLimit : gasLimit;
  const waited = sendingFor ? ((Date.now() - sendingFor) / 1000).toFixed(1) : "0.0";
  const hasRecord = !!sug && sug.samples > 0 && sug.gasLimit > 0;

  return (
    <section className="bd-screen bdc" id="console" aria-label="控制台">
      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>控制台</span>
        </div>
        <div className="bd-meta">
          <span>
            {own ? <b className="bd-purple">你自己的钱包</b> : "演示账户"}{" "}
            <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
              {shortAddr(addr)}
            </a>
            {balance !== null && <> · {fmtMon(balance, 4)} MON</>}
          </span>
          <a className="bd-link" href="#s4" style={{ textDecoration: "none" }}>
            在第 4 版切换钱包 ↑
          </a>
        </div>
      </header>

      <div className="bdc-grid">
        {/* ---------------- 左：构造交易 ---------------- */}
        <section className="bdc-panel" aria-label="构造交易">
          <h2>构造一笔交易</h2>

          <label className="bdc-field">
            <span>
              crunch(n) · 输入规模 n <b>{n}</b>
            </span>
            <input
              type="range"
              min={2}
              max={32}
              step={1}
              value={n}
              disabled={busy}
              onChange={(e) => setN(Number(e.target.value))}
            />
          </label>

          <label className="bdc-field">
            <span>
              gas 上限 <b>{fmtGas(gasLimit)}</b>
            </span>
            <input
              type="range"
              min={80000}
              max={600000}
              step={1000}
              value={gasLimit}
              disabled={busy}
              onChange={(e) => setGasLimit(Number(e.target.value))}
            />
          </label>
          <div className="bdc-chips">
            {PRESETS.map((p) => (
              <button key={p} type="button" aria-pressed={gasLimit === p} disabled={busy} onClick={() => setGasLimit(p)}>
                {fmtGas(p)}
              </button>
            ))}
          </div>

          <dl className="bdc-kv">
            <div>
              <dt>直接发出需要</dt>
              <dd>{sim ? (sim.direct ? fmtGas(sim.direct) : "调用会失败") : "…"}</dd>
            </div>
            <div>
              <dt>真实用量</dt>
              <dd>{sim ? fmtGas(sim.mainGas) : "…"}</dd>
            </div>
            <div className="hot">
              <dt>链上建议上限</dt>
              <dd>{sug ? (sug.gasLimit > 0 ? fmtGas(sug.gasLimit) : "还没记录") : "…"}</dd>
            </div>
          </dl>

          <div className="bdc-actions">
            <button
              type="button"
              className="bd-btn ghost"
              disabled={busy || simBusy}
              onClick={() => simulate(call, gasLimit, addr, true)}
            >
              试算
            </button>
            <button type="button" className="bd-btn fire" disabled={busy || !canSend} onClick={send}>
              {busy ? "进行中…" : "发送"}
            </button>
          </div>
        </section>

        {/* ---------------- 中：结果 ---------------- */}
        <section className="bdc-panel bdc-main" aria-label="结果">
          <div className="bdc-stats three">
            <div>
              <span>真实用量 / 上限{result ? "" : "（试算）"}</span>
              <b>
                {shownUsed !== undefined ? (
                  <>
                    {fmtGas(shownUsed)} / {fmtGas(shownLimit)} <i>{pct(shownUsed / shownLimit)}</i>
                  </>
                ) : (
                  "…"
                )}
              </b>
            </div>
            <div>
              <span>手续费 (MON)</span>
              <b>{shownFee !== undefined ? mon(shownFee) : "…"}</b>
            </div>
            <div>
              <span>回执 gasUsed</span>
              <b>{fmtGas(result ? result.receiptGasUsed : gasLimit)}</b>
            </div>
          </div>

          <div className="bdc-barhead">
            <span>
              {busy && !result
                ? `已发出 · 等待上链 ${waited} s`
                : result
                  ? "链上量出来的分段"
                  : `还没有发出${simBusy ? " · 试算中…" : ""}`}
            </span>
            {result && (
              <a href={`${EXPLORER}/tx/${result.hash}`} target="_blank" rel="noreferrer">
                交易 {shortHash(result.hash)} ↗
              </a>
            )}
          </div>
          <MeterBar result={result} limit={gasLimit} sending={busy && !result} />
          <MeterLegend result={result} />

          <div className="bdc-oracle">
            <div className="bdc-oracle-text">
              <span className="bd-tag">实测</span>
              <span>
                <b>链上流量计</b>
                {hasRecord && sug
                  ? ` 记了 ${sug.samples} 次 · 这类调用最多用过 ${fmtGas(sug.maxUsed)} gas · 建议上限 ${fmtGas(sug.gasLimit)}`
                  : " 还没有这类调用的记录。先点“发送”走一遍。"}
              </span>
            </div>
            <button
              type="button"
              className="bd-btn"
              disabled={busy || !canSend || !sug || sug.gasLimit === 0}
              onClick={sendTight}
              title="读链上流量计给出的上限，直接把这笔调用发给应用"
            >
              按链上建议直接发
            </button>
          </div>
          {tight && (
            <p className="bdc-tight-note">
              按建议上限 {fmtGas(tight.limit)} 直接发出：手续费 {mon(tight.feeMon)} MON，比上限 {fmtGas(tight.looseLimit)}{" "}
              省了 <b>{pct(1 - tight.feeMon / tight.looseMon)}</b> ·{" "}
              <a href={`${EXPLORER}/tx/${tight.hash}`} target="_blank" rel="noreferrer">
                交易 {shortHash(tight.hash)} ↗
              </a>
            </p>
          )}

          <div className="bdc-history">
            <div className="bdc-tr head">
              <span>时间</span>
              <span>调用</span>
              <span>上限</span>
              <span>真实用量</span>
              <span>占上限</span>
              <span>手续费</span>
              <span>交易</span>
            </div>
            {rows.length === 0 && <div className="bdc-empty">这一场还没有发过交易。左边调好，点“发送”。</div>}
            {rows.map((r) => (
              <button
                key={r.result.hash}
                type="button"
                className="bdc-tr"
                aria-pressed={result?.hash === r.result.hash}
                onClick={() => setResult(r.result)}
              >
                <span>{r.at}</span>
                <span>{r.label}</span>
                <span>{fmtGas(r.result.gasLimit)}</span>
                <span>{fmtGas(r.result.mainGas)}</span>
                <span>{share(r.result)}</span>
                <span>{mon(r.result.feeMon)}</span>
                <span>{shortHash(r.result.hash)}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ---------------- 右：现场状态 ---------------- */}
        <section className="bdc-panel" aria-label="现场状态">
          <h2>
            现场状态
            <button type="button" className="bd-link" onClick={() => status(true, addr)}>
              刷新
            </button>
          </h2>
          <dl className="bdc-kv">
            <div>
              <dt>区块</dt>
              <dd>{block ? `#${block.number.toLocaleString("en-US")}` : "…"}</dd>
            </div>
            <div>
              <dt>gas 价格</dt>
              <dd>{block ? `${block.gwei.toFixed(1)} gwei` : "…"}</dd>
            </div>
          </dl>

          <h3>流量计读数</h3>
          <dl className="bdc-kv">
            <div>
              <dt>记录次数</dt>
              <dd>{sug ? sug.samples : "…"}</dd>
            </div>
            <div>
              <dt>最多用过</dt>
              <dd>{sug ? (hasRecord ? fmtGas(sug.maxUsed) : "还没记录") : "…"}</dd>
            </div>
            <div>
              <dt>最近一次</dt>
              <dd>{sug ? (hasRecord ? fmtGas(sug.lastUsed) : "还没记录") : "…"}</dd>
            </div>
            <div className="hot">
              <dt>建议上限</dt>
              <dd>{sug ? (hasRecord ? fmtGas(sug.gasLimit) : "还没记录") : "…"}</dd>
            </div>
          </dl>
          <p className="bdc-empty">按“合约 + 函数”记录：这是 crunch 这个函数在链上的读数。</p>
        </section>
      </div>

      {/* ---------------- 底：操作日志 ---------------- */}
      <div className="bdc-log" ref={logEl} role="log" aria-label="操作日志">
        {lines.map((l, i) => (
          <div key={i} className={l.kind}>
            <span className="t">{l.at}</span>
            <span className="m">
              {l.kind === "cmd" ? "> " : "  "}
              {l.text}
            </span>
          </div>
        ))}
        {lines.length === 0 && <div className="out">等待第一条命令…</div>}
      </div>
    </section>
  );
}
