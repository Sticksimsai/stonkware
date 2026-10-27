import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.id, params.id), columns: { image: true, imageMime: true } });
  if (!c?.image) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(c.image), {
    headers: { "Content-Type": c.imageMime ?? "image/png", "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
