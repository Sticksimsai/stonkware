// Moves each company's SOL between its Solana treasury and its Hyperliquid account (via Unit), and converts
// uSOL ⇄ USDC there. Off unless HL_BRIDGE=on, live mode, and Unit's network matches Solana's.
import { PublicKey } from "@solana/web3.js";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company, HlBridge } from "@/db/schema";
import { env, isLive } from "../env";
import { connection } from "../solana";
import { transferFromTreasury } from "../signer";
import { emit, record } from "../feed";
import { fmtSol } from "../units";
import { solUsd } from "../price";
import { hlBalance, type HlBalance } from "./client";
import { ensureAgentApproved } from "./accounts";
import { hlConvert, hlExecute } from "./signer";
import { formatSpotPrice, limitPrice, mids, roundSize, solUsdRef, spotMarket, tokenWire } from "./spot";
import { assertVerified, unitAddress, unitOperations, type AddressProposal } from "./unit";
import { matchOperation, networksMatch, nextState, refillAmount, sweepAmount, type Thresholds } from "./bridge-plan";

const C = schema.companies;
const B = schema.hlBridges;

const thresholds = (): Thresholds => ({ floatSol: env.solFloatSol, sweepMinSol: env.solSweepMinSol, refillBelowSol: env.solRefillBelowSol });

let warnedMismatch = false;
/** True when the bridge may move funds. Logs once if the networks don't match. */
export function bridgeReady(): boolean {
  if (!env.hlBridge || !isLive()) return false;
  if (!networksMatch(env.hlNetwork, env.cluster)) {
    if (!warnedMismatch) console.error(`[hl] HL_BRIDGE is on but HL_NETWORK=${env.hlNetwork} doesn't match Solana ${env.cluster}; not moving funds`);
    warnedMismatch = true;
    return false;
  }
  return true;
}

const solBalance = (c: Company) => connection().getBalance(new PublicKey(c.treasuryPubkey), "confirmed");

/** SOL/USD for valuing the treasury: Hyperliquid's SOL perp mid, else the platform price feed. */
export async function solPrice(): Promise<number> {
  return solUsdRef().catch(() => solUsd());
}

// ───────────────────────────── Unit addresses (cached per company, re-verified on use) ─────────────────────────────

async function cachedAddress(c: Company, kind: "deposit" | "withdraw"): Promise<AddressProposal> {
  const col = kind === "deposit" ? "unitSolDeposit" : "unitSolWithdraw";
  const stored = c[col] ? (JSON.parse(c[col]!) as AddressProposal) : null;
  const want = kind === "deposit"
    ? { src: "solana" as const, dst: "hyperliquid" as const, dstAddr: c.hlAddress! }
    : { src: "hyperliquid" as const, dst: "solana" as const, dstAddr: c.treasuryPubkey };
  if (stored && stored.src === want.src && stored.dst === want.dst && stored.dstAddr === want.dstAddr && stored.asset === "sol") {
    assertVerified(stored, env.hlNetwork); // a tampered row fails here
    return stored;
  }
  const fresh = await unitAddress(want.src, want.dst, "sol", want.dstAddr);
  await db.update(C).set({ [col]: JSON.stringify(fresh) }).where(eq(C.id, c.id));
  return fresh;
}

// ───────────────────────────── Solana → Hyperliquid ─────────────────────────────

async function inFlight(companyId: string, direction: "to-hl" | "to-sol") {
  return db.query.hlBridges.findFirst({ where: and(eq(B.companyId, companyId), eq(B.direction, direction), inArray(B.state, ["SENT", "ARRIVED"])) });
}

