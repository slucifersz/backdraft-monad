"use client";

import { useEffect, useState } from "react";

// 估算：Category Labs 一周 815 万笔交易 ≈ 116 万笔/天；每笔约 17 万 gas 未用；
// 116 万 × 17 万 ≈ 2000 亿 gas/天 ÷ 86,400 秒 ≈ 230 万 gas/秒。
const WASTED_GAS_PER_SEC = 2_000e8 / 86_400;
const BLOCK_GAS_LIMIT = 150_000_000;
const ESTIMATE_NOTE =
  "估算算法：Category Labs 公开数据，约 116 万笔/天 × 每笔约 17 万未用 gas ≈ 2000 亿 gas/天 ≈ 每秒 230 万";

function IdleCounter() {
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

  const blocks = gas / BLOCK_GAS_LIMIT;
  return (
    <div className="bd-counter" title={ESTIMATE_NOTE}>
      <div className="bd-counter-label">
        <span>
          你打开这一页之后，Monad 主网上
          <br />
          又有这么多 gas 付了钱、什么都没算
        </span>
        <span className="bd-tag">估算</span>
      </div>
      <div className="bd-counter-num" aria-live="off">
        {Math.floor(gas).toLocaleString("en-US")}
        <small>gas ≈ {blocks.toFixed(1)} 个塞满的区块</small>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="bd-screen" aria-label="问题">
      <header className="bd-mast">
        <div className="bd-brand">
          BACKDRAFT<span>回燃</span>
        </div>
        <div className="bd-meta">Monad Blitz @ 广州 · 2026-11-21 · 全部内容当天完成</div>
      </header>

      <div className="bd-hero-main">
        <div className="bd-giant">32.5%</div>
        <div className="bd-hero-side">
          <span className="bd-tag solid">实测</span>
          <p className="bd-lead">
            <span className="bd-purple">Monad</span> 主网上，平均这么多 gas 付了钱，没用上。
          </p>
          <a
            className="bd-src"
            href="https://www.category.xyz/blogs/setting-your-gas-limit-on-monad"
            target="_blank"
            rel="noreferrer"
          >
            Category Labs · 2026-01-12–18 · 766 万笔成功交易 ↗
          </a>
        </div>
      </div>

      <div>
        <div className="bd-split" role="img" aria-label="67.5% 的 gas 被执行，32.5% 付了钱没有执行">
          <div className="bd-split-used">67.5% 执行了</div>
          <div className="bd-split-waste bd-hatch drift">
            <span>付了钱，在空转</span>
          </div>
        </div>
      </div>

      <IdleCounter />

      <div className="bd-hero-foot">
        <div>
          <h1 className="bd-slogan">没烧完的 gas，回头再烧一次。</h1>
          <p className="bd-note">{ESTIMATE_NOTE}</p>
        </div>
        <div className="bd-hero-cta">
          <p className="bd-rule">
            在 <span className="bd-purple">Monad</span> 上，gas 上限设多少就扣多少，不退。
          </p>
          <a className="bd-btn" href="#try">
            发一笔真实交易 ↓
          </a>
        </div>
      </div>
    </section>
  );
}
