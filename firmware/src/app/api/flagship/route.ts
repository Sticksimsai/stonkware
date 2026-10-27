// Everything the /token page needs beyond the normal company payload: token + market data + funding.
import { handle, ok, fail } from "@/lib/http";
import { env } from "@/lib/env";
import { flagshipSharePct, getFlagship, isPrelaunch, marketFor, platformShareTotal } from "@/lib/flagship";
import { treasuryBalance } from "@/lib/treasury";
import { listChanges, publicChange, selfdevEnabled } from "@/lib/selfdev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const f = await getFlagship();
  if (!f) return fail(404, "no flagship yet");
  const pre = isPrelaunch(f);
  const [market, shared, balance, changes] = await Promise.all([
    pre ? Promise.resolve(null) : marketFor(f.mintPubkey),
    platformShareTotal(f.id),
    treasuryBalance(f).catch(() => null),
    listChanges(f.id, 30),
  ]);
  const mint = pre ? null : f.mintPubkey;
  const devnet = env.cluster === "devnet" ? "?cluster=devnet" : "";
  return ok({
    id: f.id, hasImage: !!f.image, slug: f.slug, name: f.name, ticker: f.ticker, tagline: f.tagline, venue: f.venue,
    status: pre ? "prelaunch" : "live",
    mint,
    treasury: f.treasuryPubkey,
    balanceLamports: balance,
    market,
    links: mint
      ? {
          buy: `https://jup.ag/swap/SOL-${mint}`,
          chart: market?.url ?? `https://dexscreener.com/solana/${mint}`,
          chartEmbed: market ? `https://dexscreener.com/solana/${market.pairAddress}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15` : null,
          solscan: `https://solscan.io/token/${mint}${devnet}`,
        }
      : null,
    funding: { sharePct: flagshipSharePct(), lifetimeLamports: shared },
    model: f.modelLabel,
    building: {
      enabled: selfdevEnabled(),
      shipped: changes.filter((c) => c.status === "merged").length,
      open: changes.filter((c) => c.status === "open").length,
      changes: changes.filter((c) => c.status !== "closed").map(publicChange),
    },
  });
});
