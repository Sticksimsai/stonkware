import { env } from "./env";

let cached: { at: number; usd: number } | null = null;

/** SOL/USD for converting compute bills. Cached 10 min; falls back to SOL_USD. */
export async function solUsd(): Promise<number> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.usd;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { solana?: { usd?: number } };
    if (j.solana?.usd) cached = { at: Date.now(), usd: j.solana.usd };
  } catch { /* fall through */ }
  return cached?.usd ?? env.solUsdFallback;
}

export async function usdToLamports(usd: number) {
  return Math.ceil((usd / (await solUsd())) * 1e9);
}
