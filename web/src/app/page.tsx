"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@/components/backdraft/backdraft.css";
import "@/components/backdraft/sheets.css";
import { demoAccount, readModel, readTotals, type ModelState, type Totals } from "@/lib/chain";
import { trainSteps, useBurn, type Mode } from "@/components/backdraft/burn";
import Front from "@/components/backdraft/Front";
import Ignite, { FailSheet } from "@/components/backdraft/Ignite";
import ModelSheet, { type BurnEvent } from "@/components/backdraft/ModelSheet";
import { REPLAY, type BurnResult } from "@/components/backdraft/replay";
import { Sheet2, Sheet3, Sheet7, Sheet8, Sheet9, SheetHood } from "@/components/backdraft/Sheets";

// 读不到链上数据时用的真实记录：16 个实测数据点和当天收敛后的参数（191 步）。
const RECORDED_MODEL: ModelState = {
  w: 0.7879,
  b: 0.5669,
  steps: 191,
  epoch: 0,
  loss: 0.000003,
  xScale: 32,
  yScale: 200000,
  history: [],
  ns: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32],
  gases: [
    44806, 54564, 64323, 74081, 83840, 93599, 103357, 113116, 122874, 132633, 142391, 152150, 163131, 172928,
    182725, 192522,
  ],
};

export default function Home() {
  const [mode, setMode] = useState<Mode>(demoAccount ? "live" : "replay");
  const [model, setModel] = useState<ModelState | null>(null);
  const [modelSource, setModelSource] = useState<"live" | "record">("live");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [events, setEvents] = useState<BurnEvent[]>([]);
  const lock = useRef(false);
  const modelRef = useRef<ModelState | null>(null);
  modelRef.current = model;

  const refresh = useCallback(async (after?: BurnResult) => {
    const prevSteps = modelRef.current?.steps ?? 0;
    const [m, t] = await Promise.allSettled([readModel(), readTotals()]);
    if (m.status === "fulfilled") {
      setModel(m.value);
      setModelSource("live");
      if (after) {
        const gained = m.value.steps - prevSteps;
        const steps = gained > 0 ? gained : trainSteps(after.units);
        setEvents((e) => [
          ...e,
          { hash: after.hash, steps, from: Math.max(0, m.value.steps - steps), to: m.value.steps },
        ]);
      }
    } else if (!modelRef.current) {
      setModel(RECORDED_MODEL);
      setModelSource("record");
    }
    if (t.status === "fulfilled") setTotals(t.value);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("replay")) setMode("replay");
    refresh();
  }, [refresh]);

  const main = useBurn({ lock, mode, onLive: refresh });
  const fail = useBurn({ lock, mode, initial: REPLAY.failed, onLive: refresh });
  const failRun = fail.run;

  const burnFailing = useCallback(() => {
    document.getElementById("s6")?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => failRun("fail", "failed", 300000), 700);
  }, [failRun]);

  // 键盘翻版：上下方向键、PageUp/PageDown、空格。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const down = e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey);
      const up = e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey);
      if (!down && !up) return;
      if (e.key === " " && el && /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const sheets = Array.from(document.querySelectorAll<HTMLElement>(".bd-screen"));
      if (!sheets.length) return;
      const y = window.scrollY;
      let cur = 0;
      sheets.forEach((s, i) => {
        if (s.offsetTop <= y + 8) cur = i;
      });
      const next = Math.min(sheets.length - 1, Math.max(0, cur + (down ? 1 : -1)));
      e.preventDefault();
      sheets[next].scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="bd">
      <Front />
      <Sheet2 />
      <Sheet3 />
      <Ignite burn={main} mode={mode} setMode={setMode} onFail={burnFailing} />
      <ModelSheet model={model} source={modelSource} events={events} />
      <FailSheet burn={fail} mode={mode} />
      <Sheet7 totals={totals} />
      <SheetHood />
      <Sheet8 />
      <Sheet9 totals={totals} />
    </main>
  );
}
