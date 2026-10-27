// Company websites live on their own subdomain: https://<slug>.<SITES_DOMAIN> (e.g. brew.stonkware.com).
// Without SITES_DOMAIN they fall back to <backend>/s/<slug>. Edge-safe (used by middleware).

export const RESERVED_SUBDOMAINS = new Set([
  "api", "www", "app", "admin", "mail", "smtp", "ftp", "static", "assets", "cdn", "docs", "status", "sites", "blog", "help", "support", "dev", "staging", "test-api",
]);

export const sitesDomain = () => (process.env.SITES_DOMAIN || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");

/** Public URL of a company's website. */
export function siteUrlFor(slug: string): string {
  const d = sitesDomain();
  if (d) return `https://${slug}.${d}`;
  return `${(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "")}/s/${slug}`;
}

/** If `host` is "<slug>.<SITES_DOMAIN>", return slug; else null. */
export function slugFromHost(host: string | null): string | null {
  const d = sitesDomain();
  if (!d || !host) return null;
  const h = host.toLowerCase().split(":")[0];
  if (!h.endsWith("." + d)) return null;
  const sub = h.slice(0, -(d.length + 1));
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(sub) || RESERVED_SUBDOMAINS.has(sub)) return null;
  return sub;
}
