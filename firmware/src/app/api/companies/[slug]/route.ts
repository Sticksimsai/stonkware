// Everything a company page needs in one call.
import { companyPage } from "@/lib/queries";
import { stonkfunTokenUrl } from "@/lib/stonkfun";
import { env, explorer } from "@/lib/env";
import { getCompany, treasuryBalance } from "@/lib/treasury";
import { fail, handle, ok } from "@/lib/http";
import { siteUrlFor } from "@/lib/sites";
import { listMedia, publicMedia } from "@/lib/media";
import { botStatus } from "@/lib/bots";
import { downloadUrl, listPackages } from "@/lib/packages";
import { merchEnabled, publicMerchMeta } from "@/lib/merch";
import { higgsfieldEnabled } from "@/lib/media/higgsfield";
import { isPrelaunch } from "@/lib/flagship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: { params: { slug: string } }) => {
  const d = await companyPage(params.slug);
  if (!d) return fail(404, "not found");
  const c = d.company;
  const balanceLamports = c.status === "LIVE" ? await treasuryBalance(await getCompany(c.id)).catch(() => null) : null;
  return ok({
    company: {
      id: c.id, slug: c.slug, name: c.name, ticker: c.ticker, aim: c.aim, tagline: c.tagline, twitter: c.twitter,
      model: c.model, modelLabel: c.modelLabel, status: c.status, launchError: c.launchError,
      creatorWallet: c.creatorWallet, treasuryPubkey: c.treasuryPubkey, mintPubkey: isPrelaunch(c) ? null : c.mintPubkey,
      source: c.source, flagship: c.flagship, venue: c.venue, quoteMint: c.quoteMint, quoteSymbol: c.quoteSymbol, launchAt: c.launchAt, prelaunch: isPrelaunch(c), poolAddress: c.poolAddress, migrated: c.migrated,
      lifetimeFees: c.lifetimeFees, lifetimeRevenue: c.lifetimeRevenue, lifetimeCompute: c.lifetimeCompute, lifetimeSpent: c.lifetimeSpent,
      tokensBurned: c.tokensBurned, sleepingUntil: c.sleepingUntil, lastRunAt: c.lastRunAt, createdAt: c.createdAt,
      balanceLamports,
      imageUrl: c.hasImage ? `${env.siteUrl}/api/image/${c.id}` : null,
      websiteUrl: c.flagship ? env.appUrl : d.files.length ? siteUrlFor(c.slug) : null,
      links: env.mode === "live" && c.status === "LIVE" && env.cluster !== "devnet" && !isPrelaunch(c)
        ? { trade: c.quoteMint ? stonkfunTokenUrl(c.mintPubkey) : `https://jup.ag/tokens/${c.mintPubkey}`, chart: `https://dexscreener.com/solana/${c.mintPubkey}`, treasury: explorer("account", c.treasuryPubkey) }
        : { trade: null, chart: null, treasury: explorer("account", c.treasuryPubkey) },
    },
    offers: d.offers.map((o) => ({
      id: o.id, title: o.title, description: o.description, priceLamports: o.priceLamports, active: o.active, createdAt: o.createdAt, kind: o.kind,
      merch: o.kind === "merch" ? publicMerchMeta(o.meta) : null,
    })),
    feed: d.feed,
    ledger: d.ledger,
    shifts: d.runs,
    websiteFiles: d.files.map((f) => f.path),
    ordersDelivered: d.delivered,
    media: (await listMedia(c.id, 24, true)).map(publicMedia),
    bots: (await botStatus(c.id)).map(({ platform, connected, account, link, code, enabled, commands, handled }) => ({ platform, connected, account, link, live: connected && code && enabled, commands, handled })),
    packages: (await listPackages(c.id, true)).map((p) => ({
      id: p.id, name: p.name, title: p.title, description: p.description, kind: p.kind, version: p.version, downloads: p.downloads,
      url: p.visibility === "public" ? downloadUrl(p) : null, paid: p.visibility !== "public",
    })),
    connectRequests: JSON.parse(c.connectRequests || "[]"),
    capabilities: { media: higgsfieldEnabled(), merch: merchEnabled(), bots: true, packages: true },
  });
});
