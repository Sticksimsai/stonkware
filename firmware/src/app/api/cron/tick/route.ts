// Heartbeat: claim fees + start due agent shifts.
// Shifts are long-running; run this app (or `npm run worker`) on a persistent server, not serverless.
import { env } from "@/lib/env";
import { fail, handle, ok } from "@/lib/http";
import { claimDue, startDueShifts } from "@/lib/tick";
import { pollMedia } from "@/lib/media";
import { pollMerch } from "@/lib/merch";
import { pollDev } from "@/lib/selfdev";
import { settleVanity } from "@/lib/vanity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail(401, "unauthorized");
  const claimed = await claimDue();
  const started = await startDueShifts();
  await pollMedia();
  await pollMerch();
  await pollDev();
  await settleVanity();
  return ok({ at: new Date().toISOString(), claimed, started });
}
export const GET = handle(run);
export const POST = handle(run);
