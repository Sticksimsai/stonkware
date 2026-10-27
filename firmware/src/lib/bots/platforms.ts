// Thin Telegram Bot API + Discord HTTP-interactions clients. Neither needs a long-running process:
// Telegram pushes updates to our webhook; Discord posts slash-command interactions to our endpoint.
import nacl from "tweetnacl";
import { env } from "../env";

export type Reply = { text: string; buttons: { text: string; url: string }[] };
export type Command = { name: string; description: string };

/** Normalise whatever the agent's bot returned into text + link buttons. */
export function normalizeReply(v: unknown): Reply | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" || typeof v === "number") return { text: String(v).slice(0, 3900), buttons: [] };
  if (typeof v === "object") {
    const o = v as { text?: unknown; buttons?: unknown };
    const buttons = Array.isArray(o.buttons)
      ? o.buttons
          .filter((b): b is { text: string; url: string } => !!b && typeof (b as { url?: unknown }).url === "string" && /^https?:\/\//.test((b as { url: string }).url))
          .slice(0, 5)
          .map((b) => ({ text: String(b.text || "Open").slice(0, 60), url: b.url.slice(0, 500) }))
      : [];
    const text = String(o.text ?? "").slice(0, 3900);
    return text || buttons.length ? { text: text || "↓", buttons } : null;
  }
  return null;
}

// ───────── Telegram ─────────
const TG = () => (process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/+$/, "");

export async function tg<T = unknown>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${TG()}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description ?? r.status}`);
  return j.result as T;
}

export async function telegramConnect(token: string, companyId: string, secret: string) {
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error("that doesn't look like a Telegram bot token (get one from @BotFather)");
  const me = await tg<{ id: number; username: string; first_name: string }>(token, "getMe");
  await tg(token, "setWebhook", { url: `${env.siteUrl}/api/hooks/telegram/${companyId}`, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  return { username: me.username, name: me.first_name, id: me.id };
}

export const telegramDisconnect = (token: string) => tg(token, "deleteWebhook", { drop_pending_updates: true }).catch(() => null);

export const telegramSetCommands = (token: string, cmds: Command[]) =>
  tg(token, "setMyCommands", { commands: cmds.map((c) => ({ command: c.name, description: c.description.slice(0, 256) })) });

export async function telegramSend(token: string, chatId: number | string, reply: Reply, replyTo?: number) {
  await tg(token, "sendMessage", {
    chat_id: chatId,
    text: reply.text,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(reply.buttons.length ? { reply_markup: { inline_keyboard: reply.buttons.map((b) => [{ text: b.text, url: b.url }]) } } : {}),
    link_preview_options: { is_disabled: false },
  });
}

// ───────── Discord ─────────
const DC = () => (process.env.DISCORD_API_URL || "https://discord.com/api/v10").replace(/\/+$/, "");

async function dc<T = unknown>(path: string, init: RequestInit & { bot?: string } = {}): Promise<T> {
  const { bot, ...rest } = init;
  const r = await fetch(`${DC()}${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(bot ? { Authorization: `Bot ${bot}` } : {}), ...(rest.headers as Record<string, string>) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`discord ${r.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export function discordVerify(publicKey: string, signature: string, timestamp: string, body: string) {
  try {
    return nacl.sign.detached.verify(Buffer.from(timestamp + body), Buffer.from(signature, "hex"), Buffer.from(publicKey, "hex"));
  } catch {
    return false;
  }
}

export async function discordConnect(appId: string, publicKey: string, botToken: string) {
  if (!/^\d{15,22}$/.test(appId)) throw new Error("Application ID should be a long number (Discord Developer Portal → General Information)");
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) throw new Error("Public Key should be 64 hex characters (General Information)");
  const app = await dc<{ id: string; name: string }>("/applications/@me", { bot: botToken });
  if (app.id !== appId) throw new Error("the bot token belongs to a different application");
  return { appId, publicKey: publicKey.toLowerCase(), name: app.name, invite: `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=2048` };
}

export const discordSetCommands = (appId: string, botToken: string, cmds: Command[]) =>
  dc(`/applications/${appId}/commands`, {
    method: "PUT",
    bot: botToken,
    body: JSON.stringify(cmds.map((c) => ({ name: c.name, description: c.description.slice(0, 100), type: 1, options: [{ type: 3, name: "input", description: "what you want", required: false }] }))),
  });

export async function discordFollowup(appId: string, interactionToken: string, reply: Reply) {
  await dc(`/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    body: JSON.stringify({
      content: reply.text.slice(0, 2000),
      components: reply.buttons.length ? [{ type: 1, components: reply.buttons.map((b) => ({ type: 2, style: 5, label: b.text.slice(0, 80), url: b.url })) }] : [],
      allowed_mentions: { parse: [] },
    }),
  });
}
