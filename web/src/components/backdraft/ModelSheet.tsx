"use client";

import { useEffect, useRef, useState } from "react";
import { ADDR, EXPLORER, fmtGas, modelPredict, type ModelState } from "@/lib/chain";
import { prefersReducedMotion } from "./burn";
import { shortAddr, shortHash } from "./replay";

export type BurnEvent = { hash: string; steps: number; from: number; to: number };

// 当天真实记录的误差（步数 → 误差），读不到链上数据时用来画曲线。
export const LOSS_RECORD: [number, number][] = [
  [1, 0.4014],
  [10, 0.1525],
  [25, 0.0304],
  [50, 0.00207],
  [100, 0.000012],
  [150, 0.000003],
  [191, 0.000003],
];

const W = 640;
const H = 330;
const P = { l: 70, r: 14, t: 14, b: 38 };
const N_MAX = 34;
const G_MAX = 220000;
const px = (n: number) => P.l + (n / N_MAX) * (W - P.l - P.r);
const py = (g: number) => H - P.b - (Math.min(g, G_MAX) / G_MAX) * (H - P.t - P.b);

const LW = 420;
const LH = 150;
const LP = { l: 46, r: 8, t: 8, b: 22 };

function useTweened(w: number, b: number) {
  const [cur, setCur] = useState({ w, b });
  const curRef = useRef(cur);
  curRef.current = cur;
  useEffect(() => {
    const start = { ...curRef.current };
    if (prefersReducedMotion() || (start.w === w && start.b === b)) {
      setCur({ w, b });
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - t0) / 1400);
      const e = 1 - Math.pow(1 - k, 3);
      setCur({ w: start.w + (w - start.w) * e, b: start.b + (b - start.b) * e });
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [w, b]);
  return cur;
}

