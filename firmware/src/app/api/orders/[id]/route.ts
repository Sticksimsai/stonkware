import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handle, ok, fail } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: { params: { id: string } }) => {
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, params.id) });
  if (!o) return fail(404, "not found");
  const f = o.fulfillment ? (JSON.parse(o.fulfillment) as { status: string; tracking?: unknown[]; draft?: boolean }) : null;
  return ok({
    id: o.id, status: o.status, format: o.format, deliverable: o.deliverable, deliveredAt: o.deliveredAt,
    kind: o.shippingEnc ? "merch" : "service",
    fulfillment: f ? { status: f.status, tracking: f.tracking ?? [], draft: !!f.draft } : null,
  });
});
