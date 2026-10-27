// The agent's browser. Three backends, picked automatically:
//   1. Browserbase  (BROWSERBASE_API_KEY)  — cloud Chromium with an embeddable live view
//   2. Local Chromium (CHROMIUM_PATH)        — screenshots after every action
//   3. Fetch                                 — text-only fallback, no screenshots
import { lookup } from "dns/promises";
import { isIP } from "net";
import type { Browser, Page } from "playwright-core";
import { env } from "../env";

export type PageView = { url: string; title: string; text: string; links: { text: string; href: string }[]; more: boolean };
export type SearchResult = { title: string; url: string; snippet: string };

const TEXT_CHUNK = 5000;
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_URLS === "1"; // dev only

// ── SSRF guard: the agent must never reach our own network ──────────────────
const hostOk = new Map<string, boolean>();
function privateIp(ip: string) {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) URLs are allowed");
  if (ALLOW_PRIVATE) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("private address blocked");
  let ok = hostOk.get(host);
  if (ok === undefined) {
    const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    ok = addrs.length > 0 && addrs.every((a) => !privateIp(a));
    hostOk.set(host, ok);
  }
  if (!ok) throw new Error("private address blocked");
  return u;
}

function decodeDdg(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    return u.searchParams.get("uddg") ?? u.toString();
  } catch { return href; }
}

export interface AgentBrowser {
  kind: "browserbase" | "local" | "fetch";
  liveUrl: string | null;
  open(url: string): Promise<PageView>;
  search(q: string): Promise<SearchResult[]>;
  click(text: string): Promise<PageView>;
  fill(field: string, value: string, submit: boolean): Promise<PageView>;
  readMore(): Promise<PageView>;
  screenshot(): Promise<Buffer | null>;
  currentUrl(): string | null;
  close(): Promise<void>;
}

// ── Playwright-backed (Browserbase or local) ────────────────────────────────
class PwBrowser implements AgentBrowser {
  private offset = 0;
  constructor(public kind: "browserbase" | "local", private browser: Browser, private page: Page, public liveUrl: string | null, private onClose?: () => Promise<void>) {}

  private async view(): Promise<PageView> {
    await this.page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(800);
    const d = await this.page.evaluate(() => {
      const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n");
      const seen = new Set<string>();
      const links: { text: string; href: string }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
        const t = (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80);
        if (!t || seen.has(a.href) || !a.href.startsWith("http")) continue;
        seen.add(a.href);
        links.push({ text: t, href: a.href });
        if (links.length >= 40) break;
      }
      return { title: document.title, text, links };
    });
    const text = d.text.slice(this.offset, this.offset + TEXT_CHUNK);
    return { url: this.page.url(), title: d.title, text, links: this.offset === 0 ? d.links : [], more: d.text.length > this.offset + TEXT_CHUNK };
  }

  async open(url: string) {
    await assertPublicUrl(url);
    this.offset = 0;
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return this.view();
  }
  async search(q: string) {
    await this.page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    this.offset = 0;
    const rows = await this.page.evaluate(() =>
      (Array.from(document.querySelectorAll(".result")) as HTMLElement[]).slice(0, 10).map((r) => ({
        title: (r.querySelector(".result__a") as HTMLElement | null)?.innerText ?? "",
        href: (r.querySelector(".result__a") as HTMLAnchorElement | null)?.getAttribute("href") ?? "",
        snippet: (r.querySelector(".result__snippet") as HTMLElement | null)?.innerText ?? "",
      })),
    );
    return rows.filter((r) => r.href).map((r) => ({ title: r.title, url: decodeDdg(r.href), snippet: r.snippet }));
  }
  async click(text: string) {
    this.offset = 0;
    const p = this.page;
    const target = p.getByRole("link", { name: text }).or(p.getByRole("button", { name: text })).or(p.getByText(text, { exact: false })).first();
    await target.click({ timeout: 8000 });
    await assertPublicUrl(p.url()).catch(async (e) => { await p.goBack().catch(() => {}); throw e; });
    return this.view();
  }
  async fill(field: string, value: string, submit: boolean) {
    const p = this.page;
    const target = /^[#.\[]|^\w+\[/.test(field)
      ? p.locator(field).first()
      : p.getByLabel(field).or(p.getByPlaceholder(field)).or(p.getByRole("textbox", { name: field })).or(p.getByRole("searchbox")).first();
    await target.fill(value, { timeout: 8000 });
    if (submit) await target.press("Enter");
    this.offset = 0;
    return this.view();
  }
  async readMore() {
    this.offset += TEXT_CHUNK;
    return this.view();
  }
  async screenshot() {
    try { return await this.page.screenshot({ type: "jpeg", quality: 50, timeout: 10000 }); } catch { return null; }
  }
  currentUrl() { return this.page.url(); }
  async close() {
    await this.browser.close().catch(() => {});
    await this.onClose?.().catch(() => {});
  }
}

