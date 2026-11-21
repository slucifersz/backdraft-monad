"use client";

// 预览路由：先看第一屏和“长条点燃”两屏的效果。确认后再搬到 app/page.tsx。
import "@/components/backdraft/backdraft.css";
import Demo from "@/components/backdraft/Demo";
import Hero from "@/components/backdraft/Hero";

export default function Preview() {
  return (
    <main className="bd">
      <Hero />
      <Demo />
    </main>
  );
}
