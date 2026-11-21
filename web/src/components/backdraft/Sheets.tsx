"use client";

import { ADDR, EXPLORER } from "@/lib/chain";

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

/* ------------------------------------------------------------ 第 2 版 · 缺一个数 */

// 主网上的一笔真实交易（2026-11-21 下午抽查）。
const REAL_TX = { asked: 15_532_547, needed: 2_642_402 };

export function Sheet2() {
  return (
    <section className="bd-screen" id="s2" aria-label="缺一个数">
      <Mast name="缺一个数">
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
        <span className="bd-purple">Monad</span> 不退，回执里也查不到用了多少。
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
            Monad 的区块在执行之前就已经排好，协议按每笔交易声明的上限预留算力。预留了、付了钱、却没用到的部分，谁也看不见：回执上只有上限。这是
            Monad 的设计带来的，别的链上不存在。
          </p>
        </div>
      </div>

      <p className="bds-quote">Monad 的回执里缺一个数字：这笔交易到底用了多少 gas。我们让它上了链。</p>

      <div className="bds-exp two">
        <div className="bdm-ex">
          <div className="bds-tagrow">
            <Tag>实测</Tag>
            <span className="bds-kicker">主网上的一笔真实交易</span>
          </div>
          <div className="bdm-ex-nums">
            <div>
              <span>申请了</span>
              <b>
                {REAL_TX.asked.toLocaleString("en-US")}
                <small>gas</small>
              </b>
            </div>
            <div className="need">
              <span>重算只需要</span>
              <b>
                {REAL_TX.needed.toLocaleString("en-US")}
                <small>gas</small>
              </b>
            </div>
          </div>
          <div className="bdm-ex-bar" role="img" aria-label="申请的 gas 里，只有 17% 是需要的">
            <i style={{ width: `${(REAL_TX.needed / REAL_TX.asked) * 100}%` }} />
            <i className="bd-hatch" />
          </div>
          <p className="bds-small">
            2026-11-21 下午抽查主网连续 158 笔交易，其中 38 笔的上限是 500,000、1,600,000 这样的整数。
          </p>
          <p className="bdm-ex-point">发这笔交易的人看不到这个差距。回执上，这两个数是一样的。</p>
        </div>

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
          <p className="bds-small">回执和区块浏览器上的 gasUsed 显示的就是上限，所以这个差距一直没人看见。</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ 第 3 版 · 原理 */

export function Sheet3() {
  return (
    <section className="bd-screen" id="s3" aria-label="原理">
      <Mast name="原理">
        <span>量 · 记 · 读 · 应用不用改一行代码</span>
      </Mast>

      <h2 className="bds-h">原理只有一句话。</h2>

      <p className="bdx-banner">一笔交易在结束之前，合约看得见自己还剩多少 gas。所以真实用量，在链上量得出来。</p>

      <div className="bdx-lsj">
        <div className="bdx-step purple">
          <div className="bdx-char">量</div>
          <p>
            执行你的调用，前后各看一次还剩多少 gas。两次的差，就是你真正用掉的。Monad
            的回执不会告诉你这个数，只有在链上才量得到。
          </p>
        </div>
        <div className="bdx-step fire">
          <div className="bdx-char">记</div>
          <p>用这笔交易里本来要作废的剩余 gas，把这个数按“合约 + 函数”记到链上。只写自己的一格存储，不碰任何人的状态。</p>
        </div>
        <div className="bdx-step">
          <div className="bdx-char">读</div>
          <p>
            之后任何钱包、Agent、合约读一次链，就拿到建议的上限：实测最大用量加 7.5% 余量。下一笔照着设，不再多付。
          </p>
        </div>
      </div>

      <div className="bdx-map">
        <div>
          <div
            className="bds-bar"
            role="img"
            aria-label="示意：紫色段是量出来的真实用量，橙色段是把它记到链上的开销，斜线段是没用上的"
          >
            <div className="bds-bar-call" style={{ flex: "13 1 0" }} />
            <div className="bds-bar-rec" style={{ flex: "13 1 0" }} />
            <div className="bd-hatch" style={{ flex: "74 1 0" }} />
          </div>
          <div className="bdx-links">
            <span className="purple" style={{ flex: "13 1 0" }}>
              <b>量</b> 用量
            </span>
            <span className="fire" style={{ flex: "13 1 0" }}>
              <b>记</b> 上链
            </span>
            <span className="plain" style={{ flex: "74 1 0" }}>
              没用上：申请了，付了钱，回执上看不出来
            </span>
          </div>
        </div>
        <div className="bdx-arrow" aria-hidden="true">
          →
        </div>
        <div className="bdx-settle">
          <b>读</b>
          <div>
            <span>下一笔</span>
            <strong>上限照着设</strong>
          </div>
        </div>
      </div>

      <div className="bds-three">
        <p className="bds-body">
          <b>只有 Monad 能做。</b>
          别的链上没有“已经付过钱的剩余”。
        </p>
        <p className="bds-body">
          <b>一分钱不用多花。</b>
          记这个数用的 gas 已经付过了，不记也是这个价。
        </p>
        <p className="bds-body">
          <b>只做一件小事。</b>
          记一次只要几万 gas。它不调用别的合约，不破坏交易的整体性。
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ 第 6 版 · 怎么用 */

// 第三栏右上角的状态标签：要改就改这一处。
const AGENT_MCP_STATUS = "实测";

const WAY_READ = `// 这个函数实际用多少 gas？问链。
uint256 gasLimit =
    backdraft.suggestTxGasLimit(target, data);`;
const WAY_APP = `contract MyApp is BackdraftHook {
    function swap(...) external recycle {
        // ……你自己的逻辑……
    }
}`;
const MCP_TOOLS: [string, string][] = [
  ["backdraft_status", "读流量计现在的读数"],
  ["backdraft_simulate", "发之前先试算一遍"],
  ["backdraft_send", "经过 Backdraft 发出，量一次"],
];

export function Sheet6() {
  return (
    <section className="bd-screen" id="s6" aria-label="怎么用">
      <Mast name="怎么用">
        <span>suggestTxGasLimit(target, data) · Monad Testnet · chainId 10143</span>
      </Mast>

      <h2 className="bds-h">没有计量，就没有优化。</h2>

      <div className="bdu-grid">
        <div className="bdu-col">
          <span className="bds-kicker">怎么接</span>
          <div className="bdu-ways">
            <div className="bdx-way">
              <div>
                <h3>你要设上限 —— 读一次链</h3>
                <p>
                  <b>你得到：</b>这个合约的这个函数，链上实测用量加 7.5%
                  余量。官方文档点名要重查 gas 设置的跨链执行、4337、keeper、relayer，现在有地方查了。
                </p>
              </div>
              <pre className="bdx-code">
                <code>{WAY_READ}</code>
              </pre>
            </div>
            <div className="bdx-way purple">
              <div>
                <h3>你的应用想出一份力 —— 加一个词</h3>
                <p>
                  <b>你得到：</b>用户的每一笔交易经过时顺手量一次、记一次。调用者不变，出错不影响你的函数。
                </p>
              </div>
              <pre className="bdx-code">
                <code>{WAY_APP}</code>
              </pre>
            </div>
            <div className="bdx-way fire">
              <div>
                <h3>
                  你是 Agent —— 装上 MCP <Tag>{AGENT_MCP_STATUS}</Tag>
                </h3>
                <p>
                  <b>你得到：</b>没有钱包替你设上限。发交易前先读一次流量计。
                </p>
              </div>
              <dl className="bdx-code bdx-tools">
                {MCP_TOOLS.map(([name, what]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>

        <div className="bdu-col">
          <span className="bds-kicker">接下来三步</span>
          <ul className="bds-next">
            <li>
              <Tag>草案已写</Tag>
              <b>提成 MRC</b>
              <p>登记表的接口已整理成 MRC 草案，在仓库里。</p>
            </li>
            <li>
              <span className="bd-tag">规划</span>
              <b>进钱包和 SDK</b>
              <p>发交易前读一次流量计，一行代码。</p>
            </li>
            <li>
              <span className="bd-tag">规划</span>
              <b>补全历史</b>
              <p>等官方通过 RPC 公开真实用量后，把历史数据批量补进来。</p>
            </li>
          </ul>
          <p className="bdu-est">
            <Tag>估算</Tag>
            按官方研究的结论，全网多付的 gas 能从三成降到一成多；同样的区块能多装约四分之一的交易。算法：多付的占比从
            32.5% 降到约 15%，执行的占比从 67.5% 升到约 85%，85 ÷ 67.5 ≈ 1.26（
            <a href={CATEGORY_URL} target="_blank" rel="noreferrer">
              Category Labs 数据 ↗
            </a>
            ）。
          </p>
          <p className="bds-small">
            今天的边界：只有经过它的交易才会被计量；只记最大值，输入变化大的函数还不够准，使用前要先估算一次；通过包装入口测量时调用者会变；合约未经审计，只在测试网运行。
          </p>
        </div>
      </div>

      <p className="bdu-proofline">
        <span>核心合约</span>
        <a href={`${EXPLORER}/address/${ADDR.afterburner}`} target="_blank" rel="noreferrer">
          {ADDR.afterburner}
        </a>
        <span>（源码已验证）· 14 项测试 ·</span>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          github.com/slucifersz/backdraft-monad ↗
        </a>
      </p>

      <div className="bds-end">
        <div className="bds-end-fire">Backdraft：Monad 的流量计。</div>
        <div className="bds-invite">
          <p>最后一版是控制台，可以自己调参数、试算、发送。</p>
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
