import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await db.query.steps.findFirst({ where: eq(schema.steps.id, params.id), columns: { image: true } });
  if (!s?.image) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(s.image), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
}
