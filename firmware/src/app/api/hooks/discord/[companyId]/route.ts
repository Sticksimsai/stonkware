// Discord interactions endpoint (slash commands), one per company app. Signature-verified (Ed25519).
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { metaOf, processDiscordCommand } from "@/lib/bots";
import { discordVerify } from "@/lib/bots/platforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  const conn = await db.query.connections.findFirst({ where: and(eq(schema.connections.companyId, params.companyId), eq(schema.connections.platform, "discord")) });
  const body = await req.text();
  const sig = req.headers.get("x-signature-ed25519") ?? "";
  const ts = req.headers.get("x-signature-timestamp") ?? "";
  if (!conn || !discordVerify(metaOf(conn).publicKey, sig, ts, body)) return new Response("invalid request signature", { status: 401 });
  const i = JSON.parse(body) as { type: number; token: string; data?: { name?: string; options?: { name: string; value: unknown }[] } };
  if (i.type === 1) return Response.json({ type: 1 }); // PING
  if (i.type === 2) {
    // defer ("thinking…"), then edit the reply once the bot has answered
    void processDiscordCommand(conn, i).catch((e) => console.error("[discord]", params.companyId, (e as Error).message));
    return Response.json({ type: 5 });
  }
  return Response.json({ type: 4, data: { content: "Unsupported interaction.", flags: 64 } });
}
