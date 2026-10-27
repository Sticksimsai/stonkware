// Telegram webhook: one per company bot. Verified with the secret token we set on setWebhook.
import { timingSafeEqual } from "crypto";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { processTelegramUpdate } from "@/lib/bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  const conn = await db.query.connections.findFirst({ where: and(eq(schema.connections.companyId, params.companyId), eq(schema.connections.platform, "telegram")) });
  if (!conn || !same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", conn.webhookSecret)) return new Response("forbidden", { status: 403 });
  const update = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  // answer Telegram right away; the bot runs in the background (long-running server)
  if (update) void processTelegramUpdate(conn, update).catch((e) => console.error("[telegram]", params.companyId, (e as Error).message));
  return Response.json({ ok: true });
}
