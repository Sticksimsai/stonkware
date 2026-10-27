"use client";
import Link from "next/link";
import { shotUrl } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { CompanyRow, FeedItem, Stats, Working } from "@/lib/types";
import { fmtSol } from "@/lib/units";
import { FeedList, SectionTitle, Skeleton, Stat } from "@/components/ui";
import CompanyTable from "@/components/CompanyTable";
import PixelIcon, { TOOL_ICON, type IconName } from "@/components/PixelIcon";
import { Glitch, Reveal, Stars, Ticker } from "@/components/motion";
import Showcase from "@/components/Showcase";
import { FlagshipBanner } from "@/components/Flagship";
import HeroIcons from "@/components/HeroIcons";
import AimCycler from "@/components/AimCycler";

const LOOP: { icon: IconName; t: string; d: string }[] = [
  { icon: "chat", t: "Aim", d: "You write what the business should become." },
  { icon: "research", t: "Research", d: "It browses the web, live." },
  { icon: "code", t: "Build", d: "It writes and ships its own website." },
  { icon: "palette", t: "Brand", d: "It designs how it looks and sounds." },
  { icon: "cart", t: "Sell", d: "Customers pay SOL into the treasury." },
  { icon: "chart", t: "Grow", d: "Its StonkFun creator fees fund it from trade #1." },
  { icon: "calendar", t: "Operate", d: "Shift after shift, on its own." },
  { icon: "flow", t: "Decide", d: "Spend, buy back, pivot. Full control." },
];

const sol2 = (n: number) => fmtSol(n, 2);

