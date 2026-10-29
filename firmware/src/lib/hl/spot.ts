// Hyperliquid spot market lookups and price/size rounding for the treasury's conversions (uSOL ⇄ USDC).
import { env } from "../env";
import { info } from "./client";

/**
 * Token ids we expect per network (docs.hyperunit.xyz + Hyperliquid spotMeta). A token whose id doesn't match is
 * refused, so a look-alike token with the same name can never be traded or sent by the treasury.
 */
export const TOKEN_IDS = {
  mainnet: { USDC: "0x6d1e7cde53ba9467b783cb7c530ce054", USOL: "0x49b67c39f5566535de22b29b0e51e685", HYPE: "0x0d01dc56dcaaca66ad901c959b4011ec" },
  testnet: { USDC: "0xeb62eee3685fc4c43992febcd9e75443", USOL: "0x57ead23624b114018cc0e49d01cc7b6b", HYPE: "0x7317beb7cceed72ef0b346074cc8e7ab" },
} as const;
export type TreasuryToken = keyof (typeof TOKEN_IDS)["mainnet"];

/** "NAME:0x<token id>", the form spotSend expects. */
export const tokenWire = (name: TreasuryToken) => `${name}:${TOKEN_IDS[env.hlNetwork][name]}`;

export type SpotMarket = { base: TreasuryToken; asset: number; name: string; szDecimals: number };

let cache: { at: number; network: string; markets: Map<string, SpotMarket> } | null = null;

/** The <base>/USDC spot market, e.g. USOL/USDC. Asset id for orders is 10000 + the pair index. */
export async function spotMarket(base: Exclude<TreasuryToken, "USDC">): Promise<SpotMarket> {
  if (cache && cache.network === env.hlNetwork && Date.now() - cache.at < 10 * 60_000) {
    const m = cache.markets.get(base);
    if (m) return m;
  }
  const meta = await info().spotMeta();
  const ids = TOKEN_IDS[env.hlNetwork];
  const byIndex = new Map(meta.tokens.map((t) => [t.index, t]));
  const usdc = meta.tokens.find((t) => t.name === "USDC");
  const baseTok = meta.tokens.find((t) => t.name === base);
  if (!usdc || usdc.tokenId.toLowerCase() !== ids.USDC) throw new Error("USDC token id mismatch on Hyperliquid");
  if (!baseTok || baseTok.tokenId.toLowerCase() !== ids[base]) throw new Error(`${base} token id mismatch on Hyperliquid`);
  const pair = meta.universe.find((u) => u.tokens[0] === baseTok.index && u.tokens[1] === usdc.index);
  if (!pair || !byIndex.get(pair.tokens[0])) throw new Error(`no ${base}/USDC spot market`);
  const m: SpotMarket = { base, asset: 10_000 + pair.index, name: pair.name, szDecimals: baseTok.szDecimals };
  cache = { at: Date.now(), network: env.hlNetwork, markets: new Map([...(cache?.network === env.hlNetwork ? cache.markets : []), [base, m]]) };
  return m;
}

let midsCache: { at: number; network: string; v: Record<string, number> } | null = null;

/** Mid prices by coin ("SOL" = SOL perp, "@156" = a spot pair). Cached 30s: it's one large response for all markets. */
export async function mids(): Promise<Record<string, number>> {
  if (midsCache && midsCache.network === env.hlNetwork && Date.now() - midsCache.at < 30_000) return midsCache.v;
  const r = await info().allMids();
  const v = Object.fromEntries(Object.entries(r).map(([k, p]) => [k, Number(p)]));
  midsCache = { at: Date.now(), network: env.hlNetwork, v };
  return v;
}

/** SOL/USD reference: Hyperliquid's SOL perp mid (deep market). Used to cap conversion prices. */
export async function solUsdRef(): Promise<number> {
  const p = (await mids())["SOL"];
  if (!(p > 0)) throw new Error("no SOL price on Hyperliquid");
  return p;
}

/** Drop trailing zeros after a decimal point only ("10" stays "10", "1.50" → "1.5", "2.000" → "2"). */
const trimZeros = (x: string) => (x.includes(".") ? x.replace(/0+$/, "").replace(/\.$/, "") : x);

/** Round a size down to the market's size decimals. */
export function roundSize(size: number, szDecimals: number): string {
  const f = 10 ** szDecimals;
  const v = Math.floor(size * f + 1e-9) / f;
  return trimZeros(v.toFixed(szDecimals));
}

/** Hyperliquid spot prices: at most 5 significant figures and at most (8 − szDecimals) decimals. */
export function formatSpotPrice(px: number, szDecimals: number, mode: "down" | "up"): string {
  if (!(px > 0)) throw new Error("price must be positive");
  const maxDec = Math.max(0, 8 - szDecimals);
  const intDigits = Math.floor(Math.log10(px)) + 1; // ≤ 0 for prices below 1 (leading zeros after the point)
  const dec = Math.min(maxDec, Math.max(0, 5 - intDigits));
  const f = 10 ** dec;
  const v = mode === "down" ? Math.floor(px * f) / f : Math.ceil(px * f) / f;
  // integers above 5 significant figures are allowed by Hyperliquid
  return trimZeros(v.toFixed(dec));
}

/** Worst acceptable price for a conversion: the reference moved against us by `slippageBps`. */
export function limitPrice(side: "sell" | "buy", refPx: number, slippageBps: number) {
  return side === "sell" ? refPx * (1 - slippageBps / 10_000) : refPx * (1 + slippageBps / 10_000);
}
