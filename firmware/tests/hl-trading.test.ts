// Hyperliquid Phase 3: server-side risk limits for agent trading, order checks, price formatting, tool gating.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_hl-env";
import { checkOrder, dayLoss, dailyLossHit, utcDay, utcDayStart, type OrderCheck, type RiskLimits } from "../src/lib/hl/risk";
import { checkTrade, HlRefusal } from "../src/lib/hl/policy";
import { formatPrice } from "../src/lib/hl/markets";
import { toolsFor, TRADE_TOOLS } from "../src/lib/agent/tools";

const L: RiskLimits = { maxLeverage: 3, maxRiskPct: 25, maxOrderPct: 10, dailyLossPct: 10, allowed: null };
const btc = { kind: "perp" as const, name: "BTC", maxLeverage: 40 };
const base: OrderCheck = {
  market: btc, side: "buy", reduceOnly: false, notionalUsd: 100, leverage: 1, closesExposure: false,
  equityUsd: 1000, atRiskUsd: 0, dayStartEquityUsd: 1000, dayLossUsd: 0,
};
const ok = (o: Partial<OrderCheck>, l = L) => checkOrder({ ...base, ...o }, l);
const reason = (o: Partial<OrderCheck>, l = L) => { const v = ok(o, l); return v.ok ? "" : v.reason; };

test("risk: per-order limit uses margin for perps and cost for spot", () => {
  assert.ok(ok({ notionalUsd: 100 }).ok); // $100 at 1× = 10% of $1000
  assert.match(reason({ notionalUsd: 101 }), /per-order limit/);
  assert.ok(ok({ notionalUsd: 300, leverage: 3 }).ok); // $100 margin
  assert.match(reason({ notionalUsd: 330, leverage: 3 }), /per-order/);
  assert.match(reason({ market: { kind: "spot", name: "HYPE/USDC", maxLeverage: 1 }, notionalUsd: 150 }), /per-order/);
});

test("risk: leverage is capped by the platform and by the market", () => {
  assert.match(reason({ leverage: 4, notionalUsd: 40 }), /over the limit of 3×/);
  assert.match(reason({ market: { ...btc, maxLeverage: 2 }, leverage: 3, notionalUsd: 30 }), /limit of 2×/);
  assert.match(reason({ leverage: 1.5, notionalUsd: 30 }), /whole number/);
  assert.match(reason({ leverage: 0, notionalUsd: 30 }), /whole number/);
});

test("risk: total capital at risk stays under the cap", () => {
  assert.ok(ok({ atRiskUsd: 150, notionalUsd: 100 }).ok); // 250 = 25%
  assert.match(reason({ atRiskUsd: 160, notionalUsd: 100 }), /capital at risk would be \$260\.00/);
});

test("risk: daily loss stop blocks new trades but never closing ones", () => {
  assert.ok(dailyLossHit(100, 1000, L));
  assert.ok(!dailyLossHit(99.99, 1000, L));
  assert.match(reason({ dayLossUsd: 100 }), /daily loss limit reached/);
  assert.ok(ok({ dayLossUsd: 500, reduceOnly: true, side: "sell" }).ok);
  assert.ok(ok({ dayLossUsd: 500, market: { kind: "spot", name: "HYPE/USDC", maxLeverage: 1 }, side: "sell", closesExposure: true }).ok);
});

test("risk: spot can't be shorted, uSOL is off-limits, allow-list applies, $10 minimum", () => {
  const hype = { kind: "spot" as const, name: "HYPE/USDC", maxLeverage: 1 };
  assert.match(reason({ market: hype, side: "sell", closesExposure: false }), /no shorting on spot/);
  assert.match(reason({ market: { kind: "spot", name: "USOL/USDC", maxLeverage: 1 } }), /reserved/);
  assert.match(reason({ market: { kind: "spot", name: "USOL/USDC", maxLeverage: 1 }, side: "sell", closesExposure: true }), /reserved/);
  assert.match(reason({ notionalUsd: 50 }, { ...L, allowed: new Set(["ETH"]) }), /allowed markets/);
  assert.ok(ok({ notionalUsd: 50 }, { ...L, allowed: new Set(["BTC"]) }).ok);
  assert.match(reason({ notionalUsd: 9 }), /at least \$10/);
  assert.match(reason({ equityUsd: 0 }), /no funds/);
});

