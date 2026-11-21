"use client";

import { useEffect, useRef, useState } from "react";
import { ADDR, EXPLORER, fmtGas, fmtMon, type Job, type Totals } from "@/lib/chain";
import { REPLAY, shortHash } from "./replay";

const DOCS_URL = "https://docs.monad.xyz/developer-essentials/gas-pricing";
const CATEGORY_URL = "https://www.category.xyz/blogs/setting-your-gas-limit-on-monad";
const GITHUB_URL = "https://github.com/slucifersz/backdraft-monad";

function Mast({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <header className="bd-mast">
      <div className="bd-brand">
        BACKDRAFT<span>{name}</span>
      </div>
      <div className="bd-meta">{children}</div>
    </header>
  );
}

const Tag = ({ children }: { children: React.ReactNode }) => <span className="bd-tag solid">{children}</span>;

/* ------------------------------------------------------------ 第 2 版 */

export function Sheet2() {
  return (
    <section className="bd-screen" id="s2" aria-label="只有 Monad 有">
      <Mast name="只有 Monad 有">
        <span>
          来源{" "}
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Monad 文档 · Gas pricing ↗
          </a>
        </span>
      </Mast>

      <h2 className="bds-h">
        别的链把没用完的 gas 退给你。
        <br />
        <span className="bd-purple">Monad</span> 把它留了下来。
      </h2>

      <div className="bds-vs">
        <div className="bds-vs-col">
          <h3>以太坊</h3>
          <p>
            用多少，扣多少。
            <br />
            没用完的退回。
            <br />
            没有剩余。
          </p>
        </div>
        <div className="bds-vs-col monad">
          <h3>Monad</h3>
          <p>
            填多少，扣多少。
            <br />
            不退。
            <br />
            剩余已经付过钱。
          </p>
        </div>
        <div className="bds-vs-text">
          <p className="bds-body">
            Monad 的区块在执行之前就已经排好，协议按每笔交易声明的上限预留算力。预留了、付了钱、却没用到的部分，就是这份资源。这是
            Monad 的设计带来的，别的链上不存在。
          </p>
        </div>
      </div>

      <p className="bds-quote">这是 Monad 的异步执行留给开发者的一座矿。到今天还没人开采。</p>

      <div className="bds-exp">
        <div className="bds-exp-main">
          <div className="bds-tagrow">
            <Tag>实测</Tag>
            <span className="bds-kicker">我们当天在测试网做的对照实验</span>
          </div>
          <div className="bds-exp-nums">
            <div>
              <span>这笔交易实际需要</span>
              <b>
                32,648<small>gas</small>
              </b>
            </div>
            <div>
              <span>我们填的上限</span>
              <b>
                300,000<small>gas</small>
              </b>
            </div>
            <div>
              <span>回执显示的 gasUsed</span>
              <b>
                300,000<small>gas</small>
              </b>
            </div>
            <div className="hot">
              <span>剩下没人用的</span>
              <b>89%</b>
            </div>
          </div>
          <p className="bds-small">回执和区块浏览器上的 gasUsed 显示的就是上限，所以这份资源一直没人看见。</p>
        </div>
        <aside className="bds-box" aria-label="来路">
          <span className="bds-kicker">来路</span>
          <p className="bds-small">
            我们今天原本想做一个省 gas 的工具。查资料时发现，Monad
            的研究团队已经把这个问题研究透了，连解法都给了。于是我们反过来想：省不掉的这部分，能不能用起来。
          </p>
        </aside>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ 第 3 版 */

const SKETCH_CELLS = Array.from({ length: 20 }, (_, i) => i);

export function Sheet3() {
  return (
    <section className="bd-screen" id="s3" aria-label="原理">
      <Mast name="原理">
        <span>量 · 烧 · 结 · 应用不用改一行代码</span>
      </Mast>

      <h2 className="bds-h">原理只有一句话。</h2>

      <p className="bdx-banner">一笔交易在结束之前，合约看得见自己还剩多少 gas，而且可以接着算别的。</p>

      <div className="bdx-lsj">
        <div className="bdx-step purple">
          <div className="bdx-char">量</div>
          <p>
            执行你的调用，前后各看一次还剩多少 gas。两次的差，就是你真正用掉的。Monad
            的回执不会告诉你这个数，只有在链上才量得到。
          </p>
        </div>
        <div className="bdx-step fire">
          <div className="bdx-char">烧</div>
          <p>把剩下的 gas 交给队列里的任务。任务一边算一边看剩余，不够下一步就自己停。拿多少，算多少。</p>
        </div>
        <div className="bdx-step">
          <div className="bdx-char">结</div>
          <p>
            按任务实际用掉的 gas 付赏金。钱来自挂任务的人的押金，付给发交易的人。单价不超过 gas 价格的九成。
          </p>
        </div>
      </div>

      <div className="bdx-map">
        <div>
          <div className="bds-bar" role="img" aria-label="示意：紫色段是量出来的你的调用，橙色段是被烧掉的剩余 gas">
            <div className="bds-bar-call" style={{ flex: "12 1 0" }} />
            <div className="bds-bar-job" style={{ flex: "64 1 0" }}>
              {SKETCH_CELLS.map((i) => (
                <i key={i} className="lit" />
              ))}
            </div>
            <div className="bd-hatch" style={{ flex: "11 1 0" }} />
            <div className="bds-bar-over" style={{ flex: "13 1 0" }} />
          </div>
          <div className="bdx-links">
            <span className="purple" style={{ flex: "12 1 0" }}>
              <b>量</b> 调用
            </span>
            <span className="fire" style={{ flex: "64 1 0" }}>
              <b>烧</b> 剩下的 gas，一格一格执行队列里的任务
            </span>
            <span className="plain" style={{ flex: "11 1 0" }}>
              仍未用到
            </span>
            <span className="plain" style={{ flex: "13 1 0" }}>
              固定开销
            </span>
          </div>
        </div>
        <div className="bdx-arrow" aria-hidden="true">
          →
        </div>
        <div className="bdx-settle">
          <b>结</b>
          <div>
            <span>你的余额</span>
            <strong>− 手续费　＋ 赏金</strong>
          </div>
        </div>
      </div>

      <div className="bds-three">
        <p className="bds-body">
          <b>只有 Monad 能做。</b>
          别的链上没有“已经付过钱的剩余”。
        </p>
        <p className="bds-body">
          <b>对发交易的人，不要钱。</b>
          这些 gas 已经付过了，烧不烧都是这个价。
        </p>
        <p className="bds-body">
          <b>不鼓励多留。</b>
          赏金最多是 gas 价格的九成，多留一定是亏的。
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ 第 7 版 */

const isHeartbeat = (label: string) => /heart|beat|心跳/i.test(label);
const PLACEHOLDER_JOBS = [
  { name: "训练链上模型", heavy: true },
  { name: "心跳", heavy: false },
];

function JobCard({ job }: { job: Job }) {
  const heavy = !isHeartbeat(job.label);
  return (
    <div className={`bds-job${heavy ? " heavy" : ""}`}>
      <div className="bds-job-top">
        <div>
          <div className="bds-job-name">{job.label}</div>
          <div className="bds-small">{heavy ? "重计算" : "只需要有人定期触发的那一类"}</div>
        </div>
        <span className={`bd-tag${job.active ? " solid" : ""}`}>{job.active ? "运行中" : "已停"}</span>
      </div>
      <div className="bds-job-fields">
        <div>
          <span>每单位 gas 的赏金</span>
          <b>
            {(Number(job.bountyPerGas) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })}
            <small>gwei</small>
          </b>
        </div>
        <div>
          <span>剩余押金</span>
          <b>
            {fmtMon(job.escrow, 4)}
            <small>MON</small>
          </b>
        </div>
      </div>
    </div>
  );
}

// 第三栏右上角的状态标签：要改就改这一处。
const AGENT_MCP_STATUS = "实测";

const WAY_JOB = `contract MyJob is IAfterburnerJob {
    function work() external returns (uint256 units) {
        // 拿到多少 gas，就做多少事
    }
}`;
const WAY_APP = `contract MyApp is BackdraftHook {
    function swap(...) external recycle {
        // ……你自己的逻辑……
    }
}`;
const MCP_TOOLS: [string, string][] = [
  ["backdraft_status", "查队列和累计数据"],
  ["backdraft_simulate", "这笔交易能点燃多少、赚回多少"],
  ["backdraft_send", "通过 Backdraft 发出并返回真实分段"],
];

export function Sheet7({ totals }: { totals: Totals | null }) {
  return (
    <section className="bd-screen" id="s7" aria-label="开放入口">
      <Mast name="开放入口">
        <span>接口 IAfterburnerJob · 任务板读链上实时数据</span>
      </Mast>

      <div className="bds-headrow">
        <h2 className="bds-h">一个函数，接上这台计算机。</h2>
        <p className="bds-sub">三种接法，对应三种角色。</p>
      </div>

      <div className="bdx-ways">
        <div className="bdx-way">
          <h3>你需要算力 —— 挂一个任务</h3>
          <pre className="bdx-code">
            <code>{WAY_JOB}</code>
          </pre>
          <p>
            <b>你得到：</b>比自己发交易更便宜的链上执行。
          </p>
        </div>
        <div className="bdx-way purple">
          <h3>你的用户有剩余 —— 加一个词</h3>
          <pre className="bdx-code">
            <code>{WAY_APP}</code>
          </pre>
          <p>
            <b>你得到：</b>给用户返手续费，或者把赏金收进自己的金库。调用者不变，出错不影响你的函数。
          </p>
          <p className="bds-small">实测 · 上限 500,000 → 回收 300,493 gas，赚回 28.6%</p>
        </div>
        <div className="bdx-way fire">
          <h3>
            你是 Agent —— 装上 MCP <Tag>{AGENT_MCP_STATUS}</Tag>
          </h3>
          <dl className="bdx-code bdx-tools">
            {MCP_TOOLS.map(([name, what]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <p>
            <b>你得到：</b>发交易前先问一句值不值得回燃。
          </p>
        </div>
      </div>

      <div className="bds-board">
        {totals
          ? (totals.jobs.some((j) => j.active) ? totals.jobs.filter((j) => j.active) : totals.jobs).map((job) => (
              <JobCard key={job.id} job={job} />
            ))
          : PLACEHOLDER_JOBS.map((j) => (
              <div key={j.name} className={`bds-job${j.heavy ? " heavy" : ""}`}>
                <div className="bds-job-top">
                  <div>
                    <div className="bds-job-name">{j.name}</div>
                    <div className="bds-small">{j.heavy ? "重计算" : "只需要有人定期触发的那一类"}</div>
                  </div>
                  <span className="bd-tag">读取中…</span>
                </div>
                <div className="bds-job-fields">
                  <div>
                    <span>每单位 gas 的赏金</span>
                    <b>读取中…</b>
                  </div>
                  <div>
                    <span>剩余押金</span>
                    <b>读取中…</b>
                  </div>
                </div>
              </div>
            ))}
        <div className="bds-board-note">
          <div className="bds-tagrow">
            <Tag>实测</Tag>
            <span className="bds-kicker">任务板 · 队列里正在跑的任务</span>
          </div>
          <p className="bds-sub">它们是两种完全不同的东西，用的是同一个接口。</p>
        </div>
      </div>

      <div className="bds-more">
        <div className="bds-more-list">
          <b>还能接什么</b>
          <span className="first">更大的链上模型训练与批量推理</span>
          <span>金库复利结算</span>
          <span>批量发放奖励</span>
          <span>链上游戏的世界推进</span>
          <span>过期数据清理</span>
        </div>
        <p className="bds-small">目前挂任务要直接调合约，还没有界面；任务按先后顺序执行。</p>
      </div>

      <p className="bds-quote fire">今天接进来的是一个模型。明天可以是你的。</p>
    </section>
  );
}

/* ------------------------------------------------------------ 引擎盖下 */

const HOOD: { title: string; text: string; figure: string }[] = [
  {
    title: "在链上量真实消耗",
    text: "合约在调用前后各读一次剩余 gas，把真实分段写进链上记录。",
    figure: "2 次读数",
  },
  { title: "拿多少，算多少", text: "任务每算一步就看一眼剩余，不够下一步就停。", figure: "每步约 10,000 gas" },
  {
    title: "恶意任务拖不垮你",
    text: "独立调用、gas 上限、失败捕获、只取回 32 字节、重入锁。",
    figure: "3 种攻击，0 次得手",
  },
  { title: "赏金上限写在合约里", text: "每单位 gas 的赏金不超过 gas 价格的九成。", figure: "≤ 90%" },
  {
    title: "按 Monad 的定价优化",
    text: "Monad 读一个冷存储槽 8,100 gas，以太坊 2,100。16 个训练样本压进 2 个存储槽。",
    figure: "固定开销 90,000 → 40,000",
  },
  {
    title: "全程在链上的梯度下降",
    text: "定点数运算，算预测、求梯度、更新参数都在合约里。",
    figure: "191 步，误差 0.14%",
  },
];

export function SheetHood() {
  return (
    <section className="bd-screen" id="hood" aria-label="引擎盖下">
      <Mast name="引擎盖下">
        <span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            源码 github.com/slucifersz/backdraft-monad ↗
          </a>
        </span>
      </Mast>

      <h2 className="bds-h">引擎盖下。</h2>

      <div className="bdx-hood">
        {HOOD.map((c, i) => (
          <div key={c.title} className="bdx-card">
            <div className="bdx-card-top">
              <span className="bdx-card-n">{i + 1}</span>
              <h3>{c.title}</h3>
              <Tag>实测</Tag>
            </div>
            <p>{c.text}</p>
            <div className="bdx-card-fig">{c.figure}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ 第 8 版 */

type LedgerKey = "official" | "wallet" | "h300" | "h500" | "failed";
const LEDGER: {
  key: LedgerKey;
  name: string;
  limit: string;
  burned: string;
  steps: string;
  fee: string;
  bounty: string;
  pct: string;
}[] = [
  { key: "official", name: "官方建议：估算 +7.5%", limit: "114,037", burned: "0", steps: "0", fee: "0.01152", bounty: "0", pct: "0%" },
  { key: "wallet", name: "钱包默认：估算 ×1.5", limit: "159,121", burned: "0", steps: "0", fee: "0.01607", bounty: "0", pct: "0%" },
  { key: "h300", name: "写死 300,000", limit: "300,000", burned: "126,377", steps: "7", fee: "0.03030", bounty: "0.00632", pct: "20.9%" },
  { key: "h500", name: "写死 500,000", limit: "500,000", burned: "323,478", steps: "26", fee: "0.05050", bounty: "0.01617", pct: "32.0%" },
  { key: "failed", name: "调用失败，上限 300,000", limit: "300,000", burned: "179,069", steps: "14", fee: "0.03030", bounty: "0.00895", pct: "29.5%" },
];

function MiniBar({ k }: { k: LedgerKey }) {
  const r = REPLAY[k];
  const overhead = r.gasLimit - r.mainGas - r.jobGas - r.gasLeft;
  return (
    <span className="bds-mini-wrap" aria-hidden="true">
      <span className="bds-mini" style={{ width: `${(r.gasLimit / 500000) * 100}%` }}>
        <i className="call" style={{ flex: `${r.mainGas} 1 0` }} />
        {r.jobGas > 0 && <i className="job" style={{ flex: `${r.jobGas} 1 0` }} />}
        <i className="left bd-hatch" style={{ flex: `${r.gasLeft} 1 0` }} />
        <i className="over" style={{ flex: `${overhead} 1 0` }} />
      </span>
    </span>
  );
}

export function Sheet8() {
  const [open, setOpen] = useState<LedgerKey | null>(null);
  return (
    <section className="bd-screen" id="s8" aria-label="账本">
      <Mast name="账本">
        <span>固定的演示调用 crunch(8) · Monad Testnet</span>
      </Mast>

      <div className="bds-headrow">
        <h2 className="bds-h">同一笔调用，五种上限。</h2>
        <div className="bds-tagrow">
          <Tag>实测</Tag>
          <span className="bds-small">每一行都是当天在 Monad 测试网上的一笔真实交易。点开任意一行看交易哈希。</span>
        </div>
      </div>

      <div className="bds-table">
        <div className="bds-tr head">
          <span>上限的设法</span>
          <span>gas 上限</span>
          <span>被点燃的 gas</span>
          <span>训练步数</span>
          <span>手续费 (MON)</span>
          <span>赚回 (MON)</span>
          <span>赚回比例</span>
          <span style={{ textAlign: "left" }}>这笔 gas 的去向</span>
        </div>
        {LEDGER.map((row) => {
          const hash = REPLAY[row.key].hash;
          const isOpen = open === row.key;
          return (
            <div key={row.key}>
              <button
                type="button"
                className={`bds-tr${row.burned !== "0" ? " hot" : ""}`}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : row.key)}
              >
                <span>{row.name}</span>
                <span>{row.limit}</span>
                <span>{row.burned}</span>
                <span>{row.steps}</span>
                <span>{row.fee}</span>
                <span>{row.bounty}</span>
                <b className="pct">{row.pct}</b>
                <MiniBar k={row.key} />
              </button>
              {isOpen && (
                <div className="bds-hash">
                  交易{" "}
                  <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
                    {shortHash(hash)} ↗
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="bds-quote">最便宜的永远是第一行。Backdraft 烧的，是后面三行已经付出去的钱。</p>
    </section>
  );
}

/* ------------------------------------------------------------ 第 9 版 */

function useAnimatedNumber(target: number) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - t0) / 900);
      setValue(start + (target - start) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target]);
  return value;
}

// 2026-11-21 14:27 的链上快照，只在读不到实时值时显示。
const SNAPSHOT = { gasRecycled: 3_605_878, burns: 20, units: 273, bountyMon: "0.1803" };

const CONTRACTS: { name: string; note?: string; address: string }[] = [
  { name: "Afterburner", note: "（Backdraft 的核心合约）", address: ADDR.afterburner },
  { name: "GasModel", address: ADDR.gasModel },
  { name: "DemoApp", address: ADDR.demoApp },
  { name: "Heartbeat", address: ADDR.heartbeat },
];

export function Sheet9({ totals }: { totals: Totals | null }) {
  const gas = useAnimatedNumber(totals ? totals.gasRecycled : SNAPSHOT.gasRecycled);
  return (
    <section className="bd-screen" id="s9" aria-label="存证与下一步">
      <Mast name="存证">
        <span>Monad Testnet · chainId 10143</span>
      </Mast>

      <h2 className="bds-h">付过钱的 gas，一格都不该浪费。</h2>

      <div className="bds-proof">
        <div className="bds-proof-col">
          <div className="bds-tagrow">
            <span className="bds-kicker">都在链上</span>
            <Tag>实测</Tag>
            {!totals && <span className="bd-tag">快照 · 2026-11-21 14:27</span>}
          </div>
          <div>
            <div className="bds-big">
              {Math.round(gas).toLocaleString("en-US")}
              <small>gas</small>
            </div>
            <div className="bds-kicker" style={{ marginTop: "0.6vh" }}>
              累计被点燃的 gas
            </div>
          </div>
          <div className="bds-stats">
            <div>
              <span>点火的交易笔数</span>
              <b>{totals ? fmtGas(totals.burns) : SNAPSHOT.burns}</b>
            </div>
            <div>
              <span>完成的工作单位</span>
              <b>{totals ? fmtGas(totals.units) : SNAPSHOT.units}</b>
            </div>
            <div>
              <span>付出的赏金（MON）</span>
              <b>{totals ? fmtMon(totals.bountyPaid, 4) : SNAPSHOT.bountyMon}</b>
            </div>
          </div>
          <ul className="bds-addrs">
            {CONTRACTS.map((c) => (
              <li key={c.name}>
                <span>
                  <b>{c.name}</b>
                  {c.note}
                </span>
                <a href={`${EXPLORER}/address/${c.address}`} target="_blank" rel="noreferrer">
                  {c.address}
                </a>
                <em>源码已验证</em>
              </li>
            ))}
          </ul>
          <p className="bds-small">
            10 项合约测试全部通过 · Monad Testnet · chainId 10143 · 源码{" "}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              github.com/slucifersz/backdraft-monad ↗
            </a>
          </p>
        </div>

        <div className="bds-proof-col">
          <span className="bds-kicker">接下来</span>
          <ul className="bds-next">
            <li>
              <span className="bd-tag">规划</span>
              <b>更大的链上模型</b>
              <p>把多层网络的训练拆成一步一步，挂进队列，让全网的剩余 gas 来算。</p>
            </li>
            <li>
              <Tag>已完成</Tag>
              <b>Agent 的尾气，训练链上的 AI</b>
              <p>
                Agent 自己构造交易，没有钱包替它设上限，剩得最多。仓库里的 skill 让它们发交易时顺手回燃。
              </p>
            </li>
            <li>
              <span className="bd-tag">规划</span>
              <b>智能账户模块</b>
              <p>让每一笔交易在末尾自动回燃，应用和调用者身份都不变。</p>
            </li>
            <li>
              <span className="bd-tag">规划</span>
              <b>按赏金排序的任务市场，和挂任务的界面。</b>
            </li>
          </ul>
          <p className="bds-small">
            今天的边界：任务何时被执行不确定，适合不赶时间的计算；今天通过包装合约发起调用，依赖调用者身份的应用还不能直接用；剩余少于约
            9 万 gas 的交易点不着；合约未经审计，只在测试网运行。
          </p>
        </div>
      </div>

      <div className="bds-end">
        <div className="bds-end-fire">没烧完的 gas，回头再烧一次。</div>
        <div className="bds-invite">
          <p>现场各位钱包里上午领的测试币，现在就可以拿来点一把火。</p>
          <p className="bds-small" style={{ color: "var(--ink)" }}>
            网址：（上线后填）
          </p>
        </div>
      </div>

      <footer className="bds-footer bds-small">
        <span>Monad Blitz @ 广州 · 2026-11-21 · 合约、脚本、页面全部在活动当天完成</span>
        <span>
          数据来源：
          <a href={CATEGORY_URL} target="_blank" rel="noreferrer">
            Category Labs
          </a>
          、
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Monad 文档
          </a>
        </span>
      </footer>
    </section>
  );
}