export default function ModelSheet({
  model,
  source,
  events,
}: {
  model: ModelState | null;
  source: "live" | "record";
  events: BurnEvent[];
}) {
  const tw = useTweened(model?.w ?? 0, model?.b ?? 0);
  const [flash, setFlash] = useState<BurnEvent | null>(null);

  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    setFlash(last);
    const t = setTimeout(() => setFlash(null), 9000);
    return () => clearTimeout(t);
  }, [events]);

  const scale = { xScale: model?.xScale ?? 32, yScale: model?.yScale ?? 200000 };
  const g2 = modelPredict({ ...tw, ...scale }, 2);
  const g32 = modelPredict({ ...tw, ...scale }, 32);
  const fresh = !!model && model.steps === 0;

  // 误差曲线：有链上 history 就用它，否则用当天记录的几个点。
  const series: [number, number][] =
    model && model.history.length > 1 ? model.history.map((v, i) => [i + 1, v]) : LOSS_RECORD;
  const maxStep = Math.max(10, series[series.length - 1][0]);
  const lx = (s: number) => LP.l + (s / maxStep) * (LW - LP.l - LP.r);
  const ly = (v: number) => {
    const lg = Math.log10(Math.max(v, 1e-6)); // 0 … -6
    return LP.t + (-lg / 6) * (LH - LP.t - LP.b);
  };
  const lossPath = series.map(([s, v], i) => `${i ? "L" : "M"}${lx(s).toFixed(1)},${ly(v).toFixed(1)}`).join(" ");

  return (
    <section className="bd-screen" id="s5" aria-label="回归线">
      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>回归线</span>
        </div>
        <div className="bd-meta">
          {source === "record" && <span className="bd-notice">回放 · 当天真实记录</span>}
          <a href={`${EXPLORER}/address/${ADDR.gasModel}`} target="_blank" rel="noreferrer">
            GasModel {shortAddr(ADDR.gasModel)} ↗
          </a>
        </div>
      </header>

      <div>
        <h2 className="bd-headline">
          {fresh ? "还没开始。去点一把火。" : "输入越大，用得越多。剩余的 gas 在链上拟合这条线。"}
        </h2>
        <p className="bd-body">有的函数，用量随输入规模变化，记一个数不够。预言机就用剩余的 gas 在链上拟合一条直线，两个参数，每一步都由交易里本来要作废的 gas 支付。</p>
      </div>

      <div className="bd-model">
        <div className="bd-model-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="散点是 16 个实测值，橙线是模型当前的预测">
            {[0, 50000, 100000, 150000, 200000].map((g) => (
              <g key={g}>
                <line x1={P.l} x2={W - P.r} y1={py(g)} y2={py(g)} stroke="#0a0a0a" strokeWidth={g === 0 ? 2.5 : 0.6} />
                <text x={P.l - 8} y={py(g) + 4} textAnchor="end" fontSize="13">
                  {g / 1000}k
                </text>
              </g>
            ))}
            {[2, 8, 16, 24, 32].map((n) => (
              <text key={n} x={px(n)} y={H - P.b + 18} textAnchor="middle" fontSize="13">
                {n}
              </text>
            ))}
            <text x={W - P.r} y={H - 4} textAnchor="end" fontSize="13" fontWeight="600">
              输入规模 n →
            </text>
            <text x={P.l + 6} y={P.t + 12} fontSize="13" fontWeight="600">
              gas
            </text>
            <line
              x1={px(2)}
              y1={py(g2)}
              x2={px(32)}
              y2={py(g32)}
              stroke="#ff4311"
              strokeWidth={flash ? 9 : 6}
              strokeLinecap="round"
            />
            {(model?.ns ?? []).map((n, i) => (
              <circle key={n} cx={px(n)} cy={py(model!.gases[i])} r="6" fill="#0a0a0a" />
            ))}
          </svg>
          {flash && (
            <div className="bd-model-flash bd-slam">
              +{flash.steps} 步 · 来自交易 {shortHash(flash.hash)}
            </div>
          )}
          <p className="bd-model-explain">一步训练，就是看模型现在错了多少，把它的参数往对的方向挪一点。</p>
          <div className="bd-model-key">
            <span>
              <i className="dot" /> 16 个实测值
            </span>
            <span>
              <i className="line" /> 模型当前的预测
            </span>
          </div>
        </div>

        <div className="bd-model-side">
          <div>
            <div className="bd-model-steps">{model ? model.steps.toLocaleString("en-US") : "…"}</div>
            <div className="bd-model-unit">
              步 · 全部由剩余 gas 支付 <span className="bd-tag solid">实测</span>
            </div>
            {model && (
              <div className="bd-note">
                当前误差 {model.loss.toFixed(6)} · 对 n=8 的预测 {fmtGas(modelPredict(model, 8))}，实测 74,081
              </div>
            )}
          </div>
          <div className="bd-model-loss">
            <svg viewBox={`0 0 ${LW} ${LH}`} role="img" aria-label="误差随训练步数下降，纵轴为对数刻度">
              {[0, -2, -4, -6].map((e) => (
                <g key={e}>
                  <line
                    x1={LP.l}
                    x2={LW - LP.r}
                    y1={ly(Math.pow(10, e))}
                    y2={ly(Math.pow(10, e))}
                    stroke="#0a0a0a"
                    strokeWidth="0.5"
                  />
                  <text x={LP.l - 6} y={ly(Math.pow(10, e)) + 4} textAnchor="end" fontSize="12">
                    {e === 0 ? "1" : `1e${e}`}
                  </text>
                </g>
              ))}
              {events.map((ev) => (
                <g key={ev.hash}>
                  <rect
                    x={lx(ev.from)}
                    y={LP.t}
                    width={Math.max(2, lx(ev.to) - lx(ev.from))}
                    height={LH - LP.t - LP.b}
                    fill="#ff4311"
                    opacity="0.18"
                  />
                  <line x1={lx(ev.from)} x2={lx(ev.from)} y1={LP.t} y2={LH - LP.b} stroke="#ff4311" strokeWidth="2" />
                </g>
              ))}
              <path d={lossPath} fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinejoin="round" />
              <text x={LW - LP.r} y={LH - 4} textAnchor="end" fontSize="12" fontWeight="600">
                误差（对数） · 训练步数 →
              </text>
            </svg>
            {events.length > 0 && <div className="bd-note">橙色的每一段，是这一场里的一把火烧出来的。</div>}
          </div>
        </div>
      </div>

      <div className="bd-facts">
        <div>
          <b>
            全程在链上 <span className="bd-tag solid">实测</span>
          </b>
          <p>算预测、求梯度、更新参数，都在合约里完成。任何人可以逐步验证。</p>
        </div>
        <div>
          <b>训练好就是公共品</b>
          <p>任何合约都可以直接调用它的 predict(n)。</p>
        </div>
        <div>
          <b>目前最好成绩</b>
          <p>191 步，预测误差 0.14%。</p>
        </div>
      </div>

      <p className="bd-quote">
        它学的是“一笔调用需要多少 gas”。用没人用的 gas，拟合一条让 gas 少被闲置的线。
      </p>

      <p className="bd-note">
        <span className="bd-tag solid">估算</span> 全网每天 2000 亿空转的 gas，够它训练约 2000 万步（2000 亿 ÷ 每步约 1
        万 gas）。这是一个只有两个参数的线性模型，是一天之内能在链上完整训练并验证的规模。机制本身不限制模型大小：更大的模型只是把训练拆成更多步挂进队列。
      </p>
    </section>
  );
}
