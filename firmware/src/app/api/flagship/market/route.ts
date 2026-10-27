// Lightweight market snapshot for the nav chip (polled every minute by every visitor).
// Prices come from DexScreener via marketFor (cached 30s server-side), so this never hits the RPC.
import { handle, ok, fail } from "@/lib/http";
import { getFlagship, isPrelaunch, marketFor } from "@/lib/flagship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const f = await getFlagship();
  if (!f) return fail(404, "no flagship yet");
  if (isPrelaunch(f)) return ok({ status: "prelaunch", marketCapUsd: null, change24h: null });
  const m = await marketFor(f.mintPubkey);
  return ok({ status: "live", marketCapUsd: m?.marketCapUsd ?? m?.fdvUsd ?? null, change24h: m?.change24h ?? null });
});
