// Hyperliquid market lookups for agent trading: every perp and every USDC-quoted spot pair, with live context.
import { env } from "../env";
import { info } from "./client";
import { TOKEN_IDS } from "./spot";

export type Market = {
  kind: "perp" | "spot";
  /** What the agent types: "BTC" for perps, "HYPE/USDC" for spot */
  name: string;
  /** Order asset id: perp index, or 10000 + spot pair index */
  asset: number;
  /** Coin as it appears in positions/fills ("BTC", or the spot pair's "@107" / "PURR/USDC") */
  coin: string;
  szDecimals: number;
  maxLeverage: number; // 1 for spot
  onlyIsolated: boolean;
  midPx: number;
  markPx: number;
  /** perps: hourly funding rate */
  funding: number;
  dayVolumeUsd: number;
  openInterestUsd: number;
};

let cache: { at: number; network: string; markets: Market[] } | null = null;

export async function allMarkets(fresh = false): Promise<Market[]> {
  if (!fresh && cache && cache.network === env.hlNetwork && Date.now() - cache.at < 60_000) return cache.markets;
  const [[meta, ctxs], [smeta, sctxs]] = await Promise.all([info().metaAndAssetCtxs(), info().spotMetaAndAssetCtxs()]);
  const out: Market[] = [];
  meta.universe.forEach((u, i) => {
    const x = ctxs[i] as { midPx?: string | null; markPx: string; funding: string; dayNtlVlm: string; openInterest: string };
    if ((u as { isDelisted?: boolean }).isDelisted) return;
    const mid = Number(x.midPx ?? x.markPx);
    out.push({
      kind: "perp", name: u.name, asset: i, coin: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage,
      onlyIsolated: !!(u as { onlyIsolated?: boolean }).onlyIsolated, midPx: mid, markPx: Number(x.markPx), funding: Number(x.funding),
      dayVolumeUsd: Number(x.dayNtlVlm), openInterestUsd: Number(x.openInterest) * Number(x.markPx),
    });
  });
  const tokens = new Map(smeta.tokens.map((t) => [t.index, t]));
  const usdc = smeta.tokens.find((t) => t.name === "USDC" && t.tokenId.toLowerCase() === TOKEN_IDS[env.hlNetwork].USDC);
  const sctx = new Map((sctxs as { coin: string; midPx: string | null; markPx: string; dayNtlVlm: string }[]).map((x) => [x.coin, x]));
  for (const u of smeta.universe) {
    const base = tokens.get(u.tokens[0]);
    if (!base || !usdc || u.tokens[1] !== usdc.index) continue;
    const x = sctx.get(u.name);
    if (!x) continue;
    out.push({
      kind: "spot", name: `${base.name}/USDC`, asset: 10_000 + u.index, coin: u.name, szDecimals: base.szDecimals, maxLeverage: 1, onlyIsolated: false,
      midPx: Number(x.midPx ?? x.markPx), markPx: Number(x.markPx), funding: 0, dayVolumeUsd: Number(x.dayNtlVlm), openInterestUsd: 0,
    });
  }
  cache = { at: Date.now(), network: env.hlNetwork, markets: out };
  return out;
}

/**
 * Resolve what the agent typed: "BTC" / "btc-perp" → the BTC perp; "HYPE/USDC" / "spot:HYPE" → that spot pair.
 * Spot names aren't unique on Hyperliquid, so a spot name resolves to the pair with the most volume.
 */
export async function findMarket(input: string): Promise<Market | null> {
  const raw = input.trim();
  const ms = await allMarkets();
  const spotName = /^spot:/i.test(raw) ? `${raw.slice(5)}/USDC` : /\/USDC$/i.test(raw) ? raw : null;
  if (spotName) {
    const hits = ms.filter((m) => m.kind === "spot" && m.name.toUpperCase() === spotName.toUpperCase());
    return hits.sort((a, b) => b.dayVolumeUsd - a.dayVolumeUsd)[0] ?? null;
  }
  const perp = raw.replace(/[-_ ]?perp$/i, "").toUpperCase();
  return ms.find((m) => m.kind === "perp" && m.name.toUpperCase() === perp) ?? null;
}

export async function marketByCoin(coin: string): Promise<Market | null> {
  return (await allMarkets()).find((m) => m.coin === coin) ?? null;
}

/**
 * Hyperliquid prices: at most 5 significant figures (integers are always allowed) and at most
 * (6 − szDecimals) decimals for perps, (8 − szDecimals) for spot.
 */
export function formatPrice(px: number, szDecimals: number, kind: "perp" | "spot", mode: "down" | "up" | "nearest" = "nearest"): string {
  if (!(px > 0) || !Number.isFinite(px)) throw new Error("price must be positive");
  const maxDec = Math.max(0, (kind === "perp" ? 6 : 8) - szDecimals);
  const intDigits = Math.floor(Math.log10(px)) + 1;
  const dec = Math.min(maxDec, Math.max(0, 5 - intDigits));
  const f = 10 ** dec;
  const v = mode === "down" ? Math.floor(px * f) / f : mode === "up" ? Math.ceil(px * f) / f : Math.round(px * f) / f;
  if (v <= 0) throw new Error(`price ${px} is below this market's price precision`);
  const s = v.toFixed(dec);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
