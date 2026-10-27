"use client";
import { useEffect, useState } from "react";
import { solscanTx, postJSON } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useApi } from "@/lib/hooks";
import type { CompanyDetail } from "@/lib/types";
import { ago, fmtSol, short } from "@/lib/units";
import { Avatar, ErrorBox, FeedList, SectionTitle, Skeleton, Stat } from "@/components/ui";
import MediaGallery from "@/components/MediaGallery";
import { BotsSection, ConnectPanel, PackagesSection } from "@/components/Abilities";
import LiveView from "@/components/LiveView";
import PixelIcon from "@/components/PixelIcon";
import { Glitch, Reveal } from "@/components/motion";
import BuyOffer from "@/app/c/[slug]/BuyOffer";

const tokens = (raw: string) => Number(BigInt(raw || "0")) / 1e6;

function Wake({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  return (
    <div className="mt-4">
      <button className="btn-ghost w-full" disabled={busy} onClick={async () => {
        setBusy(true); setOut("");
        try {
          const j = await postJSON<{ claimed: number; started: boolean }>(`/api/dev/tick/${id}`, {});
          setOut(`+${(j.claimed / 1e9).toFixed(4)} SOL simulated fees · ${j.started ? "shift started" : "already working"}`);
          onDone();
        } catch (e) { setOut((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "…" : "Simulate fees + wake agent (mock)"}</button>
      {out && <p className="slide-in mt-2 font-mono text-[11px] text-mute">{out}</p>}
    </div>
  );
}

/** A company's full page. `embedded` hides the identity header (the /token page renders its own hero). */
export default function CompanyView({ slug, embedded = false }: { slug: string; embedded?: boolean }) {
  const cfg = useConfig();
  const { data: d, error, reload } = useApi<CompanyDetail>(`/api/companies/${slug}`, 10000);
  useEffect(() => { if (d && !embedded) document.title = `${d.company.name} ($${d.company.ticker}) — Stonkware`; }, [d, embedded]);
  if (error && !d) return <div className="wrap py-16"><ErrorBox message={error === "not found" ? "No company with that ticker." : error} onRetry={reload} /></div>;
  if (!d) return <div className="wrap space-y-4 py-10"><Skeleton h={90} /><Skeleton h={80} /><Skeleton h={420} /></div>;
  const c = d.company;
  const live = c.status === "LIVE";
  const mock = cfg?.mode === "mock";

  return (
    <div className={embedded ? "page-enter" : "wrap page-enter py-10"}>
      {!embedded && (
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="crt-on"><Avatar id={c.id} ticker={c.ticker} hasImage={!!c.imageUrl} size={76} /></div>
        <div className="min-w-0 flex-1">
          <h1 className="glow text-3xl font-display font-bold text-cream"><Glitch text={c.name} /> <span className="font-mono text-lg text-mute">${c.ticker}</span></h1>
          <p className="mt-1 max-w-2xl text-soft">{c.tagline}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mute">
            <span className="flex items-center gap-1.5"><PixelIcon name="memory" size={11} glow={false} />mind · <span className="text-cyan">{c.modelLabel}</span></span>
            {c.links.treasury && <a href={c.links.treasury} target="_blank" rel="noreferrer" className="hover:text-cream">treasury {short(c.treasuryPubkey)} ↗</a>}
            {c.links.trade && <a href={c.links.trade} target="_blank" rel="noreferrer" className="hover:text-cream">trade ↗</a>}
            {c.links.chart && <a href={c.links.chart} target="_blank" rel="noreferrer" className="hover:text-cream">chart ↗</a>}
            {live && <span className={c.migrated ? "text-lime" : ""}>{c.venue === "StonkFun" ? (c.migrated ? `graduated · Raydium · ${c.quoteSymbol ?? ""}` : `bonding curve · StonkFun${c.quoteSymbol ? ` · ${c.quoteSymbol} pair` : ""}`) : c.migrated ? "graduated · DAMM v2" : "bonding curve · Meteora"}</span>}
            <span>launched {ago(c.createdAt)}</span>
          </div>
        </div>
        {c.websiteUrl && <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="btn-acid">▸ Visit its website</a>}
      </div>
      )}

      {c.status === "FAILED" && <div className="mt-6"><ErrorBox message={`Launch failed: ${c.launchError}`} /></div>}

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat icon="coin" label="Treasury" value={c.balanceLamports} format={(n) => fmtSol(n, 3)} />
        <Stat icon="chart" label="Trading fees" value={c.lifetimeFees} format={(n) => fmtSol(n)} />
        <Stat icon="cart" label="Revenue" value={c.lifetimeRevenue} format={(n) => fmtSol(n)} />
        <Stat icon="bolt" label="Compute" value={c.lifetimeCompute} format={(n) => fmtSol(n, 4)} />
        <Stat icon="check" label="Delivered" value={d.ordersDelivered} />
        <Stat icon="flame" label="Burned" value={tokens(c.tokensBurned)} />
      </div>

      {live && (
        <Reveal className="mt-10">
          <SectionTitle icon="eye">Live · the agent at work</SectionTitle>
          <LiveView slug={c.slug} />
        </Reveal>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-w-0 space-y-10">
          <Reveal>
            <section id="offers">
              <SectionTitle icon="cart">Offers</SectionTitle>
              {!d.offers.length && <p className="text-sm text-mute">The agent hasn&apos;t decided what to sell yet.</p>}
              <div className="grid gap-3">{live && d.offers.map((o) => <BuyOffer key={o.id} o={o} mock={mock} />)}</div>
            </section>
          </Reveal>
          <Reveal>
            <section>
              <SectionTitle icon="code">Website</SectionTitle>
              {c.websiteUrl ? (
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between border-b-2 border-line bg-raise px-3 py-2 font-mono text-[11px] text-mute">
                    <span className="flex items-center gap-2"><span className="leds"><i className="bg-cream" /><i className="bg-lime" /><i className="bg-cyan" /></span>{c.websiteUrl.replace(/^https?:\/\//, "")}</span>
                    <span>{d.websiteFiles.length} files</span>
                  </div>
                  <iframe src={c.websiteUrl} title="company website" className="h-[420px] w-full bg-white" sandbox="allow-scripts allow-popups" />
                </div>
              ) : <p className="text-sm text-mute">Not built yet — the agent will write it.</p>}
            </section>
          </Reveal>
          {!!d.bots?.some((b) => b.connected || b.live) && (
            <Reveal>
              <section id="bots">
                <SectionTitle icon="chat">Bots</SectionTitle>
                <BotsSection bots={d.bots!} />
              </section>
            </Reveal>
          )}
          {!!d.packages?.length && (
            <Reveal>
              <section id="apps">
                <SectionTitle icon="browser">Apps & downloads</SectionTitle>
                <PackagesSection packages={d.packages!} />
              </section>
            </Reveal>
          )}
          {(d.media?.length || cfg?.media?.enabled) && (
            <Reveal>
              <section id="studio">
                <SectionTitle icon="film">Studio</SectionTitle>
                <MediaGallery items={d.media ?? []} />
              </section>
            </Reveal>
          )}
          <Reveal>
            <section>
              <SectionTitle icon="bolt">Activity</SectionTitle>
              <FeedList items={d.feed} limit={6} />
            </section>
          </Reveal>
        </div>

        <aside className="min-w-0 space-y-8">
          {live && (
            <ConnectPanel slug={c.slug} ticker={c.ticker} companyId={c.id} creatorWallet={c.creatorWallet} requests={d.connectRequests ?? []} bots={d.bots ?? []} mock={mock} />
          )}
          <Reveal>
            <section className="card p-5">
              <h2 className="flex items-center gap-2 font-pixel text-[13px] uppercase text-cream"><PixelIcon name="chat" size={16} /><span className="glow">The aim</span></h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-cream-dim">{c.aim}</p>
              <p className="mt-3 text-xs text-mute">Set by the creator at launch. Everything else is decided by the agent.</p>
              {mock && live && <Wake id={c.id} onDone={reload} />}
            </section>
          </Reveal>
          <Reveal>
            <section>
              <SectionTitle icon="calendar">Shifts</SectionTitle>
              <ul className="card divide-y-2 divide-line text-xs">
                {d.shifts.map((r) => (
                  <li key={r.id} className="px-4 py-2.5">
                    <div className="flex gap-3 font-mono text-[11px] text-mute">
                      <span className={r.status === "RUNNING" ? "text-cyan" : r.status === "ERROR" ? "text-red" : ""}>{r.status.toLowerCase()}</span>
                      <span>{r.steps} steps</span>
                      <span>{(r.costLamports / 1e9).toFixed(5)} SOL</span>
                      <span className="ml-auto">{ago(r.startedAt)}</span>
                    </div>
                    {r.summary && <p className="mt-1 line-clamp-3 text-soft">{r.summary}</p>}
                  </li>
                ))}
                {!d.shifts.length && <li className="px-4 py-3 text-mute">none yet</li>}
              </ul>
            </section>
          </Reveal>
          <Reveal>
            <section>
              <SectionTitle icon="coin">Ledger</SectionTitle>
              <ul className="card divide-y-2 divide-line font-mono text-[11px]">
                {d.ledger.map((l) => {
                  const tx = solscanTx(l.sig);
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-cream/[0.03]">
                      <span className="w-24 shrink-0 text-mute">{l.kind.toLowerCase().replace("_", " ")}</span>
                      {l.kind === "BURN" && l.tokens ? <span className="num text-lime">{tokens(l.tokens).toLocaleString(undefined, { maximumFractionDigits: 0 })} tkn</span>
                        : <span className={`num ${l.lamports >= 0 ? "text-lime" : "text-cream-dim"}`}>{l.lamports >= 0 ? "+" : ""}{(l.lamports / 1e9).toFixed(4)}</span>}
                      <span className="ml-auto truncate text-mute">{tx ? <a href={tx} target="_blank" rel="noreferrer" className="hover:text-cream">{ago(l.createdAt)} ↗</a> : ago(l.createdAt)}</span>
                    </li>
                  );
                })}
                {!d.ledger.length && <li className="px-4 py-3 text-mute">empty</li>}
              </ul>
            </section>
          </Reveal>
        </aside>
      </div>
    </div>
  );
}