/** Send SOL above the float to Hyperliquid. Returns the bridge row, or null when there's nothing to move. */
export async function sweepToHl(c: Company): Promise<HlBridge | null> {
  if (!bridgeReady() || c.status !== "LIVE" || !c.hlAddress) return null;
  if (await inFlight(c.id, "to-hl")) return null;
  const amount = sweepAmount(await solBalance(c), thresholds());
  if (!amount) return null;
  const dep = await cachedAddress(c, "deposit");
  const sig = await transferFromTreasury(c.treasurySecretEnc, c.treasuryPubkey, dep.address, amount);
  const [row] = await db.insert(B).values({ companyId: c.id, direction: "to-hl", lamports: amount, protocolAddress: dep.address, sourceRef: sig }).returning();
  await record(c.id, "BRIDGE", 0, `moved ${fmtSol(amount, 4)} to Hyperliquid (via Unit)`, sig, String(amount));
  await emit(c.id, "TREASURY", `Moving ${fmtSol(amount, 3)} to Hyperliquid`, "It arrives as uSOL in a few minutes and is converted to USDC.", sig);
  return row;
}

/** Sell any uSOL on the company's Hyperliquid account for USDC (IOC, capped at HL_MAX_SLIPPAGE_BPS). */
export async function convertUsol(c: Company, bal?: HlBalance): Promise<number> {
  if (!c.hlAddress) return 0;
  if (!c.hlAgentApprovedAt) {
    if ((await ensureAgentApproved(c)) !== "approved") return 0;
    c = (await db.query.companies.findFirst({ where: eq(C.id, c.id) }))!;
  }
  const b = bal ?? (await hlBalance(c.hlAddress!));
  const usol = b.spot.find((s) => s.coin === "USOL")?.total ?? 0;
  const m = await spotMarket("USOL");
  const size = roundSize(usol, m.szDecimals);
  if (!(Number(size) > 0)) return 0;
  const px = formatSpotPrice(limitPrice("sell", await solUsdRef(), env.hlMaxSlippageBps), m.szDecimals, "up");
  const fill = await hlConvert(c, m.asset, { coin: "USOL", side: "sell", size, limitPx: px });
  if (fill.size <= 0) {
    console.warn(`[hl] $${c.ticker}: no uSOL fill at ≥ $${px} (book too far from the SOL price); will retry`);
    return 0;
  }
  const usd = fill.size * fill.avgPx;
  await record(c.id, "SWAP", 0, `sold ${fill.size} uSOL for $${usd.toFixed(2)} USDC on Hyperliquid`, null, String(Math.round(fill.size * 1e9)));
  await emit(c.id, "TREASURY", `Converted ${fill.size} SOL to $${usd.toFixed(2)} USDC`, `On Hyperliquid at $${fill.avgPx.toFixed(2)}.`);
  return usd;
}

// ───────────────────────────── Hyperliquid → Solana ─────────────────────────────

export class RefillStarted extends Error {}

/**
 * Bring SOL back to the Solana treasury: buy uSOL with USDC if needed, then send it to Unit.
 * `needLamports` = what the treasury wants to spend now (0 = just restore the float).
 */
export async function refillSol(c: Company, needLamports = 0): Promise<HlBridge | null> {
  if (!bridgeReady() || !c.hlAddress) return null;
  if (await inFlight(c.id, "to-sol")) return null;
  const amount = refillAmount(await solBalance(c), needLamports, thresholds());
  if (!amount) return null;
  if (!c.hlAgentApprovedAt && (await ensureAgentApproved(c)) !== "approved") return null;
  c = (await db.query.companies.findFirst({ where: eq(C.id, c.id) }))!;

  const m = await spotMarket("USOL");
  const wantSol = amount / 1e9;
  let bal = await hlBalance(c.hlAddress!);
  let usol = bal.spot.find((s) => s.coin === "USOL")?.total ?? 0;
  if (usol < wantSol) {
    const ref = await solUsdRef();
    const buySize = Math.ceil((wantSol - usol) * 10 ** m.szDecimals) / 10 ** m.szDecimals;
    const maxPx = limitPrice("buy", ref, env.hlMaxSlippageBps);
    if (bal.spotUsdc < buySize * maxPx) {
      if (needLamports === 0) return null; // routine float top-up: nothing to bring back yet
      throw new Error(`not enough USDC on Hyperliquid to bring back ${fmtSol(amount, 3)}`);
    }
    const fill = await hlConvert(c, m.asset, { coin: "USOL", side: "buy", size: buySize.toFixed(m.szDecimals), limitPx: formatSpotPrice(maxPx, m.szDecimals, "down") });
    if (fill.size <= 0) throw new Error("couldn't buy uSOL near the SOL price on Hyperliquid right now");
    await record(c.id, "SWAP", 0, `bought ${fill.size} uSOL for $${(fill.size * fill.avgPx).toFixed(2)} USDC on Hyperliquid`, null, String(Math.round(fill.size * 1e9)));
    bal = await hlBalance(c.hlAddress!);
    usol = bal.spot.find((s) => s.coin === "USOL")?.total ?? 0;
  }
  const send = Math.min(usol, wantSol);
  const sendLamports = Math.floor(send * 1e9);
  if (sendLamports < amount * 0.98) throw new Error("uSOL balance too low to refill");
  const wd = await cachedAddress(c, "withdraw");
  const ref = await hlExecute(c, { kind: "spot-send", to: wd.address, token: tokenWire("USOL"), amount: roundSize(send, 8) });
  const [row] = await db.insert(B).values({ companyId: c.id, direction: "to-sol", lamports: sendLamports, protocolAddress: wd.address, sourceRef: ref }).returning();
  await record(c.id, "BRIDGE", 0, `moving ${fmtSol(sendLamports, 4)} back to Solana (via Unit)`, null, String(sendLamports));
  await emit(c.id, "TREASURY", `Moving ${fmtSol(sendLamports, 3)} back to Solana`, "For buybacks and gas. Usually takes 5–15 minutes.");
  return row;
}

