// Pure decisions for moving SOL between Solana and Hyperliquid. No I/O, so they're easy to test.
import { UNIT_DONE, UNIT_FAILED, UNIT_MIN_LAMPORTS, type UnitOperation } from "./unit";

const LAMPORTS = 1_000_000_000;
/** Kept back from a sweep for the transfer's own fee. */
export const SWEEP_FEE_LAMPORTS = 10_000;
/** A bridge not finished after this long is flagged as stuck. */
export const STUCK_AFTER_MS = 90 * 60_000;

export type Thresholds = { floatSol: number; sweepMinSol: number; refillBelowSol: number };

/** Lamports to send to Hyperliquid, or 0 when there isn't enough above the float to be worth a Unit deposit. */
export function sweepAmount(balanceLamports: number, t: Thresholds): number {
  const spare = balanceLamports - Math.round(t.floatSol * LAMPORTS) - SWEEP_FEE_LAMPORTS;
  const min = Math.max(UNIT_MIN_LAMPORTS, Math.round(t.sweepMinSol * LAMPORTS));
  return spare >= min ? spare : 0;
}

/**
 * Lamports to bring back to Solana so the treasury can spend `needLamports` and still keep its float.
 * 0 = nothing needed. Never below Unit's minimum withdrawal.
 */
export function refillAmount(balanceLamports: number, needLamports: number, t: Thresholds): number {
  const target = needLamports + Math.round(t.floatSol * LAMPORTS);
  const lowFloat = needLamports === 0 && balanceLamports < Math.round(t.refillBelowSol * LAMPORTS);
  if (needLamports > 0 ? balanceLamports >= target : !lowFloat) return 0;
  return Math.max(UNIT_MIN_LAMPORTS, target - balanceLamports);
}

/** Bridging only runs when Unit's network matches Solana's: testnet ⇔ devnet, mainnet ⇔ mainnet-beta. */
export function networksMatch(hlNetwork: "testnet" | "mainnet", solanaCluster: "devnet" | "mainnet-beta"): boolean {
  return (hlNetwork === "testnet") === (solanaCluster === "devnet");
}

export type BridgeLike = { direction: "to-hl" | "to-sol" | string; lamports: number; protocolAddress: string; sourceRef: string | null; createdAt: Date };

/**
 * Find the Unit operation for one of our bridges.
 *  to-hl: Unit's Solana tx hash is "<signature>:<destination>", so match on our signature.
 *  to-sol: we don't get a Hyperliquid tx hash back, so match the newest operation to that Unit address created
 *          after we sent, with the amount we sent (Unit reports it in lamports: 9 decimals).
 */
export function matchOperation(ops: UnitOperation[], b: BridgeLike): UnitOperation | null {
  const mine = ops.filter((o) => o.protocolAddress?.toLowerCase() === b.protocolAddress.toLowerCase());
  if (b.direction === "to-hl" && b.sourceRef) {
    return mine.find((o) => o.sourceTxHash?.startsWith(b.sourceRef!)) ?? null;
  }
  const after = b.createdAt.getTime() - 2 * 60_000;
  const close = (o: UnitOperation) => Math.abs(Number(o.sourceAmount) - b.lamports) <= Math.max(1_000, b.lamports * 0.001);
  return mine.filter((o) => new Date(o.opCreatedAt).getTime() >= after && close(o))
    .sort((x, y) => new Date(y.opCreatedAt).getTime() - new Date(x.opCreatedAt).getTime())[0] ?? null;
}

export type Next = "wait" | "arrived" | "done" | "failed" | "stuck";

/** What to do with a SENT bridge given its Unit operation (or none yet). */
export function nextState(b: BridgeLike, op: UnitOperation | null, now = Date.now()): Next {
  if (op?.state === UNIT_FAILED) return "failed";
  if (op?.state === UNIT_DONE) return b.direction === "to-hl" ? "arrived" : "done";
  if (now - b.createdAt.getTime() > STUCK_AFTER_MS) return "stuck";
  return "wait";
}
