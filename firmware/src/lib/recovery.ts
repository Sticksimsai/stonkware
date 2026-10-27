// Launch recovery: no creator should ever lose a deposit because a launch failed.
//  · deposit landed but the confirm request never finished → launch it anyway
//  · launch transaction failed/expired → retry (up to MAX_ATTEMPTS, a few minutes apart)
//  · still failing → refund the whole treasury to the creator's wallet
// Runs from the scheduler; admins can also do it by hand with `npm run launches`.
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { isLive } from "./env";
import { connection } from "./solana";
import { getCompany, launch, treasuryBalance } from "./treasury";
import { poolInfo } from "./meteora";
import { isStonkfun, payDevBuy, stonkPool } from "./venue";
import { priorityMicroLamports, transferFeeLamports, transferFromTreasury } from "./signer";
import { emit, record } from "./feed";
import { startShiftNow } from "./tick";

const C = schema.companies;
const MAX_ATTEMPTS = Number(process.env.LAUNCH_MAX_ATTEMPTS || 3);
const RETRY_GAP_MS = 3 * 60_000;
const attempts = new Map<string, { n: number; at: number }>();
const busy = new Set<string>();

export type Stuck = { c: Company; balance: number; reason: string };

/** Companies whose creator paid but which aren't live: FAILED, stuck LAUNCHING, or funded-but-PENDING. */
export async function stuckLaunches(): Promise<Stuck[]> {
  const rows = await db.select().from(C).where(and(
    inArray(C.status, ["FAILED", "LAUNCHING", "PENDING_FUNDING"]),
    eq(C.source, "launchpad"),
    gt(C.createdAt, new Date(Date.now() - 14 * 86400_000)),
  ));
  const out: Stuck[] = [];
  for (const c of rows) {
    const age = Date.now() - (c.createdAt?.getTime() ?? 0);
    if (c.status === "LAUNCHING" && age < 30 * 60_000) continue; // probably still in progress
    if (c.status === "PENDING_FUNDING" && age < 10 * 60_000) continue; // creator may still be confirming
    const balance = await treasuryBalance(c).catch(() => -1);
    if (c.status === "PENDING_FUNDING" && balance < c.requiredLamports) continue; // never paid (or not fully)
    if (balance <= 0 && c.status !== "PENDING_FUNDING") continue; // nothing left to refund or launch with
    out.push({ c, balance, reason: c.status === "PENDING_FUNDING" ? "paid, confirm never finished" : c.status === "LAUNCHING" ? "stuck launching" : `failed: ${c.launchError ?? "?"}` });
  }
  return out;
}

/** The coin's pool address if it exists on-chain (either venue). */
async function poolOnChain(c: Company): Promise<string | null> {
  if (isStonkfun(c)) return (await stonkPool(c))?.pool.toBase58() ?? null;
  return (await poolInfo(connection(), c.mintPubkey).catch(() => null))?.pool.toBase58() ?? null;
}

/** Scheduler: StonkFun launches whose dev-buy tokens haven't reached the creator yet (one per beat). */
export async function payPendingDevBuys() {
  if (!isLive()) return;
  const rows = await db.select().from(C).where(and(eq(C.status, "LIVE"), gt(C.devBuySol, 0), gt(C.createdAt, new Date(Date.now() - 7 * 86400_000))));
  for (const c of rows) {
    if (!isStonkfun(c)) continue;
    try { if (await payDevBuy(c)) return; } catch (e) { console.error(`[devbuy] $${c.ticker}:`, (e as Error).message.slice(0, 200)); return; }
  }
}

