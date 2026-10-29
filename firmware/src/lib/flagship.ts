// The flagship: Hypeware's own token, launched outside the launchpad (e.g. directly on Meteora),
// run by an agent like every company, and funded by a share of Hypeware's platform revenue.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { emit } from "./feed";

const C = schema.companies;
const L = schema.ledger;
const PENDING = "pending-";

/** Share of Hypeware's platform revenue routed to the flagship treasury (percent). */
export const flagshipSharePct = () => Math.min(100, Math.max(0, Number(process.env.FLAGSHIP_SHARE_PCT ?? 50)));
export const isPrelaunch = (c: Pick<Company, "mintPubkey">) => c.mintPubkey.startsWith(PENDING);
export const pendingMint = (slug: string) => `${PENDING}${slug}`;

let cache: { at: number; c: Company | null } | null = null;
export async function getFlagship(fresh = false): Promise<Company | null> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.c;
  const c = (await db.query.companies.findFirst({ where: eq(C.flagship, true) })) ?? null;
  cache = { at: Date.now(), c };
  return c;
}
export const clearFlagshipCache = () => { cache = null; };

let lastNotice = 0;
/** Book platform revenue arriving in the flagship treasury (the SOL itself was already transferred). */
export async function creditFlagship(lamports: number, memo: string, sig: string | null) {
  const f = await getFlagship();
  if (!f || lamports <= 0) return;
  await db.insert(L).values({ companyId: f.id, kind: "PLATFORM_SHARE", lamports, memo, sig });
  // money arrived: let a sleeping agent get back to work
  await db.update(C).set({ sleepingUntil: null }).where(eq(C.id, f.id));
  if (Date.now() - lastNotice > 30 * 60_000) {
    lastNotice = Date.now();
    await emit(f.id, "TREASURY", `+${(lamports / 1e9).toFixed(4)} SOL from Hypeware's revenue`, memo, sig);
  }
}

export async function platformShareTotal(companyId: string) {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${L.lamports}), 0)` }).from(L).where(and(eq(L.companyId, companyId), eq(L.kind, "PLATFORM_SHARE")));
  return Number(r.s);
}

// ───────── market data (any venue) via DexScreener ─────────
export type Market = {
  priceUsd: number | null; priceSol: number | null; marketCapUsd: number | null; fdvUsd: number | null; liquidityUsd: number | null;
  volume24hUsd: number | null; volume1hUsd: number | null; change24h: number | null; pairAddress: string; dex: string; url: string; buys24h: number | null; sells24h: number | null;
};
type DsPair = {
  chainId: string; dexId: string; url: string; pairAddress: string; priceUsd?: string; priceNative?: string; fdv?: number; marketCap?: number;
  liquidity?: { usd?: number }; volume?: { h24?: number; h1?: number }; priceChange?: { h24?: number }; txns?: { h24?: { buys: number; sells: number } }; quoteToken?: { symbol: string };
};
const marketCache = new Map<string, { at: number; m: Market | null }>();
export async function marketFor(mint: string): Promise<Market | null> {
  const hit = marketCache.get(mint);
  if (hit && Date.now() - hit.at < 30_000) return hit.m;
  let m: Market | null = null;
  try {
    const r = await fetch(`${process.env.DEXSCREENER_API_URL || "https://api.dexscreener.com"}/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { pairs?: DsPair[] | null };
    const pairs = (j.pairs ?? []).filter((p) => p.chainId === "solana");
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (best) {
      const vol = pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0);
      const vol1h = pairs.reduce((s, p) => s + (p.volume?.h1 ?? 0), 0);
      m = {
        priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
        priceSol: best.quoteToken?.symbol === "SOL" && best.priceNative ? Number(best.priceNative) : null,
        marketCapUsd: best.marketCap ?? null, fdvUsd: best.fdv ?? null, liquidityUsd: best.liquidity?.usd ?? null,
        volume24hUsd: vol || null, volume1hUsd: vol1h || null, change24h: best.priceChange?.h24 ?? null, pairAddress: best.pairAddress, dex: best.dexId, url: best.url,
        buys24h: best.txns?.h24?.buys ?? null, sells24h: best.txns?.h24?.sells ?? null,
      };
    }
  } catch { /* keep null; the page shows "market data loading" */ }
  marketCache.set(mint, { at: Date.now(), m });
  return m;
}

// ───────── the flagship token's own fee income (transfer tax), estimated from trading volume ─────────
/** The token's fee rate in bps (e.g. 145 = 1.45% tax on every trade). */
export const flagshipTaxBps = () => Number(process.env.FLAGSHIP_TAX_BPS || 145);

/**
 * Scheduler: once an hour, add the last hour's volume × tax to a running "fees generated" total for the live
 * flagship (seeded with the last 24h on the first run). Estimates in USD from DexScreener volume.
 */
export async function trackFlagshipFees() {
  const f = await getFlagship(true);
  if (!f || isPrelaunch(f)) return;
  const last = f.taxTrackedAt?.getTime() ?? 0;
  if (Date.now() - last < 60 * 60_000) return;
  const m = await marketFor(f.mintPubkey);
  if (!m) return;
  const vol = last ? m.volume1hUsd ?? 0 : m.volume24hUsd ?? 0;
  const add = (vol * flagshipTaxBps()) / 10_000;
  await db.update(schema.companies).set({ taxFeesUsd: (f.taxFeesUsd ?? 0) + add, taxTrackedAt: new Date() }).where(eq(schema.companies.id, f.id));
}
