// Everything the /token page needs beyond the normal company payload: token + market data + funding.
import { handle, ok, fail } from "@/lib/http";
import { env } from "@/lib/env";
import { flagshipSharePct, flagshipTaxBps, getFlagship, isPrelaunch, marketFor, platformShareTotal } from "@/lib/flagship";
import { db, schema } from "@/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { solUsd } from "@/lib/price";
import { stonkfunTokenUrl } from "@/lib/stonkfun";
import { treasuryBalance } from "@/lib/treasury";
import { listChanges, publicChange, selfdevEnabled } from "@/lib/selfdev";
import { splitterStats } from "@/lib/hl/fee-splitter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const f = await getFlagship();
  if (!f) return fail(404, "no flagship yet");
  const pre = isPrelaunch(f);
  const [market, shared, balance, changes, onchain] = await Promise.all([
    pre ? Promise.resolve(null) : marketFor(f.mintPubkey),
    platformShareTotal(f.id),
    treasuryBalance(f).catch(() => null),
    listChanges(f.id, 30),
    splitterStats(),
  ]);
  const mint = pre ? null : f.mintPubkey;
  // self-sufficiency: fees its token generates (tax × volume) vs. what its agent spends on compute
  const [sol, [c24]] = await Promise.all([
    solUsd(),
    db.select({ s: sql<number>`coalesce(-sum(${schema.ledger.lamports}),0)` }).from(schema.ledger)
      .where(and(eq(schema.ledger.companyId, f.id), eq(schema.ledger.kind, "COMPUTE"), gt(schema.ledger.createdAt, new Date(Date.now() - 86_400_000)))),
  ]);
  const taxBps = flagshipTaxBps();
  const fees24hUsd = market?.volume24hUsd != null ? (market.volume24hUsd * taxBps) / 10_000 : null;
  const compute24hUsd = (Number(c24.s) / 1e9) * sol;
  const economics = pre ? null : {
    taxBps,
    fees24hUsd, fees24hSol: fees24hUsd == null ? null : fees24hUsd / sol,
    feesTotalUsd: f.taxFeesUsd ?? null,
    compute24hUsd, compute24hSol: Number(c24.s) / 1e9,
    computeTotalSol: f.lifetimeCompute / 1e9,
    coveragePct: fees24hUsd != null && compute24hUsd > 0 ? Math.round((fees24hUsd / compute24hUsd) * 100) : null,
  };
  const devnet = env.cluster === "devnet" ? "?cluster=devnet" : "";
  return ok({
    id: f.id, hasImage: !!f.image, slug: f.slug, name: f.name, ticker: f.ticker, tagline: f.tagline, venue: f.venue,
    status: pre ? "prelaunch" : "live",
    mint,
    treasury: f.treasuryPubkey,
    balanceLamports: balance,
    /** FeeSplitter on HyperEVM: public totals of platform revenue split and paid to the flagship (null if not deployed) */
    feeSplitter: onchain,
    market,
    economics,
    links: mint
      ? {
          buy: /stonkfun/i.test(f.venue ?? "") ? stonkfunTokenUrl(mint) : `https://jup.ag/swap/SOL-${mint}`,
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
