"use client";

import { useEffect, useState } from "react";
import { ADDR, EXPLORER } from "@/lib/chain";

type ProofLink = { href: string; label: string };
type Pop = { left: number; top: number; up: boolean; kind: string; text: string; links: ProofLink[] };

const CATEGORY: ProofLink = {
  href: "https://www.category.xyz/blogs/setting-your-gas-limit-on-monad",
  label: "Category Labs：Setting your gas limit on Monad ↗",
};
const CONTRACT: ProofLink = {
  href: `${EXPLORER}/address/${ADDR.afterburner}`,
  label: "Afterburner 合约（源码已验证）↗",
};
const REPO: ProofLink = { href: "https://github.com/slucifersz/backdraft-monad", label: "源码仓库 ↗" };

const COPY: Record<string, string> = {
  实测: "这个数字不是写死的：它来自链上读数，或当天在 Monad 测试网上的真实交易记录，可以在区块浏览器上核对。",
  估算: "这是推算出来的数字，不是直接测量。算法：116 万笔/天 × 每笔约 17 万未用 gas ≈ 2000 亿 gas/天（按 Category Labs 公开数据推算）。",
  规划: "这一项还没有做，是接下来要做的。",
  已完成: "这一项已经做完，代码在仓库里。",
};
const DEFAULT_LINK: Record<string, ProofLink> = { 实测: CONTRACT, 估算: CATEGORY, 规划: REPO, 已完成: REPO };

function build(tag: HTMLElement): Pop {
  const kind = (tag.textContent ?? "").trim();
  const sheet = tag.closest(".bd-screen");
  let text = COPY[kind] ?? "点开可以看到这个标签的依据。";

  // 估算：优先用这一版自己写的算法。
  if (kind === "估算" && sheet) {
    const note = Array.from(sheet.querySelectorAll<HTMLElement>(".bd-note, .bds-small, p")).find((el) =>
      /算法|÷/.test(el.textContent ?? ""),
    );
    const own = note?.textContent?.replace(/\s+/g, " ").replace(/^估算\s*/, "").trim();
    if (own) text = `这是推算出来的数字，不是直接测量。${own}`;
  }

  // 依据：离这个标签最近的外链，加上这一类标签的默认出处。
  const links: ProofLink[] = [];
  for (let el: HTMLElement | null = tag.parentElement; el && !el.classList.contains("bd"); el = el.parentElement) {
    const a = el.querySelector<HTMLAnchorElement>('a[href^="http"]');
    if (a) {
      const label = (a.textContent ?? "").replace(/\s+/g, " ").trim();
      links.push({ href: a.href, label: label.includes("↗") ? label : `${label} ↗` });
      break;
    }
  }
  const fallback = DEFAULT_LINK[kind];
  if (fallback && !links.some((l) => l.href === fallback.href)) links.push(fallback);

  const r = tag.getBoundingClientRect();
  const up = r.bottom + 240 > window.innerHeight;
  return {
    left: Math.max(12, Math.min(r.left, window.innerWidth - 440)),
    top: up ? r.top - 10 : r.bottom + 10,
    up,
    kind,
    text,
    links,
  };
}

/** 点任意一个“实测 / 估算 / 规划 / 已完成”标签，弹出它的依据和可以核对的链接。 */
export default function Proof() {
  const [pop, setPop] = useState<Pop | null>(null);

  useEffect(() => {
    const open = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      if (el?.closest(".bd-proof")) return true;
      const tag = el?.closest<HTMLElement>(".bd-tag.solid");
      if (!tag) return false;
      setPop(build(tag));
      return true;
    };
    const onClick = (e: MouseEvent) => {
      if (!open(e.target)) setPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPop(null);
      else if (e.key === "Enter" && open(e.target)) e.preventDefault();
    };
    const close = () => setPop(null);
    // 让标签能被键盘聚焦（新出现的标签也补上）。
    const mark = () =>
      document.querySelectorAll<HTMLElement>(".bd-tag.solid:not([tabindex])").forEach((t) => {
        t.tabIndex = 0;
        t.setAttribute("role", "button");
        t.title = "点开看依据";
      });
    mark();
    const timer = setInterval(mark, 1000);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      clearInterval(timer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close);
    };
  }, []);

  if (!pop) return null;
  return (
    <div
      className={`bd-proof${pop.up ? " up" : ""}`}
      style={{ left: pop.left, top: pop.top }}
      role="dialog"
      aria-label={`${pop.kind}的依据`}
    >
      <div className="bd-proof-head">
        <b>{pop.kind}</b>
        <button type="button" aria-label="关闭" onClick={() => setPop(null)}>
          ✕
        </button>
      </div>
      <p>{pop.text}</p>
      {pop.links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
          {l.label}
        </a>
      ))}
    </div>
  );
}