/**
 * Before spending SOL on Solana: make sure it's there. If it's on Hyperliquid instead, start bringing it back and
 * throw RefillStarted with a message the agent can act on.
 */
export async function ensureSolLiquidity(c: Company, lamports: number): Promise<void> {
  if (!isLive() || !c.hlAddress) return;
  const have = await solBalance(c);
  if (have - 10_000 >= lamports) return;
  if (!bridgeReady()) return; // let the normal balance checks report it
  const pending = await inFlight(c.id, "to-sol");
  if (pending) throw new RefillStarted(`${fmtSol(pending.lamports, 3)} is already on its way back from Hyperliquid. Try again in about 10 minutes.`);
  const row = await refillSol(c, lamports);
  if (row) throw new RefillStarted(`Not enough SOL on Solana right now, so ${fmtSol(row.lamports, 3)} is moving back from Hyperliquid. Try again in about 10 minutes.`);
}

// ───────────────────────────── tracking ─────────────────────────────

/** SOL value of everything on Hyperliquid + in flight, in lamports. Used by treasuryBalance. */
export async function hlValueLamports(c: Company): Promise<number> {
  if (!bridgeReady() || !c.hlAddress) return 0; // bridge off: the treasury is the Solana balance, exactly as before
  const [bal, px, flying] = await Promise.all([
    hlBalance(c.hlAddress).catch(() => null),
    solPrice(),
    db.select({ l: B.lamports, d: B.direction }).from(B).where(and(eq(B.companyId, c.id), eq(B.state, "SENT"))),
  ]);
  const usol = bal?.spot.find((s) => s.coin === "USOL")?.total ?? 0;
  // HYPE from customer payments that hasn't been converted to USDC yet
  const hype = bal?.spot.find((s) => s.coin === "HYPE")?.total ?? 0;
  const hypeUsd = hype > 0 ? hype * ((await mids())[(await spotMarket("HYPE")).name] ?? 0) : 0;
  const usd = (bal?.usd ?? 0) + hypeUsd;
  const inFlightLamports = flying.reduce((a, r) => a + r.l, 0);
  return Math.floor((usd / px) * 1e9 + usol * 1e9) + inFlightLamports;
}

async function finish(b: HlBridge, state: "DONE" | "FAILED" | "STUCK" | "ARRIVED", patch: Partial<HlBridge> = {}) {
  await db.update(B).set({ ...patch, state, updatedAt: new Date(), ...(state === "DONE" || state === "FAILED" ? { doneAt: new Date() } : {}) }).where(eq(B.id, b.id));
}

