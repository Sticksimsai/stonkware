import { listCompanies } from "@/lib/queries";
import { handle, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live companies, ranked by creator fees + revenue. */
export const GET = handle(async () => {
  const rows = await listCompanies();
  return ok(rows.map((r) => ({ ...r, hasImage: !!r.hasImage, working: !!r.working })));
});