async function guardRequests(page: Page) {
  if (ALLOW_PRIVATE) return;
  await page.route("**/*", async (route) => {
    try {
      await assertPublicUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

async function browserbase(): Promise<AgentBrowser> {
  const { chromium } = await import("playwright-core");
  const h = { "X-BB-API-Key": env.browserbaseKey, "Content-Type": "application/json" };
  const r = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST", headers: h,
    body: JSON.stringify({ projectId: env.browserbaseProject || undefined, timeout: 1800, browserSettings: { viewport: { width: 1280, height: 800 } } }),
  });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    const hint = r.status === 401 || r.status === 403 ? " (check BROWSERBASE_API_KEY)" : r.status === 429 ? " (plan's concurrent session limit reached: lower AGENT_MAX_CONCURRENT or upgrade)" : r.status === 400 || r.status === 404 ? " (check BROWSERBASE_PROJECT_ID)" : "";
    throw new Error(`browserbase ${r.status}${hint}: ${body}`);
  }
  const s = (await r.json()) as { id: string; connectUrl: string };
  const browser = await chromium.connectOverCDP(s.connectUrl);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  let liveUrl: string | null = null;
  try {
    const d = (await (await fetch(`https://api.browserbase.com/v1/sessions/${s.id}/debug`, { headers: h })).json()) as { debuggerFullscreenUrl?: string };
    if (d.debuggerFullscreenUrl) liveUrl = d.debuggerFullscreenUrl + (d.debuggerFullscreenUrl.includes("?") ? "&" : "?") + "navbar=false";
  } catch { /* live view optional */ }
  const release = async () => {
    await fetch(`https://api.browserbase.com/v1/sessions/${s.id}`, { method: "POST", headers: h, body: JSON.stringify({ projectId: env.browserbaseProject || undefined, status: "REQUEST_RELEASE" }) });
  };
  return new PwBrowser("browserbase", browser, page, liveUrl, release);
}

async function local(): Promise<AgentBrowser> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: env.chromiumPath, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" });
  const page = await ctx.newPage();
  await guardRequests(page);
  return new PwBrowser("local", browser, page, null);
}

// ── Fetch fallback ───────────────────────────────────────────────────────────
function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

class FetchBrowser implements AgentBrowser {
  kind = "fetch" as const;
  liveUrl = null;
  private url: string | null = null;
  private html = "";
  private offset = 0;

  private view(): PageView {
    const text = htmlToText(this.html);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(this.html)?.[1]?.trim() ?? "";
    const links: { text: string; href: string }[] = [];
    if (this.offset === 0) {
      for (const m of Array.from(this.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi))) {
        const t = htmlToText(m[2]).slice(0, 80);
        try {
          const href = new URL(m[1], this.url ?? undefined).toString();
          if (t && href.startsWith("http")) links.push({ text: t, href });
        } catch { /* skip */ }
        if (links.length >= 40) break;
      }
    }
    return { url: this.url ?? "", title, text: text.slice(this.offset, this.offset + TEXT_CHUNK), links, more: text.length > this.offset + TEXT_CHUNK };
  }
  private async get(url: string, hops = 0): Promise<void> {
    await assertPublicUrl(url);
    const r = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 FirmwareAgent" }, signal: AbortSignal.timeout(20000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location") && hops < 5) return this.get(new URL(r.headers.get("location")!, url).toString(), hops + 1);
    this.url = url;
    this.html = (await r.text()).slice(0, 2_000_000);
    this.offset = 0;
  }
  async open(url: string) { await this.get(url); return this.view(); }
  async search(q: string) {
    await this.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    const out: SearchResult[] = [];
    for (const m of Array.from(this.html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi))) {
      out.push({ url: decodeDdg(m[1].replace(/&amp;/g, "&")), title: htmlToText(m[2]), snippet: htmlToText(m[3]) });
      if (out.length >= 10) break;
    }
    return out;
  }
  async click(text: string) {
    const link = this.view().links.find((l) => l.text.toLowerCase().includes(text.toLowerCase()));
    if (!link) throw new Error(`no link matching "${text}" (text-only browser: use open_url)`);
    return this.open(link.href);
  }
  async fill(): Promise<PageView> { throw new Error("forms are not supported by the text-only browser"); }
  async readMore() { this.offset += TEXT_CHUNK; return this.view(); }
  async screenshot() { return null; }
  currentUrl() { return this.url; }
  async close() {}
}

/** Why the last openBrowser() fell back to a lesser browser (shown in the live view). */
export let lastBrowserFallback: string | null = null;
const redact = (s: string) => s.replace(/bb_live_[A-Za-z0-9_-]+|apiKey=[^&\s"]+/g, "[key]").slice(0, 300);

export async function openBrowser(): Promise<AgentBrowser> {
  const reasons: string[] = [];
  if (env.browserbaseKey) {
    if (!env.browserbaseProject) reasons.push("Browserbase: BROWSERBASE_PROJECT_ID is not set");
    else {
      try { lastBrowserFallback = null; return await browserbase(); } catch (e) {
        const m = redact((e as Error).message);
        console.error("[browser] browserbase failed, falling back:", m);
        reasons.push(`Browserbase: ${m}`);
      }
    }
  } else reasons.push("Browserbase: BROWSERBASE_API_KEY is not set");
  if (env.chromiumPath) {
    try { const b = await local(); lastBrowserFallback = reasons.join(" · "); return b; } catch (e) {
      console.error("[browser] local chromium failed, falling back:", (e as Error).message);
      reasons.push(`local Chromium: ${redact((e as Error).message)}`);
    }
  }
  lastBrowserFallback = reasons.join(" · ");
  return new FetchBrowser();
}
