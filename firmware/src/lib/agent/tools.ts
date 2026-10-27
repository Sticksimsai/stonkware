// Everything the agent can do. It has full control of its company; the only guards are
// physical (balance), structural (valid inputs) and the SSRF guard in the browser.
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "../env";
import { OFFER_BOUNDS } from "../policy";
import { buybackAndBurn, getCompany, spentLast24h, transferSol, treasuryBalance } from "../treasury";
import { emit } from "../feed";
import { isAddress } from "../solana";
import { fmtSol, lamports } from "../units";
import type { AgentBrowser, PageView } from "./browser";
import type { ToolDef } from "./llm";
import { siteUrlFor } from "../sites";
import { estimateUsd, listMedia, mediaUrl, requestMedia, waitFor } from "../media";
import type { Company, Media } from "@/db/schema";
import { botStatus, checkBotCode, getConnection, isPlatform, pushCommands, runBot, validCommands, type BotMessage } from "../bots";
import { downloadUrl, listPackages, packageFilesList, packageName, publishPackage, writePackageFile, PACKAGE_KINDS } from "../packages";
import { createMerchOffer, getProduct, merchEnabled, searchCatalog } from "../merch";
import * as dev from "../selfdev";
import { listFiles, readFile, searchCode } from "../selfdev/github";

const S = schema;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });
const n = (description: string) => ({ type: "number", description });

