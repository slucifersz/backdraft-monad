"use client";

import { overheadOf, type Burn } from "./burn";
import { REPLAY, REPLAY_READ, type Measure } from "./replay";

// 三段：真实用量（紫）｜记录与固定开销（橙）｜没用上（斜线）。
type Seg = { call: number; rec: number; hatch: number; labels: [string, string, string] };

function fromMeasure(m: Measure, labels: Seg["labels"]): Seg {
  return { call: m.mainGas, rec: overheadOf(m), hatch: m.gasLeft, labels };
}

function segFor(active: string, main: Burn): Seg {
  const last = main.result ?? REPLAY.h500;
  switch (active) {
    case "s1":
      return { call: 67.5, rec: 0, hatch: 32.5, labels: ["67.5% 执行了", "", "32.5% 付了钱没用上"] };
    case "s2": // 主网上的一笔真实交易：申请 15,532,547，重算只需要 2,642,402
      return {
        call: 2642402,
        rec: 0,
        hatch: 15532547 - 2642402,
        labels: ["只需要 2,642,402", "", "申请了 15,532,547 · 回执上看不出差距"],
      };
    case "s3":
      return { call: 13, rec: 13, hatch: 74, labels: ["量", "记", "没用上"] };
    case "s4":
      return main.result && main.phase !== "sending"
        ? fromMeasure(main.result, ["真实用量", "记录", "没用上"])
        : { call: 0, rec: 0, hatch: 1, labels: ["", "", "已经按上限付了钱，还没有量"] };
    case "s5":
      return {
        call: REPLAY_READ.suggestion.maxUsed,
        rec: 0,
        hatch: REPLAY_READ.suggestion.gasLimit - REPLAY_READ.suggestion.maxUsed,
        labels: ["照着链上的数设，几乎没有空的", "", ""],
      };
    case "console":
      return fromMeasure(last, ["真实用量", "记录", "没用上"]);
    default:
      return fromMeasure(last, ["量", "记", "没有计量，就没有优化"]);
  }
}

/** 贯穿全页的同一根长条：每翻一版，它变成这一版在讲的那笔 gas。 */
export default function StoryBar({ active, main }: { active: string; main: Burn }) {
  const s = segFor(active, main);
  return (
    <div className="bd-story" aria-hidden="true">
      <div className="call" style={{ flexGrow: s.call }}>
        <span>{s.labels[0]}</span>
      </div>
      <div className="fire" style={{ flexGrow: s.rec }}>
        <span>{s.labels[1]}</span>
      </div>
      <div className="hatch bd-hatch" style={{ flexGrow: s.hatch }}>
        {s.labels[2] && <span>{s.labels[2]}</span>}
      </div>
    </div>
  );
}
