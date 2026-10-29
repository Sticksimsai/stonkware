// Serves each company's agent-built website at /s/<slug>/<path>.
// Sandboxed via CSP so agent-written scripts run in an opaque origin and can't touch Hypeware.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const placeholder = (name: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#060606;color:#888;font-family:ui-monospace,monospace">
<div>${name} — the agent hasn't built its website yet.</div></body>`;

export async function GET(req: Request, { params }: { params: { slug: string; path?: string[] } }) {
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.slug, params.slug), columns: { id: true, name: true, status: true, flagship: true } });
  if (!c || c.status === "ARCHIVED") return new Response("not found", { status: 404 });
  // the flagship's "website" is Hypeware itself
  if (c.flagship) return Response.redirect(`${env.appUrl.replace(/\/+$/, "")}/token`, 302);
  let path = (params.path ?? []).join("/") || "index.html";
  if (path.endsWith("/")) path += "index.html";
  let f = await db.query.siteFiles.findFirst({ where: and(eq(schema.siteFiles.companyId, c.id), eq(schema.siteFiles.path, path)) });
  if (!f && !path.includes(".")) f = await db.query.siteFiles.findFirst({ where: and(eq(schema.siteFiles.companyId, c.id), eq(schema.siteFiles.path, `${path}.html`)) });
  const headers = {
    "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  };
  if (!f) {
    if (path === "index.html") return new Response(placeholder(c.name), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    return new Response("not found", { status: 404, headers });
  }
  // Next strips trailing slashes, so pin relative URLs to the site root with a <base> tag.
  let body = f.content;
  // (not needed on the company subdomain, where the site is served from "/")
  if (req.headers.get("x-fw-subdomain") !== "1" && f.mime.startsWith("text/html") && !/<base\s/i.test(body)) {
    const base = `<base href="/s/${params.slug}/">`;
    body = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + base) : base + body;
  }
  return new Response(body, { headers: { ...headers, "Content-Type": f.mime } });
}
