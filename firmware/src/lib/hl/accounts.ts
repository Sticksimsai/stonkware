// Sets up each company's Hyperliquid account: keys at creation (or backfilled), then the API wallet approval
// once the account exists on Hyperliquid (it needs to have received funds first).
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { emit } from "../feed";
import { accountExists, agentIsApproved } from "./client";
import { AGENT_NAME } from "./policy";
import { hlExecute, newSealedEvmKey } from "./signer";

const C = schema.companies;

/** Column values for a new company's Hyperliquid keys (master + API wallet). */
export function newHlKeys() {
  const master = newSealedEvmKey();
  const agent = newSealedEvmKey();
  return { hlAddress: master.address, hlSecretEnc: master.sealed, hlAgentAddress: agent.address, hlAgentSecretEnc: agent.sealed };
}

/** Give an existing company Hyperliquid keys if it has none. Returns true when keys were created. */
export async function ensureHlKeys(c: Pick<Company, "id" | "hlAddress">): Promise<boolean> {
  if (c.hlAddress) return false;
  const res = await db.update(C).set(newHlKeys()).where(and(eq(C.id, c.id), isNull(C.hlAddress))).returning({ id: C.id });
  return res.length > 0;
}

export type ApprovalResult = "approved" | "already" | "waiting-for-funds" | "no-keys";

/** Approve the company's API wallet on Hyperliquid. Safe to call repeatedly. */
export async function ensureAgentApproved(c: Company): Promise<ApprovalResult> {
  if (!c.hlAddress || !c.hlAgentAddress) return "no-keys";
  if (c.hlAgentApprovedAt) return "already";
  if (!(await accountExists(c.hlAddress))) return "waiting-for-funds";
  if (!(await agentIsApproved(c.hlAddress, c.hlAgentAddress))) {
    await hlExecute(c, { kind: "approve-agent", agent: c.hlAgentAddress, name: AGENT_NAME });
  }
  await db.update(C).set({ hlAgentApprovedAt: new Date() }).where(eq(C.id, c.id));
  await emit(c.id, "TREASURY", "Hyperliquid account ready", `The agent's trading key is approved on ${c.hlAddress.slice(0, 6)}…${c.hlAddress.slice(-4)}. It can trade, but it can never withdraw.`);
  return "approved";
}

// Unfunded accounts are re-checked at most this often, so the scheduler doesn't hammer the API every beat.
const RECHECK_MS = 10 * 60_000;
const lastChecked = new Map<string, number>();

/** Scheduler step: backfill missing keys, then approve API wallets for live companies whose accounts exist. */
export async function hlUpkeep() {
  const missing = await db.query.companies.findMany({ where: isNull(C.hlAddress), columns: { id: true, hlAddress: true }, limit: 25 });
  for (const c of missing) await ensureHlKeys(c);

  const pending = await db.query.companies.findMany({
    where: and(eq(C.status, "LIVE"), isNotNull(C.hlAddress), isNull(C.hlAgentApprovedAt)),
    limit: 10,
  });
  for (const c of pending) {
    if (Date.now() - (lastChecked.get(c.id) ?? 0) < RECHECK_MS) continue;
    lastChecked.set(c.id, Date.now());
    try {
      await ensureAgentApproved(c);
    } catch (e) {
      console.error(`[hl] approve API wallet $${c.ticker}:`, (e as Error).message.slice(0, 200));
    }
  }
}
