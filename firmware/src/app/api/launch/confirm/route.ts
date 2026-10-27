// Step 2 of launch: verify the deposit, create the Meteora DBC pool with the treasury as creator,
// then wake the agent for its first shift.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handle, ok, fail } from "@/lib/http";
import { getCompany, launch, verifyDeposit } from "@/lib/treasury";
import { emit, record } from "@/lib/feed";
import { isLive } from "@/lib/env";
import { mockSig } from "@/lib/signer";
import { startShiftNow } from "@/lib/tick";
import { retryLaunch } from "@/lib/recovery";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ id: z.string(), signature: z.string().min(4) });

export const POST = handle(async (req: Request) => {
  const { id, signature } = Body.parse(await req.json());
  const c = await getCompany(id);
  if (c.status === "LIVE") return ok({ slug: c.slug, status: c.status });
  if (c.status === "FAILED" && c.fundingSig) {
    const l = await retryLaunch(c.id);
    return ok({ slug: l.slug, status: l.status });
  }
  if (c.status !== "PENDING_FUNDING") return fail(409, `company is ${c.status}`);

  const sig = isLive() ? signature : mockSig();
  const received = await verifyDeposit(sig, c.creatorWallet, c.treasuryPubkey, c.requiredLamports);
  const moved = await db.update(schema.companies).set({ status: "LAUNCHING", fundingSig: sig })
    .where(and(eq(schema.companies.id, c.id), eq(schema.companies.status, "PENDING_FUNDING"))).returning({ id: schema.companies.id });
  if (!moved.length) return fail(409, "already confirming");

  await record(c.id, "FUNDING", received, "creator deposit", sig);
  await emit(c.id, "TREASURY", "Treasury funded", `Creator deposited ${(received / 1e9).toFixed(4)} SOL.`, sig);
  const l = await launch(c.id);
  startShiftNow(l.id); // first shift starts immediately
  return ok({ slug: l.slug, status: l.status, launchSig: l.launchSig });
});
