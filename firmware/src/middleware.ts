// 1) Company websites: <slug>.<SITES_DOMAIN>/<path>  →  internally served from /s/<slug>/<path>
// 2) CORS for the API so the separately hosted frontend can call it.
//    ALLOWED_ORIGINS="https://stonkware.com,*.vercel.app"  ("*" allows any origin)
import { NextResponse, type NextRequest } from "next/server";
import { slugFromHost } from "@/lib/sites";

function allowed(origin: string | null): string | null {
  if (!origin) return null;
  const list = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*")) return origin;
  return list.some((o) => o === origin || (o.startsWith("*.") && origin.endsWith(o.slice(1)))) ? origin : null;
}

export function middleware(req: NextRequest) {
  const slug = slugFromHost(req.headers.get("host"));
  if (slug) {
    const url = req.nextUrl.clone();
    url.pathname = `/s/${slug}${req.nextUrl.pathname === "/" ? "" : req.nextUrl.pathname}`;
    const headers = new Headers(req.headers);
    headers.set("x-fw-subdomain", "1");
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();

  const origin = allowed(req.headers.get("origin"));
  const headers: Record<string, string> = {};
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization";
    headers["Access-Control-Max-Age"] = "86400";
    headers["Vary"] = "Origin";
  }
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