/** Retry a launch. If the pool already exists on-chain (the tx landed after all), just mark it LIVE. */
export async function retryLaunch(id: string): Promise<Company> {
  if (busy.has(id)) throw new Error("already being retried");
  busy.add(id);
  try {
    const c = await getCompany(id);
    if (c.status === "LIVE") return c;
    if (isLive()) {
      const p = await poolOnChain(c);
      if (p) {
        await db.update(C).set({ status: "LIVE", poolAddress: p, mintSecretEnc: null, launchError: null, wakeRequested: true }).where(eq(C.id, c.id));
        await emit(c.id, "SYSTEM", `$${c.ticker} is live`, "The launch transaction landed after all. The agent now has full control.");
        return getCompany(c.id);
      }
    }
    // only take it over if nobody else moved it meanwhile (e.g. the creator's own confirm request)
    const moved = await db.update(C).set({ status: "LAUNCHING", fundingSig: c.fundingSig ?? `recovered:${c.id}` })
      .where(and(eq(C.id, c.id), eq(C.status, c.status))).returning({ id: C.id });
    if (!moved.length) throw new Error("status changed meanwhile; skipped");
    const l = await launch(c.id);
    startShiftNow(l.id);
    return l;
  } finally {
    busy.delete(id);
  }
}

/** Send everything in the treasury back to the creator and take the company off the site. */
export async function refundLaunch(id: string, why = "launch failed"): Promise<{ sig: string; lamports: number }> {
  if (busy.has(id)) throw new Error("busy");
  busy.add(id);
  try {
    const c = await getCompany(id);
    if (c.status === "LIVE") throw new Error(`$${c.ticker} is live; it can't be refunded`);
    if (isLive() && (await poolOnChain(c))) throw new Error(`$${c.ticker} has a pool on-chain; run retry instead (it will mark it live)`);
    const balance = await treasuryBalance(c);
    const micro = await priorityMicroLamports();
    const amount = balance - transferFeeLamports(micro);
    if (amount <= 0) throw new Error(`treasury is empty (${balance} lamports)`);
    const sig = await transferFromTreasury(c.treasurySecretEnc, c.treasuryPubkey, c.creatorWallet, amount, { microLamports: micro });
    await record(c.id, "REFUND", -amount, `refund to creator: ${why}`, sig);
    await db.update(C).set({ status: "ARCHIVED", launchError: `refunded ${(amount / 1e9).toFixed(4)} SOL: ${why}`.slice(0, 500), wakeRequested: false }).where(eq(C.id, c.id));
    await emit(c.id, "SYSTEM", "Launch refunded", `${(amount / 1e9).toFixed(4)} SOL returned to the creator (${why}).`, sig);
    return { sig, lamports: amount };
  } finally {
    busy.delete(id);
  }
}

/** Scheduler: retry, then refund. One company per beat so a bad RPC can't cascade. */
export async function recoverLaunches() {
  if (!isLive() || process.env.LAUNCH_RECOVERY === "0") return;
  const stuck = await stuckLaunches();
  for (const { c } of stuck) {
    const a = attempts.get(c.id) ?? { n: 0, at: 0 };
    if (Date.now() - a.at < RETRY_GAP_MS) continue;
    attempts.set(c.id, { n: a.n + 1, at: Date.now() });
    try {
      if (a.n < MAX_ATTEMPTS) {
        console.log(`[recovery] retrying launch $${c.ticker} (attempt ${a.n + 1}/${MAX_ATTEMPTS})`);
        await retryLaunch(c.id);
        attempts.delete(c.id);
      } else {
        console.log(`[recovery] refunding $${c.ticker} to ${c.creatorWallet}`);
        await refundLaunch(c.id, `launch failed ${MAX_ATTEMPTS} times`);
        attempts.delete(c.id);
      }
    } catch (e) {
      console.error(`[recovery] $${c.ticker}:`, (e as Error).message.slice(0, 200));
    }
    return; // one per beat
  }
}

/** Old FAILED rows the in-memory counter doesn't know about yet: treat them as already tried once. */
export async function seedAttempts() {
  const old = await db.select({ id: C.id }).from(C).where(and(eq(C.status, "FAILED"), lt(C.createdAt, new Date(Date.now() - 10 * 60_000))));
  for (const { id } of old) if (!attempts.has(id)) attempts.set(id, { n: 1, at: 0 });
}
