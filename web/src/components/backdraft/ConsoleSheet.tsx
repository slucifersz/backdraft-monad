"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  activeAddress,
  connectInjected,
  currentFees,
  demoAccount,
  estimateDirect,
  EXPLORER,
  fmtGas,
  fmtMon,
  hasInjectedWallet,
  publicClient,
  readModel,
  readSuggestion,
  readTotals,
  sendDirect,
  sendExec,
  simulateExec,
  switchToDemoAccount,
  usingOwnWallet,
  utilization,
  type CallKind,
  type Fees,
  type ModelState,
  type Suggestion,
  type Totals,
} from "@/lib/chain";
import { GasBar, Legend, mon, pct, prefersReducedMotion, sleep, trainSteps } from "@/components/backdraft/burn";
import { shortAddr, shortHash, type BurnResult } from "@/components/backdraft/replay";

const DEMO_ADDRESS: `0x${string}` = demoAccount?.address ?? "0x4BF0C46573d5a033B55BA561f32f60Df13833345";
const MIN_BALANCE = 60_000_000_000_000_000n; // 0.06 MON
const PRESETS = [114037, 159121, 300000, 500000];

type Sim = {
  gasLimit: number;
  mainOk: boolean;
  mainGas: number;
  jobGas: number;
  units: number;
  bountyMon: number;
  feeMon: number;
  direct: number | null;
};
type Row = { at: string; label: string; result: BurnResult; before: number; after: number };
type Line = { at: string; kind: "cmd" | "out" | "ok" | "err"; text: string };

const clock = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
const callLabel = (c: CallKind) => (c.kind === "crunch" ? `crunch(${c.n})` : "soldOut()");