test("risk: today's loss counts realised PnL, fees and open losses, but not open gains", () => {
  assert.equal(dayLoss([], 0), 0);
  assert.equal(dayLoss([{ closedPnl: -40, fee: 2 }], 0), 42);
  assert.equal(dayLoss([{ closedPnl: 50, fee: 1 }], -30), 0); // up 49 realised, down 30 open → net +19
  assert.equal(dayLoss([{ closedPnl: -50, fee: 0 }], 30), 50); // open gains don't offset realised losses
  assert.equal(dayLoss([{ closedPnl: 0, fee: 1 }], -20), 21);
});

test("risk: UTC day helpers", () => {
  const t = Date.parse("2026-10-30T23:59:59Z");
  assert.equal(utcDay(t), "2026-10-30");
  assert.equal(utcDayStart(t), Date.parse("2026-10-30T00:00:00Z"));
});

test("policy: trade actions are structurally checked", () => {
  checkTrade({ kind: "order", asset: 0, isBuy: true, size: "0.01", price: "95000", tif: "Gtc", reduceOnly: false });
  assert.throws(() => checkTrade({ kind: "order", asset: 0, isBuy: true, size: "0", price: "1", tif: "Gtc", reduceOnly: false }), HlRefusal);
  assert.throws(() => checkTrade({ kind: "order", asset: 0, isBuy: true, size: "1", price: "1", tif: "Fok" as "Gtc", reduceOnly: false }), HlRefusal);
  assert.throws(() => checkTrade({ kind: "order", asset: 10_107, isBuy: false, size: "1", price: "1", tif: "Ioc", reduceOnly: true }), /perps/);
  assert.throws(() => checkTrade({ kind: "leverage", asset: 10_107, leverage: 2 }), /perps/);
  assert.throws(() => checkTrade({ kind: "leverage", asset: 0, leverage: 2.5 }), HlRefusal);
  assert.throws(() => checkTrade({ kind: "cancel", asset: 0, oid: 0 }), HlRefusal);
});

test("prices: perps allow 6 − szDecimals decimals, spot 8 − szDecimals, 5 significant figures", () => {
  assert.equal(formatPrice(2311.0567, 4, "perp"), "2311.1"); // 5 sig figs
  assert.equal(formatPrice(0.123456789, 0, "perp"), "0.12346");
  assert.equal(formatPrice(0.0123456, 4, "perp"), "0.01"); // capped at 6 − 4 = 2 decimals
  assert.throws(() => formatPrice(0.00123456, 4, "perp"), /precision/); // would round to 0
  assert.equal(formatPrice(0.00123456, 4, "spot"), "0.0012"); // 8 − 4 = 4 decimals
  assert.equal(formatPrice(0.00123456, 2, "spot"), "0.001235"); // nearest
  assert.equal(formatPrice(0.00123456, 2, "spot", "down"), "0.001234");
  assert.equal(formatPrice(95123.7, 5, "perp", "down"), "95123");
  assert.equal(formatPrice(95123.2, 5, "perp", "up"), "95124");
  assert.throws(() => formatPrice(0, 2, "perp"));
});

test("tools: trading tools only appear when trading is on and the API wallet is approved", () => {
  const names = (c: Parameters<typeof toolsFor>[1]) => toolsFor(false, c).map((t) => t.name);
  // test env: FIRMWARE_MODE=mock and HL_TRADING unset → off
  assert.ok(!names({ flagship: false, hlAgentApprovedAt: new Date() }).some((n) => TRADE_TOOLS.has(n)));
  assert.ok(!names(undefined).some((n) => TRADE_TOOLS.has(n)));
});