export const TOOLS: ToolDef[] = [
  { name: "web_search", description: "Search the web. Returns titles, URLs and snippets.", parameters: obj({ query: s("search query") }, ["query"]) },
  { name: "open_url", description: "Open a URL in your browser and read the page text + links.", parameters: obj({ url: s("absolute http(s) URL") }, ["url"]) },
  { name: "click", description: "Click a link or button on the current page by its visible text.", parameters: obj({ text: s("visible text of the link/button") }, ["text"]) },
  { name: "fill", description: "Type into an input on the current page (by label, placeholder or CSS selector), optionally pressing Enter.", parameters: obj({ field: s("label, placeholder or CSS selector"), value: s("text to type"), submit: { type: "boolean" } }, ["field", "value"]) },
  { name: "read_more", description: "Read the next chunk of text on the current page.", parameters: obj({}) },

  { name: "write_site_file", description: "Create or overwrite a file on your company website (served at your site URL). index.html is the homepage. Use plain HTML/CSS/JS; you may reference other files you write by relative path.", parameters: obj({ path: s("e.g. index.html, about.html, styles.css, app.js"), content: s("full file content") }, ["path", "content"]) },
  { name: "read_site_file", description: "Read a file from your website.", parameters: obj({ path: s("file path") }, ["path"]) },
  { name: "list_site_files", description: "List your website files.", parameters: obj({}) },
  { name: "delete_site_file", description: "Delete a website file.", parameters: obj({ path: s("file path") }, ["path"]) },
  { name: "set_tagline", description: "Set the one-line public description shown on Stonkware.", parameters: obj({ tagline: s("max 140 chars") }, ["tagline"]) },

  { name: "generate_image", description: "Create an image with AI (Higgsfield). Use it for your website, branding, product shots, social posts or customer deliverables. Returns a public URL you can embed with <img>. Billed to your treasury (~$" + "IMAGE_USD per image).", parameters: obj({ prompt: s("detailed visual description: subject, setting, style, lighting, composition"), aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16"] } }, ["prompt"]) },
  { name: "generate_video", description: "Create a video clip with AI (Higgsfield: Seedance 2.5 with sound for text-to-video, Kling to animate one of your images via from_image_id). Renders take 1–5 minutes in the background: check list_media for the URL, then embed it with <video src controls playsinline>. Billed per second (~$" + "VIDEO_USD per second).", parameters: obj({ prompt: s("the shot: subject, action, camera movement, mood, style"), seconds: n("4–30 for text-to-video (3–15 when animating an image), default 5"), aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] }, from_image_id: s("optional: media id of one of your images to animate") }, ["prompt"]) },
  { name: "list_media", description: "Your generated images and videos with their status and URLs.", parameters: obj({}) },

  { name: "create_offer", description: "Start selling something. Buyers pay SOL into your treasury on your Stonkware storefront. Services: you deliver with deliver_order. If you pass `package`, it's a paid download that is delivered instantly and automatically.", parameters: obj({ title: s("offer name"), description: s("what the buyer gets"), price_sol: n("price in SOL"), package: s("optional: name of a published package to sell as a download") }, ["title", "description", "price_sol"]) },

  { name: "write_bot", description: "Write (or rewrite) the code of your Telegram or Discord bot. JavaScript defining `async function onMessage(msg)` that returns the reply: a string, or { text, buttons: [{ text, url }] }, or null for no reply. msg = { platform, text, command, args, user: { id, name, username }, chat: { id, type } } (command is e.g. \"start\" for /start; Discord bots only receive slash commands). Available inside: `await ai(prompt, { system })` → string (an AI reply, billed to your treasury), `await kv.get/set/del/incr/list` (persistent storage for users, points, settings), `company` (name, ticker, website, storefront, page), console.log. No network or npm. The code is checked before saving; test it with test_bot.", parameters: obj({ platform: { type: "string", enum: ["telegram", "discord"] }, code: s("full JavaScript source") }, ["platform", "code"]) },
  { name: "test_bot", description: "Send a test message to your bot code and see its reply (AI calls inside are billed).", parameters: obj({ platform: { type: "string", enum: ["telegram", "discord"] }, text: s("message text, e.g. /start or hello") }, ["platform", "text"]) },
  { name: "set_bot_commands", description: "Set the slash commands your bot shows in Telegram/Discord menus.", parameters: obj({ platform: { type: "string", enum: ["telegram", "discord"] }, commands: { type: "array", items: obj({ name: s("e.g. start"), description: s("what it does") }, ["name", "description"]) } }, ["platform", "commands"]) },
  { name: "bot_status", description: "Your bots: connected accounts, links, message counts, errors, and the latest conversations so you can improve them.", parameters: obj({ platform: { type: "string", enum: ["telegram", "discord"] } }) },
  { name: "request_connection", description: "Ask your creator to connect an account only a human can create (a Telegram bot token from @BotFather, or a Discord application). Shows a request on your company page; you'll be woken when it's connected. Write the bot code meanwhile.", parameters: obj({ platform: { type: "string", enum: ["telegram", "discord"] }, why: s("what you'll run on it, shown to the creator and public") }, ["platform", "why"]) },

  { name: "write_package_file", description: "Create or update a file in a downloadable package you build: a Chrome/browser extension (Manifest V3), an app, a template or a script. For images (icons) pass from_media_id instead of content.", parameters: obj({ package: s("package name, e.g. focus-timer-extension"), path: s("file path inside the package, e.g. manifest.json, popup.html, icons/icon128.png"), content: s("file content (text files)"), from_media_id: s("media id of one of your generated images (binary files)") }, ["package", "path"]) },
  { name: "publish_package", description: "Ship a version of a package. Public = free download link on your company page. Private = only via a paid offer (create_offer with package).", parameters: obj({ package: s("package name"), title: s("display name"), description: s("what it does and how to install/use it"), kind: { type: "string", enum: [...PACKAGE_KINDS] }, visibility: { type: "string", enum: ["public", "private"] } }, ["package", "title", "description", "kind", "visibility"]) },
  { name: "list_packages", description: "Your packages, their files, versions, downloads and links.", parameters: obj({}) },

  { name: "code_tree", description: "STONKWARE CODE (flagship only). List files in Stonkware's own repository (monorepo: firmware/ = backend + agents, firmware-web/ = website).", parameters: obj({ path: s("folder prefix, e.g. firmware-web/src/components") }) },
  { name: "code_read", description: "STONKWARE CODE. Read a file from the repository's main branch, with line numbers.", parameters: obj({ path: s("file path"), start_line: n("optional"), end_line: n("optional (max 600 lines per read)") }, ["path"]) },
  { name: "code_search", description: "STONKWARE CODE. Search the repository for a word or identifier.", parameters: obj({ query: s("text to find") }, ["query"]) },
  { name: "code_propose", description: "STONKWARE CODE. Propose an improvement to Stonkware as a pull request. Each change: { path, content } for a new/rewritten file, { path, edits: [{ find, replace }] } for exact in-place edits (find must match once), or { path, delete: true }. CI runs typecheck, tests and builds. Safe areas (website, docs, your own agent tools/prompts) merge and deploy automatically when checks pass; protected code (money, keys, payments, auth, dependencies, deploy) waits for a human maintainer.", parameters: obj({ title: s("short PR title"), why: s("what it improves, for whom, and how you verified it"), changes: { type: "array", items: obj({ path: s("repo path"), content: s("full new content"), edits: { type: "array", items: obj({ find: s("exact existing text"), replace: s("replacement") }, ["find", "replace"]) }, delete: { type: "boolean" } }, ["path"]) } }, ["title", "why", "changes"]) },
  { name: "code_update", description: "STONKWARE CODE. Push a fix to one of your open pull requests (e.g. after CI failed).", parameters: obj({ pr: n("PR number"), message: s("commit message"), changes: { type: "array", items: obj({ path: s("repo path"), content: s("full content"), edits: { type: "array", items: obj({ find: s("exact text"), replace: s("replacement") }, ["find", "replace"]) }, delete: { type: "boolean" } }, ["path"]) } }, ["pr", "message", "changes"]) },
  { name: "code_prs", description: "STONKWARE CODE. Your proposed changes: status, lane, CI result, and the error output of failing checks so you can fix them.", parameters: obj({}) },
  { name: "code_close", description: "STONKWARE CODE. Close one of your open pull requests.", parameters: obj({ pr: n("PR number"), reason: s("why") }, ["pr", "reason"]) },

  { name: "merch_catalog", description: "Search Printful's print-on-demand catalog (t-shirts, hoodies, mugs, posters, stickers, phone cases, hats…).", parameters: obj({ search: s("e.g. t-shirt, hoodie, mug, poster, sticker") }, ["search"]) },
  { name: "merch_product", description: "Variants (size/colour) and production cost (USD) for one catalog product, plus print placements.", parameters: obj({ product_id: n("product id from merch_catalog") }, ["product_id"]) },
  { name: "create_merch_offer", description: "Sell physical merch with your design. Customers pick a variant, pay SOL and enter a shipping address; Stonkware sends the order to Printful automatically and the production + shipping cost is charged to your treasury. Price must cover cost with margin.", parameters: obj({ title: s("product name"), description: s("sales copy"), product_id: n("catalog product id"), variant_ids: { type: "array", items: { type: "number" }, description: "variant ids to offer (e.g. sizes in one colour)" }, design_media_id: s("media id of your design image (generate_image; square, high-contrast works best)"), placement: s("print placement, usually front"), price_sol: n("price in SOL") }, ["title", "description", "product_id", "variant_ids", "design_media_id", "price_sol"]) },
  { name: "update_offer", description: "Change an offer's price or pause/resume it.", parameters: obj({ offer_id: s("offer id"), price_sol: n("new price"), active: { type: "boolean" } }, ["offer_id"]) },
  { name: "deliver_order", description: "Deliver a paid order to the buyer. Use format html for a page/app, markdown for documents.", parameters: obj({ order_id: s("order id"), content: s("the full deliverable"), format: { type: "string", enum: ["markdown", "html"] } }, ["order_id", "content", "format"]) },

  { name: "check_treasury", description: "Current balance, income, spending and recent ledger entries.", parameters: obj({}) },
  { name: "buyback", description: "Spend SOL buying your own token on the market; burns the tokens unless burn=false (then the treasury holds them).", parameters: obj({ sol: n("SOL to spend"), burn: { type: "boolean" } }, ["sol"]) },
  { name: "transfer_sol", description: "Send SOL from the treasury to any Solana address (pay contractors, services, rewards…). Irreversible.", parameters: obj({ to: s("recipient address"), sol: n("amount in SOL"), reason: s("public reason, shown on your page") }, ["to", "sol", "reason"]) },

  { name: "post_update", description: "Publish a public post to your company feed.", parameters: obj({ title: s("headline"), body: s("post body") }, ["title", "body"]) },
  { name: "remember", description: "Save a note to long-term memory (you see these every shift).", parameters: obj({ note: s("max 400 chars") }, ["note"]) },
  { name: "sleep", description: "End the shift and sleep for a while to save money.", parameters: obj({ hours: n("0.25–48"), reason: s("why") }, ["hours", "reason"]) },
  { name: "end_shift", description: "End this work session with a summary of what you did and what's next.", parameters: obj({ summary: s("summary") }, ["summary"]) },
];

export const BROWSER_TOOLS = new Set(["web_search", "open_url", "click", "fill", "read_more"]);
export const MEDIA_TOOLS = new Set(["generate_image", "generate_video", "list_media"]);
export const MERCH_TOOLS = new Set(["merch_catalog", "merch_product", "create_merch_offer"]);
export const DEV_TOOLS = new Set(["code_tree", "code_read", "code_search", "code_propose", "code_update", "code_prs", "code_close"]);

/** Tool list with live prices filled in; media tools only when the studio is enabled. */
const SITE_TOOLS = new Set(["write_site_file", "read_site_file", "list_site_files", "delete_site_file"]);

export function toolsFor(mediaOn: boolean, c?: Pick<Company, "flagship">): ToolDef[] {
  const devOn = !!c?.flagship && dev.selfdevEnabled();
  // the flagship has no separate company website: its product is Stonkware itself, changed through code PRs
  const siteOn = !c?.flagship;
  return TOOLS.filter((t) => (mediaOn || !MEDIA_TOOLS.has(t.name)) && (merchEnabled() || !MERCH_TOOLS.has(t.name)) && (devOn || !DEV_TOOLS.has(t.name)) && (siteOn || !SITE_TOOLS.has(t.name))).map((t) => ({
    ...t,
    description: t.description.replace("IMAGE_USD", estimateUsd("image").toFixed(3)).replace("VIDEO_USD", (estimateUsd("video", 1)).toFixed(3)),
  }));
}

export type ToolCtx = {
  company: Company;
  browser: () => Promise<AgentBrowser>;
  done: boolean;
  summary: string | null;
  runId?: string;
  /** Called when a render finishes during the shift (shown in the live view). */
  onMedia?: (m: Media) => Promise<void>;
};

const mediaLine = (m: Media) =>
  `- ${m.id} ${m.kind}${m.durationSec ? ` ${m.durationSec}s` : ""} ${m.aspect ?? ""} [${m.status}]${m.status === "completed" ? ` ${mediaUrl(m)}` : ""}${m.error ? ` (${m.error})` : ""} — "${m.prompt.slice(0, 80)}"`;

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  json: "application/json", svg: "image/svg+xml", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", xml: "application/xml",
};
export function normPath(p: string) {
  const path = String(p || "").trim().replace(/^\/+/, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,120}$/.test(path) || path.includes("..") || path.includes("//")) throw new Error("invalid path");
  const ext = path.split(".").pop()!.toLowerCase();
  if (!MIME[ext]) throw new Error(`unsupported file type .${ext} (allowed: ${Object.keys(MIME).join(", ")})`);
  return { path, mime: MIME[ext] };
}

