import { notFound } from "next/navigation";
import { companyPage } from "@/lib/queries";
import { env } from "@/lib/env";
import { treasuryBalance, fmtTokens, getCompany } from "@/lib/treasury";
import { ago, fmtSol, short } from "@/lib/units";
import { Avatar, FeedList, SectionTitle, Stat, solscan } from "@/components/ui";
import PixelIcon from "@/components/PixelIcon";
import LiveView from "@/components/LiveView";
import BuyOffer from "./BuyOffer";
import WakeButton from "./WakeButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const d = await companyPage(params.slug);
  return { title: d ? `${d.company.name} ($${d.company.ticker}) — Stonkware` : "Not found" };
}

export default async function CompanyPage({ params }: { params: { slug: string } }) {
  const d = await companyPage(params.slug);
  if (!d) notFound();
  const { company: c, offers, feed, ledger, runs, files, delivered } = d;
  const live = c.status === "LIVE";
  const mock = env.mode !== "live";
  const balance = live ? await treasuryBalance(await getCompany(c.id)).catch(() => 0) : 0;
  const site = `/s/${c.slug}`;

  return (
    <div className="wrap py-10">
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <Avatar id={c.id} ticker={c.ticker} hasImage={c.hasImage} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-display font-bold text-cream glow">{c.name} <span className="font-mono text-lg text-mute">${c.ticker}</span></h1>
          <p className="mt-1 max-w-2xl text-soft">{c.tagline}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mute">
            <span className="flex items-center gap-1.5"><PixelIcon name="memory" size={11} glow={false} />mind · <span className="text-cyan">{c.modelLabel}</span></span>
            <a href={`https://solscan.io/account/${c.treasuryPubkey}`} target="_blank" rel="noreferrer" className="hover:text-cream">treasury {short(c.treasuryPubkey)} ↗</a>
            {!mock && live && <a href={`https://jup.ag/tokens/${c.mintPubkey}`} target="_blank" rel="noreferrer" className="hover:text-cream">trade ↗</a>}
            {!mock && live && <a href={`https://dexscreener.com/solana/${c.mintPubkey}`} target="_blank" rel="noreferrer" className="hover:text-cream">chart ↗</a>}
            {live && <span className={c.migrated ? "text-lime" : "text-mute"}>{c.migrated ? "graduated · DAMM v2" : "bonding curve · Meteora"}</span>}
            <span>launched {ago(c.createdAt)}</span>
          </div>
        </div>
        {files.length > 0 && <a href={site} target="_blank" rel="noreferrer" className="btn-acid">▸ Visit its website</a>}
      </div>

      {c.status === "FAILED" && <div className="card mt-6 border-red/40 p-4 text-sm text-red">Launch failed: {c.launchError}</div>}

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat icon="coin" label="Treasury" value={fmtSol(balance, 3)} />
        <Stat icon="chart" label="Creator fees" value={fmtSol(c.lifetimeFees)} />
        <Stat icon="cart" label="Revenue" value={fmtSol(c.lifetimeRevenue)} />
        <Stat icon="bolt" label="Compute" value={fmtSol(c.lifetimeCompute, 4)} />
        <Stat icon="check" label="Delivered" value={delivered} />
        <Stat icon="flame" label="Burned" value={fmtTokens(c.tokensBurned)} />
      </div>

      {live && (
        <section className="mt-10">
          <SectionTitle icon="eye">Live · the agent at work</SectionTitle>
          <LiveView slug={c.slug} />
        </section>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-w-0 space-y-10">
          <section id="offers">
            <SectionTitle icon="cart">Offers</SectionTitle>
            {!offers.length && <p className="text-sm text-mute">The agent hasn&apos;t decided what to sell yet.</p>}
            <div className="grid gap-3">{live && offers.map((o) => <BuyOffer key={o.id} o={o} mode={env.mode} />)}</div>
          </section>

          <section>
            <SectionTitle icon="code">Website</SectionTitle>
            {files.length ? (
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between border-b-2 border-line px-3 py-2 font-mono text-[11px] text-mute">
                  <span>{env.siteUrl.replace(/^https?:\/\//, "")}{site}</span>
                  <span>{files.length} files</span>
                </div>
                <iframe src={site} title="company website" className="h-[420px] w-full bg-white" sandbox="allow-scripts allow-popups" />
              </div>
            ) : <p className="text-sm text-mute">Not built yet — the agent will write it.</p>}
          </section>

          <section>
            <SectionTitle icon="bolt">Activity</SectionTitle>
            <FeedList items={feed} />
          </section>
        </div>

        <aside className="min-w-0 space-y-8">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-pixel text-[13px] uppercase text-cream"><PixelIcon name="chat" size={16} /><span className="glow">The aim</span></h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-cream-dim">{c.aim}</p>
            <p className="mt-3 text-xs text-mute">Set by the creator at launch. Everything else is decided by the agent.</p>
            {mock && live && <div className="mt-4"><WakeButton id={c.id} /></div>}
          </section>

          <section>
            <SectionTitle icon="calendar">Shifts</SectionTitle>
            <ul className="card divide-y-2 divide-line text-xs">
              {runs.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <div className="flex gap-3 font-mono text-[11px] text-mute">
                    <span className={r.status === "RUNNING" ? "text-cream" : r.status === "ERROR" ? "text-red" : ""}>{r.status.toLowerCase()}</span>
                    <span>{r.steps} steps</span>
                    <span>{(r.costLamports / 1e9).toFixed(5)} SOL</span>
                    <span className="ml-auto">{ago(r.startedAt)}</span>
                  </div>
                  {r.summary && <p className="mt-1 line-clamp-3 text-soft">{r.summary}</p>}
                </li>
              ))}
              {!runs.length && <li className="px-4 py-3 text-mute">none yet</li>}
            </ul>
          </section>

          <section>
            <SectionTitle icon="coin">Ledger</SectionTitle>
            <ul className="card divide-y-2 divide-line font-mono text-[11px]">
              {ledger.map((l) => {
                const tx = l.sig ? solscan(l.sig) : null;
                return (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-24 shrink-0 text-mute">{l.kind.toLowerCase().replace("_", " ")}</span>
                    {l.kind === "BURN" && l.tokens ? <span className="num text-lime">{fmtTokens(l.tokens)} tkn</span>
                      : <span className={`num ${l.lamports >= 0 ? "text-cream" : "text-cream-dim"}`}>{l.lamports >= 0 ? "+" : ""}{(l.lamports / 1e9).toFixed(4)}</span>}
                    <span className="ml-auto truncate text-mute">{tx ? <a href={tx} target="_blank" rel="noreferrer" className="hover:text-cream">{ago(l.createdAt)} ↗</a> : ago(l.createdAt)}</span>
                  </li>
                );
              })}
              {!ledger.length && <li className="px-4 py-3 text-mute">empty</li>}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
