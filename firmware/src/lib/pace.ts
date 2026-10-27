// Shift pacing: how soon an agent works again, in line with what it can afford.
//   budget per hour = recent income per hour (24h) + a slice of the spendable balance (spread over RUNWAY hours)
//   gap            = typical shift cost ÷ budget per hour, clamped to [MIN, MAX] minutes
// Well-funded agents work every few minutes; as earnings slow, the gaps grow by themselves.
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { FEES } from "./fees";
import { treasuryBalance } from "./treasury";

const num = (k: string, d: number) => { const v = Number(process.env[k]); return process.env[k] && Number.isFinite(v) ? v : d; };
export const paceConfig = () => ({
  minGapMin: num("AGENT_MIN_GAP_MIN", 3),
  maxGapMin: num("AGENT_MAX_GAP_MIN", 360),
  runwayHours: num("AGENT_RUNWAY_HOURS", 24),
  defaultShiftLamports: num("AGENT_EST_SHIFT_LAMPORTS", 2_000_000), // 0.002 SOL until real costs are known
});

export async function computePace(c: Company) {
  const cfg = paceConfig();
  const [balance, [inc], recent] = await Promise.all([
    treasuryBalance(c),
    db.select({ s: sql<number>`coalesce(sum(${schema.ledger.lamports}), 0)` }).from(schema.ledger).where(and(
      eq(schema.ledger.companyId, c.id),
      inArray(schema.ledger.kind, ["FEE_CLAIM", "REVENUE", "PLATFORM_SHARE"]),
      gt(schema.ledger.createdAt, new Date(Date.now() - 24 * 3600_000)),
    )),
    db.select({ cost: schema.runs.costLamports }).from(schema.runs)
      .where(and(eq(schema.runs.companyId, c.id), gt(schema.runs.costLamports, 0))).orderBy(desc(schema.runs.startedAt)).limit(5),
  ]);
  const incomePerHour = Math.max(0, Number(inc.s)) / 24;
  const spendable = Math.max(0, balance - FEES.treasuryFloorLamports - FEES.minRunLamports);
  const budgetPerHour = incomePerHour + spendable / cfg.runwayHours;
  const shiftCost = recent.length ? recent.reduce((s, r) => s + r.cost, 0) / recent.length : cfg.defaultShiftLamports;
  const raw = budgetPerHour > 0 ? (shiftCost / budgetPerHour) * 60 : Infinity;
  const gapMin = Math.round(Math.min(cfg.maxGapMin, Math.max(cfg.minGapMin, raw)));
  return { gapMin, incomePerHour, budgetPerHour, shiftCost, balance };
}

/** Called when a shift ends: schedule the next one (an agent's own sleep() still wins). */
export async function scheduleNext(companyId: string) {
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.id, companyId) });
  if (!c) return null;
  const p = await computePace(c);
  await db.update(schema.companies).set({ nextShiftAt: new Date(Date.now() + p.gapMin * 60_000) }).where(eq(schema.companies.id, c.id));
  return p;
}
