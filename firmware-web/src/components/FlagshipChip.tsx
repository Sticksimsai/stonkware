"use client";
// Nav chip for Stonkware's own token: "$FIRM  $20.1k ▲". Market cap refreshes every minute;
// the arrow shows the direction of the last move (falls back to the 24h change on first load).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";

type Snap = { status: "prelaunch" | "live"; marketCapUsd: number | null; change24h: number | null };

export function usd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

export default function FlagshipChip({ ticker, live, active, compact }: { ticker: string; live: boolean; active: boolean; compact?: boolean }) {
  const { data } = useApi<Snap>(live ? "/api/flagship/market" : null, 60_000);
  const mc = data?.marketCapUsd ?? null;
  const prev = useRef<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    if (mc == null) return;
    if (prev.current == null) {
      const c = data?.change24h;
      setDir(c == null || c === 0 ? null : c > 0 ? "up" : "down");
    } else if (mc !== prev.current) {
      setDir(mc > prev.current ? "up" : "down");
      setFlash((f) => f + 1);
    }
    prev.current = mc;
  }, [mc, data?.change24h]);

  const tone = dir === "up" ? "text-lime" : dir === "down" ? "text-red" : "text-soft";
  return (
    <Link
      href="/token"
      title={mc != null ? `$${ticker} market cap (updates every minute)` : "Stonkware's own token"}
      className={`notch flex shrink-0 items-center gap-2 border-2 px-2.5 py-1 font-pixel uppercase tracking-wider transition-colors ${compact ? "text-[9px]" : "text-[10px]"} ${active ? "border-lime bg-lime/10" : "border-lime/40 hover:border-lime hover:bg-lime/10"}`}
    >
      <span className="text-lime">${ticker}</span>
      {mc != null && (
        <span key={flash} className={`num flex items-center gap-1 normal-case ${tone} ${flash ? "mc-flash" : ""}`}>
          {usd(mc)}
          {dir && <span aria-label={dir === "up" ? "up" : "down"} className="text-[8px] leading-none">{dir === "up" ? "▲" : "▼"}</span>}
        </span>
      )}
    </Link>
  );
}
