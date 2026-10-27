// Bots the agent builds and runs: Telegram and Discord. The creator connects the account once
// (a bot token is a credential only a human can create); after that the agent writes and rewrites
// the bot's logic, which runs in a sandbox on every message.
import { randomBytes } from "crypto";
import { and, asc, count, desc, eq, like, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company, Connection } from "@/db/schema";
import { env } from "../env";
import { FEES } from "../fees";
import { usdToLamports } from "../price";
import { seal, open } from "../vault";
import { chargeCompute, getCompany, treasuryBalance } from "../treasury";
import { emit } from "../feed";
import { siteUrlFor } from "../sites";
import { runSandboxed, type HostFns } from "./sandbox";
import {
  discordConnect, discordFollowup, discordSetCommands, normalizeReply, telegramConnect, telegramDisconnect, telegramSend, telegramSetCommands,
  type Command, type Reply,
} from "./platforms";

export const PLATFORMS = ["telegram", "discord"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (p: unknown): p is Platform => PLATFORMS.includes(p as Platform);

export type BotMessage = {
  platform: Platform;
  text: string;
  command: string | null;
  args: string;
  user: { id: string; name: string; username?: string | null };
  chat: { id: string; type: string };
};

const S = schema;
const KV_MAX_KEYS = 5000;
const KV_MAX_VALUE = 8_000;

// ───────── connections ─────────
type TgSecrets = { token: string };
type DcSecrets = { botToken: string };

export async function getConnection(companyId: string, platform: Platform) {
  return db.query.connections.findFirst({ where: and(eq(S.connections.companyId, companyId), eq(S.connections.platform, platform)) });
}
const secretsOf = <T,>(c: Connection) => JSON.parse(Buffer.from(open(c.secretsEnc)).toString("utf8")) as T;
export const metaOf = (c: Connection) => JSON.parse(c.meta || "{}") as Record<string, string>;

export async function connect(c: Company, platform: Platform, input: Record<string, string>) {
  const secret = randomBytes(24).toString("hex");
  let meta: Record<string, string | number>, secrets: TgSecrets | DcSecrets;
  if (platform === "telegram") {
    const token = String(input.token || "").trim();
    meta = await telegramConnect(token, c.id, secret);
    secrets = { token };
  } else {
    const botToken = String(input.botToken || "").trim();
    meta = await discordConnect(String(input.appId || "").trim(), String(input.publicKey || "").trim(), botToken);
    secrets = { botToken };
  }
  const old = await getConnection(c.id, platform);
  if (old && platform === "telegram") {
    const prev = secretsOf<TgSecrets>(old).token;
    if (prev !== (secrets as TgSecrets).token) await telegramDisconnect(prev);
  }
  const values = { companyId: c.id, platform, secretsEnc: seal(Buffer.from(JSON.stringify(secrets))), meta: JSON.stringify(meta), webhookSecret: secret };
  await db.insert(S.connections).values(values).onConflictDoUpdate({ target: [S.connections.companyId, S.connections.platform], set: values });
  // push existing commands, clear the agent's request and wake it up to use the new account
  const bot = await db.query.bots.findFirst({ where: and(eq(S.bots.companyId, c.id), eq(S.bots.platform, platform)) });
  if (bot) await pushCommands(c.id, platform, JSON.parse(bot.commands)).catch(() => null);
  const reqs = (JSON.parse(c.connectRequests || "[]") as { platform: string }[]).filter((r) => r.platform !== platform);
  await db.update(S.companies).set({ connectRequests: JSON.stringify(reqs), wakeRequested: true }).where(eq(S.companies.id, c.id));
  const label = platform === "telegram" ? `@${meta.username}` : String(meta.name);
  await emit(c.id, "SYSTEM", `${platform === "telegram" ? "Telegram" : "Discord"} bot connected: ${label}`, "The creator connected the account. The agent now runs it.");
  return meta;
}

export async function disconnect(c: Company, platform: Platform) {
  const conn = await getConnection(c.id, platform);
  if (!conn) return;
  if (platform === "telegram") await telegramDisconnect(secretsOf<TgSecrets>(conn).token);
  await db.delete(S.connections).where(eq(S.connections.id, conn.id));
  await emit(c.id, "SYSTEM", `${platform} bot disconnected by the creator`, "");
}

export async function pushCommands(companyId: string, platform: Platform, cmds: Command[]) {
  const conn = await getConnection(companyId, platform);
  if (!conn) return false;
  if (platform === "telegram") await telegramSetCommands(secretsOf<TgSecrets>(conn).token, cmds);
  else await discordSetCommands(metaOf(conn).appId, secretsOf<DcSecrets>(conn).botToken, cmds);
  return true;
}

export function validCommands(raw: unknown): Command[] {
  if (!Array.isArray(raw)) throw new Error("commands must be a list of { name, description }");
  const out = raw.slice(0, 20).map((c) => {
    const name = String((c as Command).name || "").toLowerCase().replace(/^\//, "");
    if (!/^[a-z0-9_]{1,32}$/.test(name)) throw new Error(`bad command name "${name}" (a-z, 0-9, _ ; max 32)`);
    return { name, description: String((c as Command).description || name).slice(0, 100) };
  });
  return out;
}

// ───────── running the agent's code ─────────
const rate = new Map<string, { at: number; n: number }>();
function limited(companyId: string) {
  const now = Date.now();
  const r = rate.get(companyId);
  if (!r || now - r.at > 60_000) { rate.set(companyId, { at: now, n: 1 }); return false; }
  return ++r.n > Number(process.env.BOT_MAX_EVENTS_PER_MIN || 60);
}

async function headroom(c: Company) {
  return (await treasuryBalance(c)) - FEES.treasuryFloorLamports - FEES.minRunLamports;
}

async function botAi(c: Company, prompt: string, opts: { system?: string; maxTokens?: number }) {
  if (!env.openrouterKey) return `(AI is offline on this server) You said: ${prompt.slice(0, 200)}`;
  if ((await headroom(c)) <= 0) throw new Error("the company treasury is out of funds for AI replies");
  const model = process.env.BOT_AI_MODEL || "openai/gpt-4o-mini";
  const r = await fetch(`${process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openrouterKey}`, "Content-Type": "application/json", "HTTP-Referer": env.siteUrl, "X-Title": "Stonkware bots" },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(1200, Math.max(50, Number(opts.maxTokens) || 500)),
      usage: { include: true },
      messages: [
        { role: "system", content: `You are the assistant inside the ${c.name} ($${c.ticker}) bot. Be helpful and concise. Never give financial advice or promise returns. ${String(opts.system || "").slice(0, 2000)}` },
        { role: "user", content: prompt.slice(0, 8000) },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const j = (await r.json()) as { choices?: { message: { content: string } }[]; usage?: { cost?: number }; error?: { message: string } };
  if (!r.ok || !j.choices?.length) throw new Error(`ai: ${j.error?.message ?? r.status}`);
  const usd = j.usage?.cost ?? 0;
  if (usd > 0) await chargeCompute(c, await usdToLamports(usd), `bot ai reply $${usd.toFixed(5)}`);
  return j.choices[0].message.content ?? "";
}

function hostFor(c: Company): HostFns {
  const K = S.botKv;
  const key = (k: unknown) => {
    const s = String(k ?? "");
    if (!s || s.length > 120) throw new Error("kv keys must be 1–120 chars");
    return s;
  };
  return {
    ai: async ([prompt, opts]) => botAi(c, String(prompt), (opts ?? {}) as { system?: string; maxTokens?: number }),
    "kv.get": async ([k]) => {
      const row = await db.query.botKv.findFirst({ where: and(eq(K.companyId, c.id), eq(K.key, key(k))) });
      return row ? JSON.parse(row.value) : null;
    },
    "kv.set": async ([k, v]) => {
      const value = JSON.stringify(v ?? null);
      if (value.length > KV_MAX_VALUE) throw new Error(`kv values max ${KV_MAX_VALUE} chars`);
      const [{ n }] = await db.select({ n: count() }).from(K).where(eq(K.companyId, c.id));
      const exists = await db.query.botKv.findFirst({ where: and(eq(K.companyId, c.id), eq(K.key, key(k))), columns: { key: true } });
      if (!exists && n >= KV_MAX_KEYS) throw new Error(`kv is full (${KV_MAX_KEYS} keys)`);
      await db.insert(K).values({ companyId: c.id, key: key(k), value }).onConflictDoUpdate({ target: [K.companyId, K.key], set: { value, updatedAt: new Date() } });
      return true;
    },
    "kv.del": async ([k]) => { await db.delete(K).where(and(eq(K.companyId, c.id), eq(K.key, key(k)))); return true; },
    "kv.incr": async ([k, n]) => {
      const row = await db.query.botKv.findFirst({ where: and(eq(K.companyId, c.id), eq(K.key, key(k))) });
      const next = (Number(row ? JSON.parse(row.value) : 0) || 0) + (Number(n) || 1);
      await db.insert(K).values({ companyId: c.id, key: key(k), value: JSON.stringify(next) }).onConflictDoUpdate({ target: [K.companyId, K.key], set: { value: JSON.stringify(next), updatedAt: new Date() } });
      return next;
    },
    "kv.list": async ([prefix]) => {
      const rows = await db.select({ key: K.key }).from(K).where(and(eq(K.companyId, c.id), like(K.key, `${String(prefix ?? "").replace(/[%_]/g, "")}%`))).orderBy(asc(K.key)).limit(200);
      return rows.map((r) => r.key);
    },
  };
}

const companyGlobals = (c: Company) => ({
  company: { name: c.name, ticker: c.ticker, tagline: c.tagline, website: siteUrlFor(c.slug), storefront: `${env.appUrl}/c/${c.slug}#offers`, page: `${env.appUrl}/c/${c.slug}` },
});

export async function runBot(c: Company, code: string, msg: BotMessage) {
  return runSandboxed(code, "onMessage", msg, hostFor(c), { ms: 25_000, globals: companyGlobals(c) });
}

/** Compile-check bot code without calling it (no AI cost). */
export async function checkBotCode(c: Company, code: string) {
  const r = await runSandboxed(`${code}\n;function __check(){ return typeof onMessage }`, "__check", null, {}, { ms: 2000, globals: companyGlobals(c) });
  if (!r.ok) throw new Error(r.error);
  if (r.value !== "function") throw new Error("define a function named onMessage(msg) that returns the reply");
}

async function record(c: Company, platform: Platform, input: string, output: string | null, error: string | null, ms: number) {
  await db.insert(S.botEvents).values({ companyId: c.id, platform, input: input.slice(0, 1000), output: output?.slice(0, 1500) ?? null, error: error?.slice(0, 500) ?? null, ms });
  await db.update(S.bots).set(error ? { handled: sql`${S.bots.handled} + 1`, errors: sql`${S.bots.errors} + 1` } : { handled: sql`${S.bots.handled} + 1` })
    .where(and(eq(S.bots.companyId, c.id), eq(S.bots.platform, platform)));
  if (Math.random() < 0.05) {
    // keep the most recent ~300 events per company
    const cut = await db.select({ at: S.botEvents.createdAt }).from(S.botEvents).where(eq(S.botEvents.companyId, c.id)).orderBy(desc(S.botEvents.createdAt)).limit(1).offset(300);
    if (cut[0]) await db.delete(S.botEvents).where(and(eq(S.botEvents.companyId, c.id), lt(S.botEvents.createdAt, cut[0].at)));
  }
}

/** Handle one incoming message: run the company's bot and return its reply (or null). */
export async function handleMessage(companyId: string, msg: BotMessage): Promise<Reply | null> {
  const c = await getCompany(companyId);
  if (c.status !== "LIVE") return null;
  const bot = await db.query.bots.findFirst({ where: and(eq(S.bots.companyId, c.id), eq(S.bots.platform, msg.platform)) });
  if (!bot || !bot.enabled) return msg.command === "start" || msg.command ? { text: `${c.name} is still building this bot. Check back soon.`, buttons: [{ text: `$${c.ticker} on Stonkware`, url: `${env.appUrl}/c/${c.slug}` }] } : null;
  if (limited(c.id)) return null;
  const t = Date.now();
  const r = await runBot(c, bot.code, msg);
  const input = msg.command ? `/${msg.command} ${msg.args}`.trim() : msg.text;
  if (!r.ok) {
    await record(c, msg.platform, input, null, r.error, Date.now() - t);
    return { text: "Sorry, something went wrong. The team has been notified.", buttons: [] };
  }
  const reply = normalizeReply(r.value);
  await record(c, msg.platform, input, reply?.text ?? null, null, Date.now() - t);
  return reply;
}

// ───────── webhook processors (called by the API routes, run in the background) ─────────
export async function processTelegramUpdate(conn: Connection, update: Record<string, unknown>) {
  const m = (update.message ?? (update.callback_query as { message?: unknown } | undefined)?.message) as
    | { message_id: number; text?: string; chat: { id: number; type: string }; from?: { id: number; first_name?: string; username?: string } }
    | undefined;
  const cbData = (update.callback_query as { data?: string; from?: { id: number; first_name?: string; username?: string } } | undefined);
  const text = cbData?.data ?? m?.text;
  if (!m || !text) return;
  const meta = metaOf(conn);
  const cmd = /^\/([a-z0-9_]+)(?:@(\w+))?\s*([\s\S]*)$/i.exec(text);
  if (cmd?.[2] && meta.username && cmd[2].toLowerCase() !== meta.username.toLowerCase()) return; // command for another bot
  // in groups, only answer commands and mentions
  if (m.chat.type !== "private" && !cmd && !(meta.username && text.includes(`@${meta.username}`))) return;
  const from = cbData?.from ?? m.from;
  const msg: BotMessage = {
    platform: "telegram", text, command: cmd ? cmd[1].toLowerCase() : null, args: cmd ? cmd[3].trim() : text,
    user: { id: String(from?.id ?? ""), name: from?.first_name ?? "", username: from?.username ?? null }, chat: { id: String(m.chat.id), type: m.chat.type },
  };
  const reply = await handleMessage(conn.companyId, msg);
  if (reply) await telegramSend(secretsOf<TgSecrets>(conn).token, m.chat.id, reply, update.message ? m.message_id : undefined);
}

export async function processDiscordCommand(conn: Connection, i: { token: string; data?: { name?: string; options?: { name: string; value: unknown }[] }; member?: { user?: { id: string; username?: string; global_name?: string } }; user?: { id: string; username?: string; global_name?: string }; channel_id?: string; guild_id?: string }) {
  const u = i.member?.user ?? i.user;
  const args = (i.data?.options ?? []).map((o) => String(o.value)).join(" ").trim();
  const msg: BotMessage = {
    platform: "discord", text: args, command: (i.data?.name ?? "").toLowerCase(), args,
    user: { id: u?.id ?? "", name: u?.global_name ?? u?.username ?? "", username: u?.username ?? null }, chat: { id: i.channel_id ?? "", type: i.guild_id ? "guild" : "dm" },
  };
  const reply = (await handleMessage(conn.companyId, msg)) ?? { text: "✓", buttons: [] };
  await discordFollowup(metaOf(conn).appId, i.token, reply);
}

// ───────── for the agent ─────────
export async function botStatus(companyId: string) {
  const [bots, conns] = await Promise.all([
    db.select().from(S.bots).where(eq(S.bots.companyId, companyId)),
    db.select().from(S.connections).where(eq(S.connections.companyId, companyId)),
  ]);
  return PLATFORMS.map((p) => {
    const b = bots.find((x) => x.platform === p);
    const cn = conns.find((x) => x.platform === p);
    const meta = cn ? metaOf(cn) : null;
    return {
      platform: p,
      connected: !!cn,
      account: meta ? (p === "telegram" ? `@${meta.username}` : meta.name) : null,
      link: meta ? (p === "telegram" ? `https://t.me/${meta.username}` : meta.invite) : null,
      code: !!b,
      enabled: b?.enabled ?? false,
      commands: b ? (JSON.parse(b.commands) as Command[]).map((c) => c.name) : [],
      handled: b?.handled ?? 0,
      errors: b?.errors ?? 0,
    };
  });
}
