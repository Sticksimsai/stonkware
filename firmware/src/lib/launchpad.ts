// Hypeware launchpad economics on Meteora DBC. Server-side (reads env); pass values to client components as props.
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return process.env[name] && Number.isFinite(v) ? v : fallback;
};

/** Launchpad economics. Change via env before running `npm run meteora:config` (a config is immutable once created). */
export const LAUNCHPAD = {
  /** Total trading fee after the anti-sniper window, in bps. */
  feeBps: num("DBC_FEE_BPS", 200),
  /** Anti-sniper: fee starts here and decays linearly to feeBps. */
  startFeeBps: num("DBC_START_FEE_BPS", 5000),
  antiSniperSeconds: num("DBC_ANTI_SNIPER_SECONDS", 120),
  /** % of the (post-Meteora) trading fee that goes to the company treasury; the rest to Hypeware. */
  creatorSharePct: num("DBC_CREATOR_SHARE_PCT", 75),
  /** Meteora's protocol cut of DBC trading fees. */
  meteoraPct: 20,
  initialMarketCapSol: num("DBC_INITIAL_MCAP_SOL", 30),
  migrationMarketCapSol: num("DBC_MIGRATION_MCAP_SOL", 400),
  totalSupply: 1_000_000_000,
  decimals: 6,
};

/** Effective per-trade fee split, in bps of volume (for display + docs). */
export function feeSplitBps() {
  const afterMeteora = (LAUNCHPAD.feeBps * (100 - LAUNCHPAD.meteoraPct)) / 100;
  const company = (afterMeteora * LAUNCHPAD.creatorSharePct) / 100;
  return { total: LAUNCHPAD.feeBps, meteora: LAUNCHPAD.feeBps - afterMeteora, company, firmware: afterMeteora - company };
}

