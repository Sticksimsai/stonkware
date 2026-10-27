// Quote tokens a new coin can pair with on StonkFun (proxied + cached; StonkFun's API has no CORS).
import { env, isLive } from "@/lib/env";
import { handle, ok } from "@/lib/http";
import { launchPairs, type Pair } from "@/lib/stonkfun";
import { WSOL_MINT } from "@/lib/jupiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOL: Pair = { mint: WSOL_MINT, symbol: "SOL", name: "Solana", image: null, decimals: 9, tokenProgram: null, category: "crypto", launchable: true, launchLabReady: true };
// mock mode / API down: a small offline list so the launch form still works locally
const OFFLINE: Pair[] = [
  SOL,
  { mint: "mock-nvdax", symbol: "NVDAx", name: "NVIDIA (mock)", image: null, decimals: 8, tokenProgram: null, category: "stock", launchable: true, launchLabReady: true },
  { mint: "mock-tslax", symbol: "TSLAx", name: "Tesla (mock)", image: null, decimals: 8, tokenProgram: null, category: "stock", launchable: true, launchLabReady: true },
  { mint: "mock-spyx", symbol: "SPYx", name: "S&P 500 (mock)", image: null, decimals: 8, tokenProgram: null, category: "stock", launchable: true, launchLabReady: true },
];

export const GET = handle(async () => {
  if (env.launchVenue !== "stonkfun") return ok({ venue: env.launchVenue, pairs: [SOL] });
  try {
    const pairs = await launchPairs();
    const list = pairs.some((p) => p.mint === WSOL_MINT) ? pairs : [SOL, ...pairs];
    return ok({ venue: "stonkfun", pairs: list, source: "stonkfun" });
  } catch (e) {
    if (isLive()) throw new Error(`StonkFun pairs unavailable: ${(e as Error).message.slice(0, 120)}`);
    return ok({ venue: "stonkfun", pairs: OFFLINE, source: "offline" });
  }
});
