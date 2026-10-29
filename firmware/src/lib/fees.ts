// Fee routing. Shared by client (display) and server. Integer lamports.
// Everything that isn't the platform share belongs to the company — the agent decides what to do with it.

export const FEES = {
  /**
   * Extra platform share taken from claimed creator fees. 0 because on Meteora Hypeware is the DBC
   * *partner* and earns its share of every trade directly (see LAUNCHPAD in src/lib/meteora.ts).
   */
  platformCreatorFeeBps: 0,
  /** Platform share of customer revenue. */
  platformRevenueBps: 500, // 5%
  /** Upfront cost buffer for creating the Meteora DBC pool (rent for pool, vaults, mint, metadata + fees). */
  launchCostLamports: 40_000_000, // 0.04 SOL (unused remainder stays in the treasury)
  /** Default starter fuel so the agent can work before the first fee claim. */
  defaultFuelSol: 0.05,
  /** Kept in the treasury for rent + tx fees. The agent can't spend below this. */
  treasuryFloorLamports: 10_000_000, // 0.01 SOL
  /** The agent sleeps when spendable balance drops under this. */
  minRunLamports: 3_000_000, // 0.003 SOL
} as const;

export function platformCut(amount: number, kind: "fees" | "revenue", bpsOverride?: number) {
  const bps = bpsOverride ?? (kind === "fees" ? FEES.platformCreatorFeeBps : FEES.platformRevenueBps);
  const platform = Math.floor((Math.max(0, amount) * bps) / 10_000);
  return { platform, company: amount - platform };
}

export function launchDeposit(devBuyLamports: number, fuelLamports: number) {
  return FEES.launchCostLamports + devBuyLamports + fuelLamports;
}
