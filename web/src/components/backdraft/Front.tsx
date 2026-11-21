"use client";

import { useEffect, useState } from "react";
import { useCountUp } from "./burn";

// 估算：1,348 个塞满的区块 × 每块 1.5 亿 gas ≈ 2000 亿 gas/天 ≈ 每秒 234 万。
const WASTED_GAS_PER_SEC = (1348 * 150_000_000) / 86_400;

function SinceOpen() {
  const [gas, setGas] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const read = () => setGas(((performance.now() - t0) / 1000) * WASTED_GAS_PER_SEC);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = setInterval(read, 1000);
      return () => clearInterval(timer);
    }
    let raf = requestAnimationFrame(function tick() {
      read();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="bd-since">
      <span>你打开这一页以来，又有</span>
      <b>{Math.floor(gas).toLocaleString("en-US")}</b>
      <span>gas 付了钱没人用</span>
      <span className="bd-tag solid">估算</span>
      <span className="bd-note">每秒约 234 万</span>
    </div>
  );
}

export default function Front({ active }: { active: boolean }) {
  const big = useCountUp(2000, active, 1100);
  return (
    <section className="bd-screen" id="s1" aria-label="头版">
      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>回燃</span>
        </div>
        <div className="bd-meta">一个不用喂钱的链上 Gas 预言机 · Monad Blitz @ 广州 · 2026-11-21</div>
      </header>

      <div className="bd-front-main">
        <div className="bd-front-figure">
          <div className="bd-giant">
            {Math.round(big)}
            <span className="bd-giant-cn">亿</span>
          </div>
          <div className="bd-front-unit">
            <span>gas / 每天</span>
            <span className="bd-tag solid">估算</span>
          </div>
        </div>
        <div className="bd-front-side">
          <h1 className="bd-headline">付了钱，没人用。</h1>
          <p className="bd-sub">
            回执里查不到它们到底用了多少。
            <br />
            Backdraft 让这个数字上了链，一分钱不用多花。
          </p>
          <p className="bd-body">
            <span className="bd-purple">Monad</span>{" "}
            主网上，每天有这么多算力已经有人付了钱、占好了位置，却什么都没算。够塞满 1,348 个区块。
          </p>
        </div>
      </div>

      <div>
        <div className="bd-split" role="img" aria-label="67.5% 的 gas 执行了，32.5% 付了钱没用上">
          <div className="bd-split-used">67.5% 执行了</div>
          <div className="bd-split-waste bd-hatch fire drift">
            <span>32.5% 付了钱没用上</span>
          </div>
        </div>
        <div className="bd-split-notes">
          <span className="bd-note">
            估算算法：116 万笔/天 × 每笔约 17 万未用 gas ≈ 2000 亿；÷ 每步训练约 1 万 gas ≈ 2000
            万步（按 Category Labs 公开数据和我们的实测推算）
          </span>
          <span className="bd-note">
            <span className="bd-tag solid">实测</span>{" "}
            <a href="https://www.category.xyz/blogs/setting-your-gas-limit-on-monad" target="_blank" rel="noreferrer">
              Category Labs · 2026-01-12 至 18 · 766 万笔成功交易 ↗
            </a>
          </span>
        </div>
      </div>

      <SinceOpen />

      <div className="bd-front-foot">
        <div className="bd-block">我们把它点着了。</div>
        <div className="bd-col">
          <b>只有 Monad 有</b>
          <p>别的链把没用完的 gas 退给你。Monad 不退：交易结束之前，这部分额度已经付过钱。</p>
        </div>
        <div className="bd-col">
          <b>回燃</b>
          <p>用这笔本来要作废的 gas，把“这类调用到底用了多少”记到链上。下一笔照着设，就不用再多付。</p>
        </div>
        <a className="bd-btn" href="#s4">
          点火 ↓
        </a>
      </div>
    </section>
  );
}