function pageOut(v: PageView) {
  return [
    `URL: ${v.url}`, `TITLE: ${v.title}`, "TEXT:", v.text || "(empty)",
    v.more ? "\n[more text available: call read_more]" : "",
    v.links.length ? "\nLINKS:\n" + v.links.map((l) => `- ${l.text} → ${l.href}`).join("\n") : "",
  ].join("\n");
}

const str = (v: unknown, max = 100_000) => String(v ?? "").slice(0, max);

export async function runTool(ctx: ToolCtx, name: string, a: Record<string, unknown>): Promise<string> {
  const c = (ctx.company = await getCompany(ctx.company.id));
  if (DEV_TOOLS.has(name) && !(c.flagship && dev.selfdevEnabled())) throw new Error("code tools are only available to the flagship agent");
  switch (name) {
    // ── Stonkware's own code (flagship) ──
    case "code_tree": {
      const prefix = str(a.path, 200).replace(/^\/+|\/+$/g, "");
      const files = (await listFiles()).filter((f) => !prefix || f.path === prefix || f.path.startsWith(prefix + "/"));
      if (!files.length) return "no files under that path";
      return files.slice(0, 400).map((f) => `${f.path} (${f.size}b)`).join("\n") + (files.length > 400 ? `\n… ${files.length - 400} more, narrow the path` : "");
    }
    case "code_read": {
      const text = await readFile(str(a.path, 300));
      if (text === null) return "not found on main";
      const lines = text.split("\n");
      const from = Math.max(1, Number(a.start_line) || 1);
      const to = Math.min(lines.length, Number(a.end_line) || from + 599, from + 599);
      return `${str(a.path, 300)} (${lines.length} lines, showing ${from}-${to})\n` + lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join("\n");
    }
    case "code_search": {
      const r = await searchCode(str(a.query, 120));
      return r.length ? r.map((x) => `${x.path}${x.fragments.length ? `\n    ${x.fragments.join("\n    ").slice(0, 400)}` : ""}`).join("\n") : "no matches (GitHub's index can lag a few minutes behind new commits; try code_tree + code_read)";
    }
    case "code_propose": {
      const r = await dev.propose(c, { title: str(a.title, 100), why: str(a.why, 4000), changes: (a.changes ?? []) as dev.Change[] });
      return `opened PR #${r.number} (${r.lane === "auto" ? "auto lane: merges + deploys itself when CI passes" : `review lane: a maintainer must approve; protected/out-of-area: ${r.protectedFiles.join(", ")}`}). Check progress with code_prs.`;
    }
    case "code_update": {
      const r = await dev.update(c, Number(a.pr), { message: str(a.message, 200), changes: (a.changes ?? []) as dev.Change[] });
      return `pushed to #${Number(a.pr)} (${r.files} files, lane ${r.lane}). CI re-runs now.`;
    }
    case "code_prs": {
      const rows = await dev.listChanges(c.id, 15);
      if (!rows.length) return "no changes proposed yet";
      const out: string[] = [];
      for (const r of rows) {
        out.push(`#${r.prNumber} [${r.status}${r.status === "open" ? ` · CI ${r.ci} · ${r.lane}` : ""}] ${r.title} (+${r.additions} −${r.deletions})`);
        if (r.status === "open" && r.ci === "failure") for (const f of await dev.failures(r.prNumber).catch(() => [])) out.push("    " + f.replace(/\n/g, "\n    "));
      }
      return out.join("\n");
    }
    case "code_close": await dev.close(c, Number(a.pr), str(a.reason, 500)); return "closed";

    // ── browsing ──
    case "web_search": {
      const r = await (await ctx.browser()).search(str(a.query, 300));
      return r.length ? r.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join("\n") : "no results";
    }
    case "open_url": return pageOut(await (await ctx.browser()).open(str(a.url, 2000)));
    case "click": return pageOut(await (await ctx.browser()).click(str(a.text, 200)));
    case "fill": return pageOut(await (await ctx.browser()).fill(str(a.field, 300), str(a.value, 2000), !!a.submit));
    case "read_more": return pageOut(await (await ctx.browser()).readMore());

    // ── website ──
    case "write_site_file": {
      const { path, mime } = normPath(str(a.path));
      const content = str(a.content, 400_000);
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(S.siteFiles).where(eq(S.siteFiles.companyId, c.id));
      const exists = await db.query.siteFiles.findFirst({ where: and(eq(S.siteFiles.companyId, c.id), eq(S.siteFiles.path, path)) });
      if (!exists && count >= 80) throw new Error("site file limit (80) reached");
      await db.insert(S.siteFiles).values({ companyId: c.id, path, content, mime })
        .onConflictDoUpdate({ target: [S.siteFiles.companyId, S.siteFiles.path], set: { content, mime, updatedAt: new Date() } });
      await emit(c.id, "ACTION", `${exists ? "Updated" : "Published"} /${path} on its website`, "");
      return `saved ${path} (${content.length} chars) → ${siteUrlFor(c.slug)}${path === "index.html" ? "" : "/" + path}`;
    }
    case "read_site_file": {
      const { path } = normPath(str(a.path));
      const f = await db.query.siteFiles.findFirst({ where: and(eq(S.siteFiles.companyId, c.id), eq(S.siteFiles.path, path)) });
      return f ? f.content.slice(0, 60_000) : "not found";
    }
    case "list_site_files": {
      const fs = await db.select({ path: S.siteFiles.path, n: sql<number>`length(${S.siteFiles.content})`, u: S.siteFiles.updatedAt }).from(S.siteFiles).where(eq(S.siteFiles.companyId, c.id));
      return fs.length ? fs.map((f) => `${f.path} (${f.n} chars, updated ${f.u.toISOString()})`).join("\n") : "no files yet";
    }
    case "delete_site_file": {
      const { path } = normPath(str(a.path));
      await db.delete(S.siteFiles).where(and(eq(S.siteFiles.companyId, c.id), eq(S.siteFiles.path, path)));
      return "deleted";
    }
    case "set_tagline": {
      await db.update(S.companies).set({ tagline: str(a.tagline, 140) }).where(eq(S.companies.id, c.id));
      return "ok";
    }

    // ── media studio ──
    case "generate_image": {
      const m = await requestMedia(c, { kind: "image", prompt: str(a.prompt, 2400), aspect: str(a.aspect_ratio, 8), runId: ctx.runId });
      const done = await waitFor(m, 90_000);
      if (done.status === "completed") {
        await ctx.onMedia?.(done);
        return `image ready: ${mediaUrl(done)} (id ${done.id}). Embed with <img src="${mediaUrl(done)}" alt="…">`;
      }
      if (done.status === "queued" || done.status === "in_progress") return `still rendering (id ${done.id}); check list_media shortly`;
      throw new Error(`image ${done.status}: ${done.error ?? "no output"}`);
    }
    case "generate_video": {
      const m = await requestMedia(c, { kind: "video", prompt: str(a.prompt, 2400), aspect: str(a.aspect_ratio, 8), durationSec: Number(a.seconds) || 5, fromImageId: a.from_image_id ? str(a.from_image_id, 64) : undefined, runId: ctx.runId });
      await emit(c.id, "ACTION", `Started rendering a ${m.durationSec}s video`, m.prompt.slice(0, 280));
      return `rendering video ${m.id} (${m.durationSec}s ${m.aspect}, ~${fmtSol(m.costLamports, 4)}). It takes a few minutes; keep working and check list_media for the URL.`;
    }
    case "list_media": {
      const rows = await listMedia(c.id, 30);
      return rows.length ? rows.map(mediaLine).join("\n") : "no media yet";
    }

    // ── bots ──
    case "write_bot": {
      const platform = a.platform;
      if (!isPlatform(platform)) throw new Error("platform must be telegram or discord");
      const code = str(a.code, 60_000);
      await checkBotCode(c, code);
      await db.insert(S.bots).values({ companyId: c.id, platform, code })
        .onConflictDoUpdate({ target: [S.bots.companyId, S.bots.platform], set: { code, enabled: true, updatedAt: new Date() } });
      const conn = await getConnection(c.id, platform);
      await emit(c.id, "ACTION", `Updated its ${platform === "telegram" ? "Telegram" : "Discord"} bot`, "");
      return `saved (${code.length} chars).${conn ? " It's live now." : " Not connected yet: use request_connection so the creator connects the account."} Try it with test_bot.`;
    }
    case "test_bot": {
      const platform = a.platform;
      if (!isPlatform(platform)) throw new Error("platform must be telegram or discord");
      const bot = await db.query.bots.findFirst({ where: and(eq(S.bots.companyId, c.id), eq(S.bots.platform, platform)) });
      if (!bot) throw new Error("write_bot first");
      const text = str(a.text, 2000);
      const cmd = /^\/([a-z0-9_]+)\s*([\s\S]*)$/i.exec(text);
      const msg: BotMessage = { platform, text, command: cmd ? cmd[1].toLowerCase() : null, args: cmd ? cmd[2].trim() : text, user: { id: "test", name: "Tester", username: "tester" }, chat: { id: "test", type: "private" } };
      const r = await runBot(c, bot.code, msg);
      return r.ok ? `reply: ${JSON.stringify(r.value).slice(0, 3000)}${r.logs.length ? `\nlogs:\n${r.logs.join("\n")}` : ""}` : `error: ${r.error}${r.logs.length ? `\nlogs:\n${r.logs.join("\n")}` : ""}`;
    }
    case "set_bot_commands": {
      const platform = a.platform;
      if (!isPlatform(platform)) throw new Error("platform must be telegram or discord");
      const cmds = validCommands(a.commands);
      const bot = await db.query.bots.findFirst({ where: and(eq(S.bots.companyId, c.id), eq(S.bots.platform, platform)) });
      if (!bot) throw new Error("write_bot first");
      await db.update(S.bots).set({ commands: JSON.stringify(cmds) }).where(eq(S.bots.id, bot.id));
      const pushed = await pushCommands(c.id, platform, cmds);
      return `commands set: ${cmds.map((x) => "/" + x.name).join(" ")}${pushed ? " (live)" : " (will apply when connected)"}`;
    }
    case "bot_status": {
      const st = await botStatus(c.id);
      const events = await db.select().from(S.botEvents).where(isPlatform(a.platform) ? and(eq(S.botEvents.companyId, c.id), eq(S.botEvents.platform, a.platform)) : eq(S.botEvents.companyId, c.id)).orderBy(desc(S.botEvents.createdAt)).limit(15);
      return [
        ...st.map((b) => `${b.platform}: ${b.connected ? `connected ${b.account} ${b.link}` : "NOT connected"} · code ${b.code ? "yes" : "no"} · commands ${b.commands.join(", ") || "none"} · ${b.handled} messages, ${b.errors} errors`),
        "recent conversations:",
        ...(events.length ? events.map((e) => `- [${e.platform}] "${e.input.slice(0, 120)}" → ${e.error ? `ERROR ${e.error}` : `"${(e.output ?? "").slice(0, 160)}"`} (${e.ms}ms)`) : ["(none yet)"]),
      ].join("\n");
    }
    case "request_connection": {
      const platform = a.platform;
      if (!isPlatform(platform)) throw new Error("platform must be telegram or discord");
      if (await getConnection(c.id, platform)) return "already connected";
      const reqs = (JSON.parse(c.connectRequests || "[]") as { platform: string }[]).filter((r) => r.platform !== platform);
      reqs.push({ platform, why: str(a.why, 300), at: new Date().toISOString() } as never);
      await db.update(S.companies).set({ connectRequests: JSON.stringify(reqs) }).where(eq(S.companies.id, c.id));
      await emit(c.id, "SYSTEM", `Asked the creator to connect a ${platform === "telegram" ? "Telegram" : "Discord"} bot`, str(a.why, 300));
      return "requested. The creator sees it on your company page; you'll be woken when it's connected.";
    }

    // ── packages (extensions, apps, templates) ──
    case "write_package_file": {
      const r = await writePackageFile(c, str(a.package, 60), str(a.path, 200), a.content === undefined ? undefined : str(a.content, 400_000), a.from_media_id ? str(a.from_media_id, 64) : undefined);
      return `saved ${r.path} in ${r.pkg.name}`;
    }
    case "publish_package": {
      const p = await publishPackage(c, str(a.package, 60), { title: str(a.title, 100), description: str(a.description, 1500), kind: str(a.kind, 20), visibility: str(a.visibility, 10) });
      return `published ${p.name} v${p.version} (${p.visibility}). ${p.visibility === "public" ? `Free download: ${downloadUrl(p)}` : `Sell it with create_offer { package: "${p.name}" }; buyers get it instantly.`}`;
    }
    case "list_packages": {
      const pk = await listPackages(c.id);
      if (!pk.length) return "no packages yet";
      const out: string[] = [];
      for (const p of pk) {
        const files = await packageFilesList(p.id);
        out.push(`${p.name} · ${p.kind} · ${p.visibility} · v${p.version} · ${p.downloads} downloads${p.version ? ` · ${downloadUrl(p, p.visibility !== "public")}` : ""}\n  files: ${files.map((f) => f.path).join(", ")}`);
      }
      return out.join("\n");
    }

    // ── print on demand ──
    case "merch_catalog": {
      const items = await searchCatalog(str(a.search, 100));
      return items.length ? items.map((p) => `${p.id} · ${p.title}${p.variant_count ? ` (${p.variant_count} variants)` : ""}`).join("\n") : "no matches, try another word";
    }
    case "merch_product": {
      const p = await getProduct(Number(a.product_id));
      const v = p.variants.filter((x) => x.in_stock !== false).slice(0, 60);
      return [`${p.product.title}`, `placements: ${(p.product.files ?? []).map((f) => f.type).filter((t) => !["preview", "mockup"].includes(t)).join(", ") || "default"}`,
        ...v.map((x) => `${x.id} · ${[x.size, x.color].filter(Boolean).join(" / ") || x.name} · $${x.price}`)].join("\n");
    }
    case "create_merch_offer": {
      const r = await createMerchOffer(c, {
        title: str(a.title, 100), description: str(a.description, 1000), productId: Number(a.product_id),
        variantIds: Array.isArray(a.variant_ids) ? (a.variant_ids as unknown[]).map(Number) : [], designMediaId: str(a.design_media_id, 64),
        placement: a.placement ? str(a.placement, 30) : undefined, priceSol: Number(a.price_sol),
      });
      return `merch offer ${r.offer.id} live: ${r.meta.productTitle}, ${r.meta.variants.length} variants, cost up to $${r.maxCostUsd.toFixed(2)} each incl. shipping. Customers buy at ${env.appUrl}/c/${c.slug}#offers`;
    }

    // ── commerce ──
    case "create_offer": {
      const price = Number(a.price_sol);
      if (!(price >= OFFER_BOUNDS.minSol && price <= OFFER_BOUNDS.maxSol)) throw new Error(`price must be ${OFFER_BOUNDS.minSol}–${OFFER_BOUNDS.maxSol} SOL`);
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(S.offers).where(and(eq(S.offers.companyId, c.id), eq(S.offers.active, true)));
      if (count >= OFFER_BOUNDS.maxActive) throw new Error("too many active offers");
      let kind = "service", meta: string | null = null;
      if (a.package) {
        const pkg = (await listPackages(c.id)).find((p) => p.name === packageName(a.package));
        if (!pkg || pkg.version === 0) throw new Error("publish the package first (publish_package)");
        kind = "download"; meta = JSON.stringify({ packageId: pkg.id });
      }
      const [o] = await db.insert(S.offers).values({ companyId: c.id, title: str(a.title, 100), description: str(a.description, 1000), priceLamports: lamports(price), kind, meta }).returning({ id: S.offers.id });
      await emit(c.id, "ACTION", `New offer: ${str(a.title, 100)} — ${price} SOL`, str(a.description, 300));
      return `created offer ${o.id}. Buyers can purchase at ${env.appUrl}/c/${c.slug}#offers`;
    }
    case "update_offer": {
      const o = await db.query.offers.findFirst({ where: and(eq(S.offers.id, str(a.offer_id)), eq(S.offers.companyId, c.id)) });
      if (!o) throw new Error("unknown offer");
      const patch: Partial<typeof S.offers.$inferInsert> = {};
      if (a.price_sol !== undefined) {
        const p = Number(a.price_sol);
        if (!(p >= OFFER_BOUNDS.minSol && p <= OFFER_BOUNDS.maxSol)) throw new Error("price out of bounds");
        patch.priceLamports = lamports(p);
      }
      if (typeof a.active === "boolean") patch.active = a.active;
      await db.update(S.offers).set(patch).where(eq(S.offers.id, o.id));
      return "updated";
    }
    case "deliver_order": {
      const o = await db.query.orders.findFirst({ where: and(eq(S.orders.id, str(a.order_id)), eq(S.orders.companyId, c.id)) });
      if (!o) throw new Error("unknown order");
      if (o.status !== "PAID") throw new Error(`order is ${o.status}`);
      const format = a.format === "html" ? "html" : "markdown";
      await db.update(S.orders).set({ status: "DELIVERED", deliverable: str(a.content, 400_000), format, deliveredAt: new Date() }).where(eq(S.orders.id, o.id));
      await emit(c.id, "DELIVERY", `Delivered an order`, `Order ${o.id.slice(-6)} for ${o.buyerWallet.slice(0, 4)}…${o.buyerWallet.slice(-4)}`);
      return "delivered";
    }

    // ── money ──
    case "check_treasury": {
      const [bal, spent, rows] = await Promise.all([
        treasuryBalance(c), spentLast24h(c.id),
        db.select().from(S.ledger).where(eq(S.ledger.companyId, c.id)).orderBy(desc(S.ledger.createdAt)).limit(15),
      ]);
      return [
        `balance: ${fmtSol(bal, 5)} (0.01 SOL is reserved for rent/fees)`,
        `lifetime creator fees: ${fmtSol(c.lifetimeFees, 4)} · revenue: ${fmtSol(c.lifetimeRevenue, 4)} · compute: ${fmtSol(c.lifetimeCompute, 4)} · spent: ${fmtSol(c.lifetimeSpent, 4)}`,
        `spent last 24h: ${fmtSol(spent, 4)}`,
        `token mint: ${c.mintPubkey} · treasury: ${c.treasuryPubkey}`,
        "recent ledger:", ...rows.map((r) => `- ${r.createdAt.toISOString()} ${r.kind} ${(r.lamports / 1e9).toFixed(5)} ${r.memo}`),
      ].join("\n");
    }
    case "buyback": {
      const r = await buybackAndBurn(c, lamports(Number(a.sol)), a.burn !== false);
      return `bought ${r.tokens} raw tokens${a.burn !== false ? " and burned them" : ""}. sig ${r.sig}`;
    }
    case "transfer_sol": {
      const to = str(a.to, 64);
      if (!isAddress(to)) throw new Error("invalid address");
      const sig = await transferSol(c, to, lamports(Number(a.sol)), str(a.reason, 300));
      return `sent. sig ${sig}`;
    }

    // ── comms & control ──
    case "post_update": await emit(c.id, "POST", str(a.title, 200), str(a.body, 4000)); return "posted";
    case "remember": {
      const mem: string[] = JSON.parse(c.memory || "[]");
      mem.push(str(a.note, 400));
      await db.update(S.companies).set({ memory: JSON.stringify(mem.slice(-50)) }).where(eq(S.companies.id, c.id));
      return "saved";
    }
    case "sleep": {
      const h = Math.min(48, Math.max(0.25, Number(a.hours) || 1));
      await db.update(S.companies).set({ sleepingUntil: new Date(Date.now() + h * 3600_000) }).where(eq(S.companies.id, c.id));
      ctx.done = true;
      ctx.summary = `Sleeping ${h}h — ${str(a.reason, 300)}`;
      return "sleeping";
    }
    case "end_shift": ctx.done = true; ctx.summary = str(a.summary, 2000); return "ok";
  }
  throw new Error(`unknown tool ${name}`);
}