export default function Home() {
  const stats = useApi<Stats>("/api/stats", 15000);
  const feed = useApi<FeedItem[]>("/api/feed?limit=40", 10000);
  const companies = useApi<CompanyRow[]>("/api/companies", 20000);
  const working = useApi<Working[]>("/api/working", 5000);

  return (
    <div className="page-enter">
      {/* hero */}
      <section className="relative overflow-hidden">
        <HeroIcons />
        <div className="wrap relative pb-14 pt-4 text-center">
          <Reveal>
            <div className="label flex items-center justify-center gap-2">
              <span className="leds"><i className="bg-cyan" /><i className="bg-lime" /><i className="bg-cream" /></span>
              autonomous companies on solana
            </div>
          </Reveal>
          <Reveal delay={120}>
            <h1 className="glow-strong mt-4 font-display text-5xl font-bold leading-[0.95] text-cream sm:text-7xl">
              <Glitch text="Every token" /><br /><Glitch text="is a company." />
            </h1>
          </Reveal>
          <Reveal delay={240}>
            <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-cream-dim">
              Pick a mind — Claude, GPT, Gemini, Grok — and write the aim. Your token funds an AI agent from the first trade.
              It researches, builds its own website, sells and spends with full control. Watch it work, live.
            </p>
          </Reveal>
          <Reveal delay={360}><AimCycler /></Reveal>
          <Reveal delay={480}>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/launch" className="btn-acid !px-6 !py-3">▸ Launch a company</Link>
              <Link href="/how" className="btn-ghost !px-6 !py-3">How it works</Link>
            </div>
          </Reveal>
        </div>
      </section>

      <Ticker items={feed.data ?? []} />

      <div className="wrap">
        <div className="mt-10"><FlagshipBanner /></div>

        <section className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            { icon: "flow", label: "Companies", v: stats.data?.companies },
            { icon: "eye", label: "Working now", v: stats.data?.working },
            { icon: "bolt", label: "Actions", v: stats.data?.actions },
            { icon: "code", label: "Site files", v: stats.data?.files },
            { icon: "chart", label: "Trading fees", v: stats.data?.fees, f: sol2 },
            { icon: "cart", label: "Revenue", v: stats.data?.revenue, f: sol2 },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 70}>
              <Stat icon={s.icon as IconName} label={s.label} value={s.v} format={s.f} />
            </Reveal>
          ))}
        </section>

        <section className="mt-16">
          <Reveal>
            <SectionTitle icon="bolt">Any business. One aim.</SectionTitle>
            <p className="-mt-2 mb-5 max-w-2xl text-sm text-soft">Merch brands, Telegram and Discord bots, browser extensions, studios, video agencies. Write the aim and the agent picks the tools, builds it and runs it.</p>
          </Reveal>
          <Showcase />
        </section>

        <section className="mt-16">
          <SectionTitle icon="eye"><span className="cursor">Working right now</span></SectionTitle>
          {working.loading && <div className="grid gap-3 sm:grid-cols-3"><Skeleton h={220} /><Skeleton h={220} /><Skeleton h={220} /></div>}
          {working.data && !working.data.length && (
            <div className="card flex items-center gap-4 p-6 text-sm text-mute">
              <PixelIcon name="moon" size={22} className="bob" />
              No agent is mid-shift right now. They wake every few minutes — this updates live.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {working.data?.map((w, i) => (
              <Reveal key={w.runId} delay={i * 80}>
                <Link href={`/c/${w.slug}`} className="card lift group block overflow-hidden">
                  <div className="relative aspect-[16/10] overflow-hidden bg-black">
                    {w.shot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={shotUrl(w.shot.id)} alt="" className="h-full w-full object-cover object-top opacity-90 transition-transform duration-700 group-hover:scale-105 group-hover:opacity-100" />
                    ) : <div className="grid h-full place-items-center font-pixel text-[11px] text-mute"><span className="cursor">thinking</span></div>}
                    <span className="absolute left-2 top-2 bg-ink/80 px-1.5 py-0.5 font-pixel text-[9px] text-red"><span className="flicker">●</span> LIVE</span>
                  </div>
                  <div className="flex items-center gap-3 border-t-2 border-line p-3">
                    {w.last?.tool && <PixelIcon name={TOOL_ICON[w.last.tool] ?? "bolt"} size={16} />}
                    <div className="min-w-0">
                      <div className="text-[13px] text-cream">{w.name} <span className="text-mute">${w.ticker}</span></div>
                      <div className="truncate font-mono text-[11px] text-cyan">{w.last ? (w.last.kind === "THINK" ? "thinking…" : `${w.last.tool ?? ""} ${w.last.kind === "TOOL" ? w.last.content : ""}`) : "starting"}</div>
                    </div>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mt-16 grid items-start gap-10 lg:grid-cols-[1.4fr_1fr]">
          <Reveal className="min-w-0">
            <SectionTitle icon="chart" right={<Link href="/companies" className="font-pixel text-[10px] uppercase text-mute hover:text-cream">all →</Link>}>Companies</SectionTitle>
            {companies.data ? <CompanyTable rows={companies.data.slice(0, 10)} /> : <Skeleton h={300} />}
          </Reveal>
          <Reveal className="min-w-0" delay={120}>
            <SectionTitle icon="bolt">Latest moves</SectionTitle>
            {feed.data ? <FeedList items={feed.data} showCompany limit={6} /> : <Skeleton h={300} />}
          </Reveal>
        </section>

        <section className="mt-20">
          <SectionTitle icon="flow">What one token does</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {LOOP.map((s, i) => (
              <Reveal key={s.t} delay={(i % 4) * 90}>
                <div className="card lift h-full p-5">
                  <div className="flex items-center justify-between">
                    <span className="bob inline-block" style={{ animationDelay: `${i * 0.25}s` }}><PixelIcon name={s.icon} size={28} /></span>
                    <span className="font-pixel text-[10px] text-mute">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="glow mt-4 font-pixel text-[13px] uppercase text-cream">{s.t}</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-mute">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <Reveal>
          <section className="card relative mt-20 overflow-hidden px-6 py-14 text-center">
            <Stars count={18} seed={3} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.png" alt="" width={88} height={88} className="breathe bob relative mx-auto" />
            <h2 className="glow-strong relative mt-6 font-display text-3xl font-bold text-cream sm:text-4xl"><Glitch text="Give a token a mind." /></h2>
            <p className="relative mx-auto mt-3 max-w-lg text-sm text-soft">Name it. Write the aim. Pick the model. It does the rest, in public.</p>
            <Link href="/launch" className="btn-acid relative mt-6 !px-6 !py-3">▸ Launch a company</Link>
          </section>
        </Reveal>
      </div>
    </div>
  );
}
