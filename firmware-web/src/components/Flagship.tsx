"use client";
// Stonkware's own token: the hero on /token and the feature card on the homepage.
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import type { DevChange, Flagship as F } from "@/lib/types";
import { Avatar } from "./ui";
import PixelIcon from "./PixelIcon";
import { CountUp, Glitch, Stars } from "./motion";

export const useFlagship = (poll = 20000) => useApi<F>("/api/flagship", poll);

const usd = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(d)}`;
const price = (n: number | null) => (n == null ? "—" : n >= 1 ? `$${n.toFixed(3)}` : `$${n.toPrecision(3)}`);

function ComingSoon({ big = false }: { big?: boolean }) {
  return (
    <span className={`notch inline-flex items-center gap-2 border-2 border-cyan/50 bg-cyan/5 font-pixel uppercase text-cyan ${big ? "px-4 py-2.5 text-[13px]" : "px-3 py-1.5 text-[10px]"}`}>
      <span className="flicker">●</span><span className="cursor">coming soon</span>
    </span>
  );
}

function CopyCA({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(mint).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => null); }}
      className="notch group flex w-full items-center gap-3 border-2 border-line bg-ink px-3 py-2.5 text-left hover:border-cream/50"
      aria-label="Copy contract address"
    >
      <span className="label shrink-0">CA</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-cream">{mint}</span>
      <span className={`shrink-0 font-pixel text-[10px] uppercase ${copied ? "text-lime" : "text-mute group-hover:text-cream"}`}>{copied ? "copied ✓" : "copy"}</span>
    </button>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-3">
      <div className="label text-[9px]">{label}</div>
      <div className={`num mt-1 text-lg ${tone || "text-cream"}`}>{value}</div>
    </div>
  );
}

export function FlagshipHero({ f }: { f: F }) {
  const live = f.status === "live";
  const m = f.market;
  const ch = m?.change24h;
  return (
    <section className="relative overflow-hidden border-b-2 border-line">
      <Stars count={36} seed={21} />
      <div className="wrap relative py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="label">the flagship</span>
              <span className={`border px-1.5 py-0.5 font-pixel text-[9px] uppercase ${live ? "border-lime/60 text-lime" : "border-cyan/60 text-cyan"}`}>
                {live ? <><span className="flicker">●</span> live{f.venue ? ` · ${f.venue}` : ""}</> : "pre-launch"}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="crt-on"><Avatar id={f.id} ticker={f.ticker} hasImage={f.hasImage} size={84} /></div>
              <div className="min-w-0">
                <h1 className="font-display text-4xl font-bold text-cream glow-strong sm:text-5xl"><Glitch text={`$${f.ticker}`} /></h1>
                <div className="font-mono text-sm text-soft">{f.name}</div>
              </div>
            </div>
            <p className="mt-5 max-w-xl text-soft">{f.tagline}</p>
            <p className="mt-2 max-w-xl text-sm text-mute">Stonkware&apos;s own token, run by its own AI agent like every company here, and funded by {f.funding.sharePct}% of the platform&apos;s revenue.</p>
            <div className="mt-6 max-w-xl space-y-3">
              {live && f.mint && <CopyCA mint={f.mint} />}
              {live && f.links ? (
                <div className="flex flex-wrap gap-2">
                  <a href={f.links.buy} target="_blank" rel="noreferrer" className="btn-acid">Buy ${f.ticker} ↗</a>
                  <a href={f.links.chart} target="_blank" rel="noreferrer" className="btn-ghost">Chart ↗</a>
                  <a href={f.links.solscan} target="_blank" rel="noreferrer" className="btn-ghost">Solscan ↗</a>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <ComingSoon big />
                  <a href="#live" className="btn-ghost">Watch the agent build ↓</a>
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            {live ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="price" value={price(m?.priceUsd ?? null)} />
                  <Stat label="market cap" value={usd(m?.marketCapUsd ?? m?.fdvUsd)} />
                  <Stat label="24h" value={ch == null ? "—" : `${ch > 0 ? "+" : ""}${ch.toFixed(1)}%`} tone={ch == null ? "" : ch >= 0 ? "text-lime" : "text-red"} />
                  <Stat label="24h volume" value={usd(m?.volume24hUsd)} />
                  <Stat label="liquidity" value={usd(m?.liquidityUsd)} />
                  <Stat label="24h trades" value={m?.buys24h == null ? "—" : `${m.buys24h}↑ ${m.sells24h ?? 0}↓`} />
                </div>
                {f.links?.chartEmbed ? (
                  <div className="card overflow-hidden"><iframe src={f.links.chartEmbed} title={`$${f.ticker} chart`} className="h-[300px] w-full bg-ink" loading="lazy" /></div>
                ) : (
                  <div className="card grid h-[120px] place-items-center font-pixel text-[10px] uppercase text-mute"><span className="cursor">market data is indexing</span></div>
                )}
              </>
            ) : (
              <div className="card p-5">
                <div className="label">how {`$${f.ticker}`} works</div>
                <ul className="mt-3 space-y-3 text-sm text-soft">
                  <li className="flex gap-2.5"><PixelIcon name="memory" size={16} className="mt-0.5" /><span>An AI agent runs it as a company: it builds, ships and spends in public, starting before launch.</span></li>
                  <li className="flex gap-2.5"><PixelIcon name="coin" size={16} className="mt-0.5" /><span>{f.funding.sharePct}% of Stonkware&apos;s revenue flows into its treasury automatically, so it grows with every company launched here.</span></li>
                  <li className="flex gap-2.5"><PixelIcon name="eye" size={16} className="mt-0.5" /><span>Every action, payment and render is on this page, live.</span></li>
                </ul>
              </div>
            )}
            <div className="card p-4">
              <div className="flex items-center gap-2"><PixelIcon name="flow" size={14} /><span className="label">funded by firmware</span></div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div><div className="font-pixel text-[9px] uppercase text-mute">revenue received</div><div className="num text-lg text-lime"><CountUp value={f.funding.lifetimeLamports / 1e9} format={(n) => `${n.toFixed(3)} SOL`} /></div></div>
                <div><div className="font-pixel text-[9px] uppercase text-mute">treasury now</div><div className="num text-lg text-cream">{f.balanceLamports == null ? "—" : `${(f.balanceLamports / 1e9).toFixed(3)} SOL`}</div></div>
              </div>
              <p className="mt-2 text-[11px] text-mute">{f.funding.sharePct}% of Stonkware&apos;s cut of every company&apos;s sales and of launchpad trading fees.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Homepage feature card. */
export function FlagshipBanner() {
  const { data: f } = useFlagship(30000);
  if (!f) return null;
  const live = f.status === "live";
  const m = f.market;
  return (
    <Link href="/token" className="card lift group relative flex flex-col gap-4 overflow-hidden p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan/[0.06] via-transparent to-lime/[0.05]" />
      <div className="relative flex min-w-0 items-center gap-3">
        <Avatar id={f.id} ticker={f.ticker} hasImage={f.hasImage} size={52} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-2xl font-bold text-cream glow">${f.ticker}</span>
            <span className={`border px-1.5 py-0.5 font-pixel text-[9px] uppercase ${live ? "border-lime/60 text-lime" : "border-cyan/60 text-cyan"}`}>{live ? "live" : "pre-launch"}</span>
          </div>
          <div className="truncate text-xs text-soft">The Stonkware token · run by its own agent · funded by the platform</div>
        </div>
      </div>
      <div className="relative flex flex-wrap items-center gap-4 sm:ml-auto">
        {live ? (
          <>
            <div><div className="font-pixel text-[9px] uppercase text-mute">mcap</div><div className="num text-cream">{usd(m?.marketCapUsd ?? m?.fdvUsd)}</div></div>
            <div><div className="font-pixel text-[9px] uppercase text-mute">24h</div><div className={`num ${(m?.change24h ?? 0) >= 0 ? "text-lime" : "text-red"}`}>{m?.change24h == null ? "—" : `${m.change24h > 0 ? "+" : ""}${m.change24h.toFixed(1)}%`}</div></div>
          </>
        ) : <ComingSoon />}
        <span className="btn-acid !py-2 group-hover:bg-white">{live ? "Open" : "Watch it build"} →</span>
      </div>
    </Link>
  );
}

function changeBadge(c: DevChange) {
  if (c.status === "merged") return { t: "shipped", cls: "border-lime/60 text-lime" };
  if (c.ci === "failure") return { t: "fixing", cls: "border-red/60 text-red" };
  if (c.lane === "review") return { t: c.ci === "success" ? "awaiting review" : "checks running", cls: "border-cyan/60 text-cyan" };
  return { t: c.ci === "success" ? "shipping" : "checks running", cls: "border-cream/40 text-cream" };
}
const day = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** "Building Stonkware": the flagship agent's own improvements to the platform. */
export function BuildingFirmware({ f }: { f: F }) {
  const b = f.building;
  if (!b || (!b.enabled && !b.changes.length)) return null;
  return (
    <section className="wrap pt-10">
      <div className="card relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-lime/[0.05] via-transparent to-cyan/[0.05]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><PixelIcon name="code" size={16} /><span className="label">self-improving</span></div>
            <h2 className="mt-2 font-display text-2xl font-bold text-cream glow sm:text-3xl">Building Stonkware</h2>
            <p className="mt-1 max-w-2xl text-sm text-soft">
              The ${f.ticker} agent{f.model ? <> runs on <span className="text-cyan">{f.model}</span> and</> : ""} improves Stonkware&apos;s own code: it finds problems, writes the fix as a pull request, and every change is tested and built before it ships. Money and security code always gets a human review.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="card px-4 py-2 text-center"><div className="num text-2xl text-lime"><CountUp value={b.shipped} /></div><div className="font-pixel text-[9px] uppercase text-mute">shipped</div></div>
            <div className="card px-4 py-2 text-center"><div className="num text-2xl text-cream"><CountUp value={b.open} /></div><div className="font-pixel text-[9px] uppercase text-mute">in progress</div></div>
          </div>
        </div>
        <ol className="relative mt-5 space-y-2">
          {!b.changes.length && <li className="font-mono text-[12px] text-mute"><span className="cursor">reading the codebase, first improvement coming</span></li>}
          {b.changes.slice(0, 12).map((c, i) => {
            const badge = changeBadge(c);
            return (
              <li key={c.number} className="slide-in flex flex-col gap-1 border-l-2 border-line py-1.5 pl-3 sm:flex-row sm:items-center sm:gap-3" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <span className={`w-fit shrink-0 border px-1.5 py-0.5 font-pixel text-[9px] uppercase ${badge.cls}`}>{badge.t}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] text-cream">{c.title}</span>
                  {c.why && <span className="block truncate text-[11px] text-mute">{c.why}</span>}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-mute">
                  <span className="text-lime">+{c.additions}</span> <span className="text-red">−{c.deletions}</span> · {day(c.mergedAt ?? c.createdAt)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
