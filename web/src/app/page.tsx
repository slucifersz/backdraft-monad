"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@/components/backdraft/backdraft.css";
import "@/components/backdraft/sheets.css";
import "@/components/backdraft/console.css";
import { demoAccount, readModel, readTotals, type ModelState, type Totals } from "@/lib/chain";
import { prefersReducedMotion, trainSteps, useBurn, type Mode } from "@/components/backdraft/burn";
import ConsoleSheet from "@/components/backdraft/ConsoleSheet";
import Front from "@/components/backdraft/Front";
import Ignite, { FailSheet } from "@/components/backdraft/Ignite";
import ModelSheet, { type BurnEvent } from "@/components/backdraft/ModelSheet";
import Proof from "@/components/backdraft/Proof";
import { REPLAY, type BurnResult } from "@/components/backdraft/replay";
import { Sheet2, Sheet3, Sheet7, Sheet8, Sheet9, SheetHood } from "@/components/backdraft/Sheets";
import StoryBar from "@/components/backdraft/StoryBar";

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

type Pending = { model: ModelState; event: BurnEvent };

export default function Home() {
  const [mode, setMode] = useState<Mode>(demoAccount ? "live" : "replay");
  const [model, setModel] = useState<ModelState | null>(null);
  const [modelSource, setModelSource] = useState<"live" | "record">("live");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [events, setEvents] = useState<BurnEvent[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [active, setActive] = useState("s1");
  const [anim, setAnim] = useState(false);
  const [autoTour, setAutoTour] = useState(true);
  const lock = useRef(false);
  const stepsRef = useRef(0);
  const hasModel = useRef(false);
  const autoTourRef = useRef(autoTour);
  autoTourRef.current = autoTour;

  // 读模型和累计数据。点火之后读到的新模型先放进 pending，等翻到第 5 版再让那条线动。
  const refresh = useCallback(async (after?: BurnResult) => {
    const prevSteps = stepsRef.current;
    const [m, t] = await Promise.allSettled([readModel(), readTotals()]);
    if (t.status === "fulfilled") setTotals(t.value);
    if (m.status === "fulfilled") {
      stepsRef.current = m.value.steps;
      hasModel.current = true;
      setModelSource("live");
      if (after) {
        const gained = m.value.steps - prevSteps;
        const steps = gained > 0 ? gained : trainSteps(after.units);
        setPending({
          model: m.value,
          event: { hash: after.hash, steps, from: Math.max(0, m.value.steps - steps), to: m.value.steps },
        });
      } else {
        setModel(m.value);
      }
    } else if (!hasModel.current) {
      hasModel.current = true;
      stepsRef.current = RECORDED_MODEL.steps;
      setModel(RECORDED_MODEL);
      setModelSource("record");
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("replay")) setMode("replay");
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pending || active !== "s5") return;
    const t = setTimeout(() => {
      setModel(pending.model);
      setEvents((e) => [...e, pending.event]);
      setPending(null);
    }, 800);
    return () => clearTimeout(t);
  }, [pending, active]);

  // 第 4 版烧完：实时模式下刷新数据；开着“自动去看模型”就自己滚到第 5 版。
  const afterMain = useCallback(
    (res: BurnResult) => {
      if (res.source === "live") refresh(res);
      if (autoTourRef.current && res.jobGas > 0) {
        setTimeout(
          () => document.getElementById("s5")?.scrollIntoView({ behavior: "smooth" }),
          prefersReducedMotion() ? 400 : 2400,
        );
      }
    },
    [refresh],
  );
  const afterFail = useCallback(
    (res: BurnResult) => {
      if (res.source === "live") refresh(res);
    },
    [refresh],
  );

  const main = useBurn({ lock, mode, onDone: afterMain });
  const fail = useBurn({ lock, mode, initial: REPLAY.failed, onDone: afterFail });
  const failRun = fail.run;

  const burnFailing = useCallback(() => {
    document.getElementById("s6")?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => failRun("fail", "failed", 300000), 900);
  }, [failRun]);

  // 翻到哪一版：给那一版加 .in（触发入场动效），并告诉贯穿全页的长条。
  useEffect(() => {
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".bd-screen"));
    const roomy = window.matchMedia("(min-width: 900px) and (min-height: 540px)").matches;
    const animate = roomy && !prefersReducedMotion();
    setAnim(animate);
    // 用滚动位置判断（不依赖 IntersectionObserver）：占屏一半以上算翻到，几乎离开才算翻走。
    const check = () => {
      const vh = window.innerHeight;
      let best = "";
      for (const s of sheets) {
        const r = s.getBoundingClientRect();
        const visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        const ratio = visible / Math.min(vh, r.height || vh);
        if (ratio >= 0.5) {
          s.classList.add("in");
          best = s.id;
        } else if (ratio <= 0.05) {
          s.classList.remove("in");
        }
      }
      if (best) setActive((prev) => (prev === best ? prev : best));
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const timer = setInterval(check, 400);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      clearInterval(timer);
    };
  }, []);

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
    <main className={`bd${anim ? " anim" : ""}`}>
      <Front active={active === "s1"} />
      <Sheet2 />
      <Sheet3 />
      <Ignite
        burn={main}
        mode={mode}
        setMode={setMode}
        onFail={burnFailing}
        autoTour={autoTour}
        setAutoTour={setAutoTour}
      />
      <ModelSheet model={model} source={modelSource} events={events} />
      <FailSheet burn={fail} mode={mode} />
      <Sheet7 totals={totals} />
      <SheetHood />
      <Sheet8 />
      <ConsoleSheet active={active === "console"} lock={lock} onSent={refresh} />
      <Sheet9 totals={totals} />
      <StoryBar active={active} main={main} fail={fail} />
      <Proof />
    </main>
  );
}
