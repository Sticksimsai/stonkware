// Metaplex token metadata JSON for a company's token (the on-chain URI points here unless Pinata is used).
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { siteUrlFor } from "@/lib/sites";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.id, params.id.replace(/\.json$/, "")) });
  if (!c) return new Response("not found", { status: 404 });
  const site = siteUrlFor(c.slug);
  const body = {
    name: c.name,
    symbol: c.ticker,
    description: c.aim.slice(0, 500),
    image: `${env.siteUrl}/api/image/${c.id}`,
    external_url: site,
    website: site,
    twitter: c.twitter ?? undefined,
    attributes: [{ trait_type: "mind", value: c.modelLabel }, { trait_type: "launchpad", value: "Stonkware" }],
    properties: { files: [{ uri: `${env.siteUrl}/api/image/${c.id}`, type: c.imageMime ?? "image/png" }], category: "image" },
  };
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
