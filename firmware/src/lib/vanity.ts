// Vanity mint addresses for launches (e.g. every token's CA ends in "firm").
// A pool of pre-generated mint keypairs, sealed with VAULT_KEY. Each new launch reserves one; abandoned
// launches give theirs back. Only used on mainnet by default, so devnet/mock testing never spends them.
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db, schema } from "@/db";
import { env, isLive } from "./env";
import { connection } from "./solana";
import { newSealedKeypair } from "./signer";

const V = schema.vanityMints;
const C = schema.companies;
const HOLD_MS = () => Number(process.env.VANITY_HOLD_HOURS || 6) * 3600_000;

export const vanityEnabled = () =>
  process.env.VANITY_MINTS !== "0" && (process.env.VANITY_ANY_CLUSTER === "1" || (isLive() && env.cluster === "mainnet-beta"));

/** Reserve the oldest available vanity mint, or null if the pool is empty. Atomic (single UPDATE). */
export async function reserveVanity(): Promise<{ pubkey: string; sealed: string } | null> {
  if (!vanityEnabled()) return null;
  const rows = await db.update(V).set({ status: "reserved", reservedAt: new Date() })
    .where(eq(V.pubkey, sql`(select ${V.pubkey} from ${V} where ${V.status} = 'available' order by ${V.createdAt} limit 1)`))
    .returning({ pubkey: V.pubkey, sealed: V.secretEnc });
  return rows[0] ?? null;
}

export async function attachVanity(pubkey: string, companyId: string) {
  await db.update(V).set({ companyId }).where(eq(V.pubkey, pubkey));
}

/** Mint for a new launch: a vanity one if available, otherwise a random one. */
export async function mintForLaunch() {
  // the pool is a nice-to-have: if it errors (e.g. database busy), launch with a random address instead
  const v = await reserveVanity().catch((e) => { console.error("[vanity] reserve failed, using a random mint:", (e as { cause?: Error }).cause?.message ?? (e as Error).message); return null; });
  if (v) return { pubkey: v.pubkey, sealed: v.sealed, vanity: true };
  const r = newSealedKeypair();
  return { ...r, vanity: false };
}

/**
 * Scheduler: settle reserved vanity mints.
 *  · company launched (LIVE/LAUNCHING) → used
 *  · company never funded within VANITY_HOLD_HOURS → company gets a random mint, vanity back to the pool
 *  · launch FAILED → back to the pool only if the mint account was never created on-chain
 */
export async function settleVanity() {
  const reserved = await db.select().from(V).where(and(eq(V.status, "reserved"), lt(V.reservedAt, new Date(Date.now() - 60_000)))).orderBy(asc(V.reservedAt)).limit(20);
  for (const v of reserved) {
    const c = v.companyId ? await db.query.companies.findFirst({ where: eq(C.id, v.companyId), columns: { id: true, status: true, mintPubkey: true, createdAt: true } }) : null;
    if (!c || c.mintPubkey !== v.pubkey) {
      // reserved but never attached (crashed mid-request) → free it after the hold window
      if (Date.now() - (v.reservedAt?.getTime() ?? 0) > HOLD_MS()) await db.update(V).set({ status: "available", companyId: null, reservedAt: null }).where(eq(V.pubkey, v.pubkey));
      continue;
    }
    if (["LIVE", "LAUNCHING", "PAUSED"].includes(c.status)) {
      await db.update(V).set({ status: "used" }).where(eq(V.pubkey, v.pubkey));
    } else if (c.status === "PENDING_FUNDING" && Date.now() - c.createdAt.getTime() > HOLD_MS()) {
      const r = newSealedKeypair();
      await db.update(C).set({ mintPubkey: r.pubkey, mintSecretEnc: r.sealed }).where(and(eq(C.id, c.id), eq(C.status, "PENDING_FUNDING")));
      await db.update(V).set({ status: "available", companyId: null, reservedAt: null }).where(eq(V.pubkey, v.pubkey));
    } else if (c.status === "FAILED") {
      const exists = isLive() ? !!(await connection().getAccountInfo(new PublicKey(v.pubkey)).catch(() => ({}))) : false;
      if (exists) await db.update(V).set({ status: "used" }).where(eq(V.pubkey, v.pubkey));
      else {
        const r = newSealedKeypair();
        await db.update(C).set({ mintPubkey: r.pubkey, mintSecretEnc: r.sealed }).where(eq(C.id, c.id));
        await db.update(V).set({ status: "available", companyId: null, reservedAt: null }).where(eq(V.pubkey, v.pubkey));
      }
    }
  }
}

export async function poolStats() {
  const rows = await db.select({ status: V.status, n: sql<number>`count(*)` }).from(V).groupBy(V.status);
  const get = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return { available: get("available"), reserved: get("reserved"), used: get("used") };
}

export async function isKnownVanity(pubkeys: string[]) {
  if (!pubkeys.length) return new Set<string>();
  const rows = await db.select({ p: V.pubkey }).from(V).where(inArray(V.pubkey, pubkeys));
  return new Set(rows.map((r) => r.p));
}
