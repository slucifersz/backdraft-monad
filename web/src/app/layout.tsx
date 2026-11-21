import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backdraft 回燃 — put paid-for gas to work on Monad",
  description:
    "On Monad you pay for your gas limit, not what you use. Backdraft spends the leftover on queued jobs and pays you back.",
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