/** Advance in-flight bridges from Unit's operation status. */
export async function pollBridges() {
  const open = await db.query.hlBridges.findMany({ where: eq(B.state, "SENT"), limit: 50 });
  const byAddress = new Map<string, Awaited<ReturnType<typeof unitOperations>>>();
  for (const b of open) {
    if (Date.now() - b.createdAt.getTime() < 30_000) continue;
    let ops = byAddress.get(b.protocolAddress);
    if (!ops) {
      ops = await unitOperations(b.protocolAddress).catch((e) => { console.error("[hl] unit operations:", (e as Error).message); return [] as never[]; });
      byAddress.set(b.protocolAddress, ops);
    }
    const op = matchOperation(ops, b);
    const next = nextState(b, op);
    const c = await db.query.companies.findFirst({ where: eq(C.id, b.companyId) });
    if (!c) continue;
    const patch = { unitState: op?.state ?? b.unitState, unitOpId: op?.operationId || b.unitOpId };
    if (next === "wait") {
      if (patch.unitState !== b.unitState) await db.update(B).set({ ...patch, updatedAt: new Date() }).where(eq(B.id, b.id));
    } else if (next === "arrived") {
      await finish(b, "ARRIVED", patch);
    } else if (next === "done") {
      await finish(b, "DONE", patch);
      await db.update(C).set({ wakeRequested: true }).where(eq(C.id, c.id));
      await emit(c.id, "TREASURY", `${fmtSol(b.lamports, 3)} arrived back on Solana`, "Ready for buybacks and gas.");
    } else if (next === "failed") {
      await finish(b, "FAILED", { ...patch, error: "Unit reported failure" });
      await emit(c.id, "SYSTEM", `Moving ${fmtSol(b.lamports, 3)} ${b.direction === "to-hl" ? "to Hyperliquid" : "back to Solana"} failed`, "The platform team has been alerted.");
      console.error(`[hl] bridge ${b.id} ($${c.ticker}, ${b.direction}) FAILED at Unit`);
    } else if (next === "stuck") {
      await finish(b, "STUCK", { ...patch, error: `not finished after 90 min (Unit state: ${op?.state ?? "not seen"})` });
      console.error(`[hl] bridge ${b.id} ($${c.ticker}, ${b.direction}) STUCK: Unit state ${op?.state ?? "not seen"}`);
    }
  }
}

/** Convert arrived uSOL; a bridge is done once its company holds no more uSOL to sell. */
async function settleArrivals() {
  const arrived = await db.query.hlBridges.findMany({ where: eq(B.state, "ARRIVED"), limit: 20 });
  for (const companyId of new Set(arrived.map((b) => b.companyId))) {
    const c = await db.query.companies.findFirst({ where: eq(C.id, companyId) });
    if (!c?.hlAddress) continue;
    try {
      const usd = await convertUsol(c);
      const bal = await hlBalance(c.hlAddress);
      const m = await spotMarket("USOL");
      const left = Number(roundSize(bal.spot.find((s) => s.coin === "USOL")?.total ?? 0, m.szDecimals));
      if (left === 0) {
        for (const b of arrived.filter((x) => x.companyId === companyId)) await finish(b, "DONE", { usdc: usd || null });
      }
    } catch (e) {
      console.error(`[hl] convert uSOL $${c.ticker}:`, (e as Error).message.slice(0, 200));
    }
  }
}

const lastSweepCheck = new Map<string, number>();
const SWEEP_EVERY_MS = 10 * 60_000;

/** Scheduler step. */
export async function hlBridgeUpkeep() {
  if (!bridgeReady()) return;
  await pollBridges();
  await settleArrivals();
  const live = await db.query.companies.findMany({ where: and(eq(C.status, "LIVE"), isNotNull(C.hlAddress)), limit: 200 });
  for (const c of live) {
    if (Date.now() - (lastSweepCheck.get(c.id) ?? 0) < SWEEP_EVERY_MS) continue;
    lastSweepCheck.set(c.id, Date.now());
    try {
      if (!(await sweepToHl(c))) await refillSol(c, 0); // keep the float topped up for gas
    } catch (e) {
      console.error(`[hl] bridge $${c.ticker}:`, (e as Error).message.slice(0, 200));
    }
  }
}
