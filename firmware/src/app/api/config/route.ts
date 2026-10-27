// Public platform config for frontends: mode, fees, launch costs, URLs.
import { env } from "@/lib/env";
import { FEES } from "@/lib/fees";
import { LAUNCHPAD, feeSplitBps } from "@/lib/launchpad";
import { handle, ok } from "@/lib/http";
import { higgsfieldEnabled } from "@/lib/media/higgsfield";
import { getFlagship, isPrelaunch } from "@/lib/flagship";
import { poolStats, vanityEnabled } from "@/lib/vanity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Approximate per-trade split on StonkFun (LaunchLab curve fee; creator share is StonkFun's platform setting). */
function stonkSplit() {
  const total = Number(process.env.STONKFUN_FEE_BPS || 100);
  const creator = (total * Number(process.env.STONKFUN_CREATOR_SHARE_PCT || 50)) / 100;
  const firmware = (creator * env.creatorFeeShareBps) / 10_000;
  return { total, company: creator - firmware, firmware, meteora: total - creator };
}

export const GET = handle(async () => {
  const f = await getFlagship();
  const vanity = vanityEnabled() && (await poolStats()).available > 0 ? { suffix: process.env.VANITY_SUFFIX || "stnk" } : null;
  return ok({
    vanity,
    flagship: f ? { slug: f.slug, name: f.name, ticker: f.ticker, live: !isPrelaunch(f) } : null,
    mode: env.mode,
    venue: env.launchVenue,
    creatorFeeShareBps: env.launchVenue === "stonkfun" ? env.creatorFeeShareBps : 0,
    apiUrl: env.siteUrl,
    cluster: env.cluster,
    solanaRpcUrl: env.publicRpcUrl || null,
    launch: {
      launchCostLamports: FEES.launchCostLamports,
      defaultFuelSol: FEES.defaultFuelSol,
      maxImageBytes: 2 * 1024 * 1024,
      imageRequired: env.mode === "live",
    },
    fees: {
      tradeFeeSplitBps: env.launchVenue === "stonkfun" ? stonkSplit() : feeSplitBps(),
      venueLabel: env.launchVenue === "stonkfun" ? "StonkFun + Raydium" : "Meteora",
      antiSniper: { startFeeBps: LAUNCHPAD.startFeeBps, seconds: LAUNCHPAD.antiSniperSeconds },
      platformRevenueBps: FEES.platformRevenueBps,
      treasuryFloorLamports: FEES.treasuryFloorLamports,
    },
    media: { enabled: higgsfieldEnabled(), imageUsd: env.hfImageUsd, videoUsdPerSec: env.hfVideoUsdPerSec },
    curve: { initialMarketCapSol: LAUNCHPAD.initialMarketCapSol, migrationMarketCapSol: LAUNCHPAD.migrationMarketCapSol, totalSupply: LAUNCHPAD.totalSupply, decimals: LAUNCHPAD.decimals },
  });
});
