// Scheduler: claims fees and decides which agents work next.
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env, isLive } from "./env";
import { claimCreatorFees, settleCompute, getCompany } from "./treasury";
import { runShift } from "./agent/run";

const S = schema;
const CLAIM_EVERY_MS = isLive() ? env.claimEveryMin * 60_000 : 5 * 60_000;
const inFlight = new Set<string>();

export async function claimDue() {
  const due = await db.select({ id: S.companies.id }).from(S.companies).where(and(
    eq(S.companies.status, "LIVE"),
    or(isNull(S.companies.lastClaimAt), lt(S.companies.lastClaimAt, new Date(Date.now() - CLAIM_EVERY_MS))),
  )).limit(25);
  for (const { id } of due) {
    try {
      const c = await getCompany(id);
      await claimCreatorFees(c);
      await settleCompute(await getCompany(id));
    } catch (e) { console.error("[claim]", id, (e as Error).message); }
  }
  return due.length;
}

/** Companies whose agent should work now: woken by an event, or due and not sleeping. */
export async function dueAgents(limit: number) {
  const now = new Date();
  return db.select({ id: S.companies.id }).from(S.companies).where(and(
    eq(S.companies.status, "LIVE"),
    or(
      eq(S.companies.wakeRequested, true),
      and(
        or(isNull(S.companies.sleepingUntil), lt(S.companies.sleepingUntil, now)),
        // paced by compute budget (lib/pace.ts); companies that never ran fall back to the fixed interval
        or(
          lt(S.companies.nextShiftAt, now),
          and(isNull(S.companies.nextShiftAt), or(isNull(S.companies.lastRunAt), lt(S.companies.lastRunAt, new Date(Date.now() - env.shiftEveryMin * 60_000)))),
        ),
      ),
    ),
  )).orderBy(sql`${S.companies.wakeRequested} desc`, asc(S.companies.lastRunAt)).limit(limit);
}

/** Start shifts in the background (long-running process: worker or `next start`). */
export async function startDueShifts(): Promise<string[]> {
  const free = env.maxConcurrentShifts - inFlight.size;
  if (free <= 0) return [];
  const due = (await dueAgents(free + inFlight.size)).filter((d) => !inFlight.has(d.id)).slice(0, free);
  for (const { id } of due) {
    inFlight.add(id);
    void runShift(id).catch((e) => console.error("[shift]", id, e)).finally(() => inFlight.delete(id));
  }
  return due.map((d) => d.id);
}

export function startShiftNow(id: string) {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  void runShift(id).catch((e) => console.error("[shift]", id, e)).finally(() => inFlight.delete(id));
  return true;
}
