import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backdraft 回燃 — Monad 的流量计",
  description:
    "Monad receipts show the gas you reserved, not the gas you used. Backdraft measures real usage on-chain and records it with gas that was already paid for.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
