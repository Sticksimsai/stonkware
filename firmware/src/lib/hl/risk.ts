// Server-side risk limits for agent trading on Hyperliquid. Pure: the trading module gathers the numbers,
// this decides. The agent can't change these; its prompt only tells it what they are.
export type RiskLimits = {
  /** Highest leverage on any perp position (always isolated margin). */
  maxLeverage: number;
  /** Capital at risk (perp margin + spot tokens held) as a % of Hyperliquid equity. */
  maxRiskPct: number;
  /** One order's margin (perps) or cost (spot buys) as a % of equity. */
  maxOrderPct: number;
  /** Trading stops for the rest of the UTC day once today's loss reaches this % of the day's starting equity. */
  dailyLossPct: number;
  /** Optional allow-list of market names (e.g. BTC, ETH, HYPE/USDC). null = all. */
  allowed: Set<string> | null;
};

/** Hyperliquid rejects orders under $10 notional. */
export const MIN_NOTIONAL_USD = 10;
/** Markets the agent can't trade: uSOL is how the treasury moves SOL, and the bridge sells any it holds. */
export const BLOCKED = new Set(["USOL/USDC"]);

export type OrderCheck = {
  market: { kind: "perp" | "spot"; name: string; maxLeverage: number };
  side: "buy" | "sell";
  reduceOnly: boolean;
  notionalUsd: number;
  /** perps only */
  leverage: number;
  /** spot sells: true when selling tokens the company holds (reduces risk) */
  closesExposure: boolean;
  equityUsd: number;
  /** perp margin used + value of spot tokens held (excluding USDC and uSOL) */
  atRiskUsd: number;
  dayStartEquityUsd: number;
  /** today's realised trading loss + current unrealised loss, as a positive number (0 when up) */
  dayLossUsd: number;
};

export type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });
const usd = (n: number) => `$${n.toFixed(2)}`;

export function dailyLossHit(dayLossUsd: number, dayStartEquityUsd: number, limits: RiskLimits) {
  return dayStartEquityUsd > 0 && dayLossUsd >= (limits.dailyLossPct / 100) * dayStartEquityUsd;
}

export function checkOrder(o: OrderCheck, limits: RiskLimits): Verdict {
  if (BLOCKED.has(o.market.name.toUpperCase())) return no(`${o.market.name} is reserved for moving the treasury between chains; trade the SOL perp for SOL exposure`);
  if (!(o.notionalUsd > 0) || !Number.isFinite(o.notionalUsd)) return no("order size must be positive");
  // closing or shrinking a position is always allowed, even after the daily stop
  if (o.reduceOnly || (o.market.kind === "spot" && o.side === "sell" && o.closesExposure)) return { ok: true };
  if (limits.allowed && !limits.allowed.has(o.market.name.toUpperCase())) return no(`${o.market.name} isn't on this platform's allowed markets: ${[...limits.allowed].join(", ")}`);
  if (o.market.kind === "spot" && o.side === "sell") return no("spot sells are only for tokens you hold (no shorting on spot; use a perp)");
  if (!(o.equityUsd > 0)) return no("no funds on Hyperliquid yet");
  if (dailyLossHit(o.dayLossUsd, o.dayStartEquityUsd, limits)) {
    return no(`daily loss limit reached (${usd(o.dayLossUsd)} of ${usd(o.dayStartEquityUsd)} starting equity, limit ${limits.dailyLossPct}%). New trades open again at 00:00 UTC; you can still close positions`);
  }
  if (o.notionalUsd < MIN_NOTIONAL_USD) return no(`orders must be at least ${usd(MIN_NOTIONAL_USD)} notional`);

  let cost = o.notionalUsd;
  if (o.market.kind === "perp") {
    const maxLev = Math.min(limits.maxLeverage, o.market.maxLeverage);
    if (!Number.isInteger(o.leverage) || o.leverage < 1) return no("leverage must be a whole number ≥ 1");
    if (o.leverage > maxLev) return no(`leverage ${o.leverage}× is over the limit of ${maxLev}× for ${o.market.name}`);
    cost = o.notionalUsd / o.leverage; // margin
  }
  const maxOrder = (limits.maxOrderPct / 100) * o.equityUsd;
  if (cost > maxOrder + 1e-9) return no(`this order puts ${usd(cost)} at risk; the per-order limit is ${limits.maxOrderPct}% of equity (${usd(maxOrder)})`);
  const maxRisk = (limits.maxRiskPct / 100) * o.equityUsd;
  if (o.atRiskUsd + cost > maxRisk + 1e-9) {
    return no(`capital at risk would be ${usd(o.atRiskUsd + cost)}; the limit is ${limits.maxRiskPct}% of equity (${usd(maxRisk)}). Close or shrink a position first`);
  }
  return { ok: true };
}

/** Trading loss so far today: realised (fills' closed PnL minus fees) plus any unrealised loss, as a positive number. */
export function dayLoss(fills: { closedPnl: number; fee: number }[], unrealizedPnl: number): number {
  const realised = fills.reduce((a, f) => a + f.closedPnl - f.fee, 0);
  return Math.max(0, -(realised + Math.min(0, unrealizedPnl)));
}

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const utcDayStart = (t = Date.now()) => Date.parse(`${utcDay(t)}T00:00:00Z`);
