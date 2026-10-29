// The agent has full control of the treasury. The only hard rules are physical/structural:
// it can't spend money that isn't there, can't dip into the rent floor, and can't act while paused.
// Optional caps (AGENT_MAX_TRANSFER_SOL / AGENT_MAX_DAILY_SPEND_SOL) are off unless configured.
import { env } from "./env";
import { FEES } from "./fees";

export type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });

export function checkSpend(p: { status: string; balance: number; amount: number; spentLast24h: number }): Verdict {
  if (p.status !== "LIVE") return no(`company is ${p.status.toLowerCase()}`);
  if (!Number.isInteger(p.amount) || p.amount <= 0) return no("amount must be positive");
  const spendable = p.balance - FEES.treasuryFloorLamports;
  if (p.amount > spendable) return no(`insufficient funds: spendable ${(spendable / 1e9).toFixed(4)} SOL`);
  if (p.amount > env.maxTransferSol * 1e9) return no(`over the configured per-transfer cap (${env.maxTransferSol} SOL)`);
  if (p.spentLast24h + p.amount > env.maxDailySpendSol * 1e9) return no(`over the configured daily cap (${env.maxDailySpendSol} SOL)`);
  return { ok: true };
}

export const OFFER_BOUNDS = { minSol: 0.001, maxSol: 1000, minUsd: 1, maxUsd: 100_000, maxActive: 20 };
