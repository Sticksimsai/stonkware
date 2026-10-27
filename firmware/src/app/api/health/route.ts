import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.run(sql`select 1`);
    return Response.json({ ok: true, mode: env.mode, time: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message.slice(0, 200) }, { status: 503 });
  }
}
