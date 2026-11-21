"use client";

import type { Burn } from "./burn";
import { REPLAY, type BurnResult } from "./replay";

type Seg = { call: number; fire: number; hatch: number; over: number; labels: [string, string, string, string] };

// 一笔交易的四段；lit 是已经点燃的格数。
function fromResult(r: BurnResult, lit: number, labels: Seg["labels"]): Seg {
  const fire = r.units > 0 ? r.jobGas * Math.min(1, lit / r.units) : 0;
  return {
    call: r.mainGas,
    fire,
    hatch: r.gasLeft + r.jobGas - fire,
    over: r.gasLimit - r.mainGas - r.jobGas - r.gasLeft,
    labels,
  };
}

function segFor(active: string, main: Burn, fail: Burn): Seg {
  const last = main.result ?? REPLAY.h500;
  const full = (labels: Seg["labels"]) => fromResult(last, last.units, labels);
  switch (active) {
    case "s1":
      return { call: 67.5, fire: 0, hatch: 32.5, over: 0, labels: ["67.5% 执行了", "", "32.5% 付了钱没用上", ""] };
    case "s2": // 当天的对照实验：实际需要 32,648，上限 300,000
      return {
        call: 32648,
        fire: 0,
        hatch: 300000 - 32648,
        over: 0,
        labels: ["实际需要 32,648", "", "上限 300,000 · 89% 没人用", ""],
      };
    case "s3":
      return { call: 12, fire: 64, hatch: 11, over: 13, labels: ["量", "烧 · 结", "仍未用到", "固定开销"] };
    case "s4":
      return main.result
        ? fromResult(main.result, main.lit, ["你的调用", "被点燃", "仍未用到", "固定开销"])
        : fromResult(REPLAY.h500, 0, ["你的调用", "", "已经付了钱，还没点火", "固定开销"]);
    case "s5":
      return full(["", "这一段在拟合回归线", "", ""]);
    case "s6": {
      const r = fail.result ?? REPLAY.failed;
      return fromResult(r, fail.result ? fail.lit : r.units, ["✕", "失败的交易，剩余也被用起来", "", ""]);
    }
    case "s7":
      return full(["", "你的任务可以接在这一段", "", ""]);
    case "hood":
      return full(["量出来的", "拿多少，算多少", "", ""]);
    case "console":
      return full(["你的调用", "你点燃的", "", ""]);
    case "s8":
      return full(["", "写死的上限：这一大段已经付出去了", "", ""]);
    default:
      return full(["", "没有计量，就没有优化", "", ""]);
  }
}

/** 贯穿全页的同一根长条：每翻一版，它变成这一版在讲的那笔 gas。 */
export default function StoryBar({ active, main, fail }: { active: string; main: Burn; fail: Burn }) {
  const s = segFor(active, main, fail);
  return (
    <div className="bd-story" aria-hidden="true">
      <div className="call" style={{ flexGrow: s.call }}>
        <span>{s.labels[0]}</span>
      </div>
      <div className="fire" style={{ flexGrow: s.fire }}>
        <span>{s.labels[1]}</span>
      </div>
      <div className="hatch bd-hatch" style={{ flexGrow: s.hatch }}>
        {s.labels[2] && <span>{s.labels[2]}</span>}
      </div>
      <div className="over" style={{ flexGrow: s.over }}>
        <span>{s.labels[3]}</span>
      </div>
    </div>
  );
}