/** 第 9 版 · 控制台：自己构造一笔交易，试算，发出，看链上量出来的分段。 */
export default function ConsoleSheet({
  active,
  lock,
  onSent,
}: {
  active: boolean;
  lock: RefObject<boolean>;
  onSent: (r: BurnResult) => void;
}) {
  const [failing, setFailing] = useState(false);
  const [n, setN] = useState(8);
  const [gasLimit, setGasLimit] = useState(500000);
  const [sim, setSim] = useState<Sim | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendingFor, setSendingFor] = useState(0);
  const [result, setResult] = useState<BurnResult | null>(null);
  const [resultUtil, setResultUtil] = useState<{ before: number; after: number } | null>(null);
  const [lit, setLit] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [model, setModel] = useState<ModelState | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [block, setBlock] = useState<{ number: bigint; gwei: number } | null>(null);
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [tight, setTight] = useState<{ hash: string; limit: number; feeMon: number; looseMon: number; looseLimit: number } | null>(
    null,
  );
  const [addr, setAddr] = useState<`0x${string}`>(DEMO_ADDRESS);
  const [own, setOwn] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const fees = useRef<{ at: number; fees: Fees } | null>(null);
  const seq = useRef(0);
  const logEl = useRef<HTMLDivElement | null>(null);

  const call: CallKind = failing ? { kind: "soldOut" } : { kind: "crunch", n };
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

  // backdraft_status：队列、模型、余额、区块。
  const status = useCallback(
    async (announce: boolean, who: `0x${string}`) => {
      if (announce) log("cmd", "backdraft_status");
      const [t, m, b, blk] = await Promise.allSettled([
        readTotals(),
        readModel(),
        publicClient.getBalance({ address: who }),
        publicClient.getBlock({ blockTag: "latest" }),
      ]);
      if (t.status === "fulfilled") setTotals(t.value);
      if (m.status === "fulfilled") setModel(m.value);
      if (b.status === "fulfilled") setBalance(b.value);
      if (blk.status === "fulfilled")
        setBlock({ number: blk.value.number, gwei: Number(blk.value.baseFeePerGas ?? 0n) / 1e9 });
      if (announce) {
        if (t.status === "fulfilled") {
          const live = t.value.jobs.filter((j) => j.active);
          log(
            "out",
            `队列 ${live.length} 个任务在跑 · 累计点燃 ${fmtGas(t.value.gasRecycled)} gas · ${t.value.burns} 笔交易 · 付出赏金 ${fmtMon(t.value.bountyPaid, 4)} MON`,
          );
        } else log("err", "读不到队列：RPC 没有响应");
        if (m.status === "fulfilled")
          log("out", `模型已训练 ${m.value.steps} 步 · 当前误差 ${m.value.loss.toFixed(6)}`);
      }
    },
    [log],
  );

  // 预言机：这类调用在链上记下的真实用量，和它给出的建议上限。
  const refreshSug = useCallback(async (c: CallKind) => {
    try {
      setSug(await readSuggestion(c));
    } catch {
      /* RPC 没响应时保留上一次读到的值 */
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    refreshSug(failing ? { kind: "soldOut" } : { kind: "crunch", n: 8 });
  }, [active, failing, refreshSug]);

  const started = useRef(false);
  useEffect(() => {
    if (!active) return;
    // 钱包在“点火”版切换；翻到这一版时跟上当前账户。
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
          jobGas: o.jobGas,
          units: o.units,
          bountyMon: Number(o.bounty) / 1e18,
          feeMon: (limit * Number(f.expected)) / 1e18,
          direct,
        };
        setSim(s);
        if (announce) {
          log(
            "out",
            `${s.mainOk ? "调用" : "调用会失败，"}用 ${fmtGas(s.mainGas)} · 可点燃 ${fmtGas(s.jobGas)}` +
              (s.units > 0 ? ` · ${trainSteps(s.units)} 步训练 + 1 次心跳` : "") +
              ` · 赏金 ${mon(s.bountyMon)} MON · 手续费 ${mon(s.feeMon)} MON`,
          );
          log(s.jobGas > 0 ? "ok" : "out", s.jobGas > 0 ? "值得回燃。" : "上限设得够紧，没有可烧的。");
        }
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
  }, [failing, n, gasLimit, addr, busy, active]);

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
    setResultUtil(null);
    setLit(0);
    setSendingFor(Date.now());
    const c = call;
    const limit = gasLimit;
    log("cmd", `backdraft_send ${callLabel(c)} gas=${fmtGas(limit)}`);
    try {
      const [f, before, direct] = await Promise.all([
        getFees(),
        publicClient.getBalance({ address: who }),
        estimateDirect(c, who),
      ]);
      if (before < MIN_BALANCE) throw new Error("余额不足 0.06 MON");
      const tx = await sendExec(c, limit, f);
      if (tx.status !== "success") throw new Error("交易被回滚");
      const res: BurnResult = {
        source: "live",
        gasLimit: limit,
        mainOk: tx.mainOk,
        mainGas: tx.mainGas,
        jobGas: tx.jobGas,
        units: tx.units,
        gasLeft: tx.gasLeft,
        feeMon: Number(tx.fee) / 1e18,
        bountyMon: Number(tx.bounty) / 1e18,
        hash: tx.hash,
      };
      const u = utilization(tx, direct);
      setSendingFor(0);
      setResult(res);
      setResultUtil(u);
      log("ok", `已上链 ${tx.hash}`);
      log(
        "out",
        `Burned  mainOk=${tx.mainOk} mainGas=${fmtGas(tx.mainGas)} jobGas=${fmtGas(tx.jobGas)} units=${tx.units} gasLeft=${fmtGas(tx.gasLeft)} bounty=${mon(res.bountyMon)}`,
      );
      for (const j of tx.jobRuns)
        log(
          "out",
          `JobRan  #${j.id} gasUsed=${fmtGas(j.gasUsed)} units=${j.units} bounty=${mon(Number(j.bounty) / 1e18)}`,
        );
      log("out", `回执 gasUsed=${fmtGas(tx.receiptGasUsed)} · 利用率 ${pct(u.before)} → ${pct(u.after)}`);
      if (tx.recorded)
        log(
          "ok",
          `Recorded  预言机记下这类调用的真实用量 ${fmtGas(tx.recorded.gasUsed)} gas · 第 ${tx.recorded.samples} 次测量`,
        );
      refreshSug(c);

      if (res.units > 0 && !prefersReducedMotion()) {
        const stepMs = Math.min(110, Math.max(45, 1800 / res.units));
        for (let i = 1; i <= res.units; i++) {
          setLit(i);
          await sleep(stepMs);
        }
      } else setLit(res.units);

      setRows((r) => [{ at: clock(), label: callLabel(c), result: res, before: u.before, after: u.after }, ...r]);
      await sleep(1400);
      const after = await publicClient.getBalance({ address: who }).catch(() => null);
      if (after !== null) {
        setBalance(after);
        log("out", `余额 ${fmtMon(before)} → ${fmtMon(after)} MON · 手续费 ${mon(res.feeMon)} · 赚回 ${mon(res.bountyMon)}`);
      }
      status(false, who);
      onSent(res);
    } catch (e) {
      setSendingFor(0);
      const msg = e instanceof Error ? e.message.split("\n")[0] : "未知错误";
      log("err", `没有发出：${msg}`);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };

  // 问预言机要一个上限，然后不经过 Backdraft，直接把这笔调用发给应用。
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
    log("cmd", `oracle.suggestTxGasLimit ${callLabel(c)}`);
    log("out", `链上记录 ${sug.samples} 次 · 最大真实用量 ${fmtGas(sug.maxUsed)} · 建议上限 ${fmtGas(limit)}`);
    try {
      const [f, need] = await Promise.all([getFees(), estimateDirect(c, who)]);
      if (need === null) throw new Error("这笔调用会失败，预言机不给失败的调用出建议");
      if (need > limit)
        throw new Error(`链上记录来自更小的输入，这一笔需要 ${fmtGas(need)}。先用“发送”走一遍，让预言机记下来`);
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

  const connect = async () => {
    log("cmd", "connect wallet");
    try {
      const a = await connectInjected();
      setAddr(a);
      setOwn(true);
      setBalance(null);
      log("ok", `正在使用你自己的钱包 ${a}`);
      status(false, a);
    } catch {
      log("err", "没有连上钱包：在钱包里取消了，或没能切到 Monad Testnet。");
    }
  };
  const backToDemo = () => {
    switchToDemoAccount();
    setOwn(false);
    setAddr(DEMO_ADDRESS);
    setBalance(null);
    log("out", "换回演示账户。");
    status(false, DEMO_ADDRESS);
  };

  const inspect = (row: Row) => {
    setResult(row.result);
    setResultUtil({ before: row.before, after: row.after });
    setLit(row.result.units);
  };

  const shownFee = result ? result.feeMon : sim?.feeMon;
  const shownBounty = result ? result.bountyMon : sim?.bountyMon;
  const simBefore = sim ? Math.min(1, (sim.direct ?? sim.mainGas + 21000) / sim.gasLimit) : null;
  const jobs = totals ? (totals.jobs.some((j) => j.active) ? totals.jobs.filter((j) => j.active) : totals.jobs) : [];
  const waited = sendingFor ? ((Date.now() - sendingFor) / 1000).toFixed(1) : "0.0";

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
            在点火版切换钱包 ↑
          </a>
        </div>
      </header>

      <div className="bdc-grid">
        {/* ---------------- 左：构造交易 ---------------- */}
        <section className="bdc-panel" aria-label="构造交易">
          <h2>构造一笔交易</h2>
          <div className="bdc-toggle" role="group" aria-label="调用">
            <button type="button" aria-pressed={!failing} disabled={busy} onClick={() => setFailing(false)}>
              crunch(n)
            </button>
            <button type="button" aria-pressed={failing} disabled={busy} onClick={() => setFailing(true)}>
              会失败的调用
            </button>
          </div>

          <label className="bdc-field">
            <span>
              输入规模 n <b>{failing ? "—" : n}</b>
            </span>
            <input
              type="range"
              min={2}
              max={32}
              step={1}
              value={n}
              disabled={busy || failing}
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
              <dt>你的调用</dt>
              <dd>{sim ? fmtGas(sim.mainGas) : "…"}</dd>
            </div>
            <div className="hot">
              <dt>可点燃</dt>
              <dd>{sim ? fmtGas(sim.jobGas) : "…"}</dd>
            </div>
            <div>
              <dt>能训练</dt>
              <dd>{sim ? `${trainSteps(sim.units)} 步` : "…"}</dd>
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
          <div className="bdc-stats">
            <div>
              <span>利用率</span>
              <b>
                {resultUtil ? (
                  <>
                    {pct(resultUtil.before)} → <i>{pct(resultUtil.after)}</i>
                  </>
                ) : simBefore !== null ? (
                  <>{pct(simBefore)} → ?</>
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
              <span>赏金 (MON)</span>
              <b className={shownBounty ? "fire" : ""}>{shownBounty !== undefined ? `+${mon(shownBounty)}` : "…"}</b>
            </div>
            <div>
              <span>净成本 (MON)</span>
              <b>{shownFee !== undefined && shownBounty !== undefined ? mon(shownFee - shownBounty) : "…"}</b>
            </div>
          </div>

          <div className="bdc-barhead">
            <span>
              {busy && !result
                ? `已发出 · 等待上链 ${waited} s`
                : result
                  ? "链上量出来的分段"
                  : `发送前的预测${simBusy ? " · 试算中…" : ""}`}
            </span>
            {result && (
              <a href={`${EXPLORER}/tx/${result.hash}`} target="_blank" rel="noreferrer">
                交易 {shortHash(result.hash)} ↗
              </a>
            )}
          </div>
          <GasBar result={result} lit={lit} limit={gasLimit} sending={busy && !result} pred={sim} />
          <Legend result={result} />

          <div className="bdc-oracle">
            <div className="bdc-oracle-text">
              <span className="bd-tag">实测</span>
              <span>
                <b>链上预言机</b>
                {sug && sug.gasLimit > 0
                  ? ` 记了 ${sug.samples} 次 · 这类调用最多用过 ${fmtGas(sug.maxUsed)} gas · 建议上限 ${fmtGas(sug.gasLimit)}`
                  : " 还没有这类调用的记录。先点“发送”走一遍。"}
              </span>
            </div>
            <button
              type="button"
              className="bd-btn"
              disabled={busy || !canSend || !sug || sug.gasLimit === 0}
              onClick={sendTight}
              title="读链上预言机给出的上限，直接把这笔调用发给应用"
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
              <span>被点燃</span>
              <span>赏金</span>
              <span>利用率</span>
              <span>交易</span>
            </div>
            {rows.length === 0 && <div className="bdc-empty">这一场还没有发过交易。左边调好，点“发送”。</div>}
            {rows.map((r) => (
              <button
                key={r.result.hash}
                type="button"
                className="bdc-tr"
                aria-pressed={result?.hash === r.result.hash}
                onClick={() => inspect(r)}
              >
                <span>{r.at}</span>
                <span>
                  {r.label}
                  {r.result.mainOk ? "" : " ✕"}
                </span>
                <span>{fmtGas(r.result.gasLimit)}</span>
                <span>{fmtGas(r.result.jobGas)}</span>
                <span>{mon(r.result.bountyMon)}</span>
                <span>
                  {pct(r.before)} → {pct(r.after)}
                </span>
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

          <h3>队列</h3>
          {jobs.length === 0 && <p className="bdc-empty">{totals ? "队列是空的。" : "读取中…"}</p>}
          {jobs.map((j) => (
            <div key={j.id} className="bdc-job">
              <b>
                #{j.id} {j.label}
              </b>
              <span>
                {(Number(j.bountyPerGas) / 1e9).toFixed(0)} gwei / gas · 押金 {fmtMon(j.escrow, 4)} MON ·{" "}
                {j.active ? "运行中" : "已停"}
              </span>
            </div>
          ))}

          <h3>链上模型</h3>
          <div className="bdc-model">
            <b>{model ? model.steps.toLocaleString("en-US") : "…"}</b>
            <span>
              步
              <br />
              误差 {model ? model.loss.toFixed(6) : "…"}
            </span>
          </div>

          <h3>累计</h3>
          <dl className="bdc-kv">
            <div className="hot">
              <dt>被点燃的 gas</dt>
              <dd>{totals ? fmtGas(totals.gasRecycled) : "…"}</dd>
            </div>
            <div>
              <dt>点火的交易</dt>
              <dd>{totals ? totals.burns : "…"}</dd>
            </div>
            <div>
              <dt>付出的赏金</dt>
              <dd>{totals ? `${fmtMon(totals.bountyPaid, 4)} MON` : "…"}</dd>
            </div>
          </dl>
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
