// Mock mode only: simulate fee income and start a shift right now from the UI.
import { isLive } from "@/lib/env";
import { fail, handle, ok } from "@/lib/http";
import { claimCreatorFees, getCompany } from "@/lib/treasury";
import { startShiftNow } from "@/lib/tick";

export const runtime = "nodejs";

export const POST = handle(async (_req: Request, { params }: { params: { id: string } }) => {
  if (isLive()) return fail(404, "not found");
  const claimed = await claimCreatorFees(await getCompany(params.id));
  const started = startShiftNow(params.id);
  return ok({ claimed, started });
});
