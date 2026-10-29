// Caddy on-demand TLS "ask" hook: only issue certificates for subdomains of real companies.
//   GET /api/sites/allowed?domain=brew.hypeware.fun  → 200 | 404
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { slugFromHost } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const slug = slugFromHost(new URL(req.url).searchParams.get("domain"));
  if (!slug) return new Response("no", { status: 404 });
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.slug, slug), columns: { id: true, status: true } });
  return c && c.status !== "PENDING_FUNDING" && c.status !== "ARCHIVED" ? new Response("ok") : new Response("no", { status: 404 });
}
