"use client";
// Company list as stacked cards — no fixed table width, so it never needs a horizontal scroller.
import Link from "next/link";
import type { CompanyRow } from "@/lib/types";
import { ago, fmtSol } from "@/lib/units";
import { Avatar } from "./ui";

function Status({ c }: { c: CompanyRow }) {
  const asleep = !c.working && c.sleepingUntil && new Date(c.sleepingUntil).getTime() > Date.now();
  if (c.working) return <span className="glow whitespace-nowrap text-cyan"><span className="flicker">●</span> working</span>;
  if (asleep) return <span className="whitespace-nowrap text-mute">● asleep</span>;
  return <span className="whitespace-nowrap text-soft">● idle{c.lastRunAt ? ` · ${ago(c.lastRunAt)}` : ""}</span>;
}

function Metric({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-pixel text-[9px] uppercase tracking-wider text-mute">{label}</div>
      <div className={`num truncate text-[13px] ${dim ? "text-soft" : "text-cream"}`}>{value}</div>
    </div>
  );
}

export default function CompanyTable({ rows }: { rows: CompanyRow[] }) {
  if (!rows.length)
    return <div className="card p-8 text-center text-sm text-mute">No companies yet. <Link href="/launch" className="link text-cream">Launch the first one →</Link></div>;
  return (
    <ol className="card divide-y-2 divide-line">
      {rows.map((c, i) => (
        <li key={c.id} className="slide-in" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
          <Link href={`/c/${c.slug}`} className="group grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 px-4 py-3.5 transition-colors hover:bg-cream/[0.03] sm:grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* identity */}
            <div className="flex items-center gap-3">
              <span className="num w-6 text-[11px] text-mute group-hover:text-cream">{String(i + 1).padStart(2, "0")}</span>
              <Avatar id={c.id} ticker={c.ticker} hasImage={c.hasImage} size={36} />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[14px] text-cream group-hover:glow">{c.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-mute">${c.ticker}</span>
              </div>
              <div className="truncate text-[12px] text-mute">{c.tagline}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px]">
                <span className="truncate text-cyan">{c.modelLabel}</span>
                <Status c={c} />
              </div>
            </div>
            {/* numbers: full row on mobile, right column on wider screens */}
            <div className="col-span-2 grid grid-cols-3 gap-3 border-t border-line/60 pt-2.5 sm:col-span-1 sm:border-0 sm:pt-0">
              <Metric label="fees" value={fmtSol(c.lifetimeFees)} />
              <Metric label="revenue" value={fmtSol(c.lifetimeRevenue)} />
              <Metric label="compute" value={fmtSol(c.lifetimeCompute, 4)} dim />
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
