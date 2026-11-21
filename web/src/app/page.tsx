"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@/components/backdraft/backdraft.css";
import "@/components/backdraft/sheets.css";
import "@/components/backdraft/console.css";
import "@/components/backdraft/meter.css";
import { demoAccount } from "@/lib/chain";
import { prefersReducedMotion, useMeasure, type Mode } from "@/components/backdraft/burn";
import ConsoleSheet from "@/components/backdraft/ConsoleSheet";
import Front from "@/components/backdraft/Front";
import MeasureSheet from "@/components/backdraft/MeasureSheet";
import Proof from "@/components/backdraft/Proof";
import ReadSheet from "@/components/backdraft/ReadSheet";
import type { Measure } from "@/components/backdraft/replay";
import { Sheet2, Sheet3, Sheet6 } from "@/components/backdraft/Sheets";
import StoryBar from "@/components/backdraft/StoryBar";

export default function Home() {
  const [mode, setMode] = useState<Mode>(demoAccount ? "live" : "replay");
  const [active, setActive] = useState("s1");
  const [anim, setAnim] = useState(false);
  // 本场在第 4 版用上限 500,000 实时发过的那一笔，第 5 版拿它做对比。
  const [loose, setLoose] = useState<Measure | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("replay")) setMode("replay");
  }, []);

  const afterMeasure = useCallback((res: Measure) => {
    if (res.source === "live" && res.gasLimit === 500000) setLoose(res);
  }, []);
  const main = useMeasure({ lock, mode, onDone: afterMeasure });

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
      <MeasureSheet burn={main} mode={mode} setMode={setMode} />
      <ReadSheet active={active === "s5"} lock={lock} mode={mode} loose={loose} round={main.round} />
      <Sheet6 />
      <ConsoleSheet active={active === "console"} lock={lock} />
      <StoryBar active={active} main={main} />
      <Proof />
    </main>
  );
}
