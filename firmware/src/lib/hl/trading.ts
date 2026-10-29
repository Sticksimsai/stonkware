// Agent trading on Hyperliquid: perps (isolated margin) and USDC spot pairs. Every new order goes through the
// server-side limits in risk.ts first; closing positions is always allowed. Off unless HL_TRADING=on.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { env, isLive } from "../env";
import { emit, record } from "../feed";
import { info } from "./client";
import { allMarkets, findMarket, formatPrice, type Market } from "./markets";
import { checkOrder, dailyLossHit, dayLoss, utcDay, utcDayStart, type RiskLimits } from "./risk";
import { hlExecute, hlTrade, type TradeResult } from "./signer";
import { mids, roundSize } from "./spot";

export function riskLimits(): RiskLimits {
  const allowed = env.hlAllowedMarkets.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return { maxLeverage: env.hlMaxLeverage, maxRiskPct: env.hlMaxRiskPct, maxOrderPct: env.hlMaxOrderPct, dailyLossPct: env.hlDailyLossPct, allowed: allowed.length ? new Set(allowed) : null };
}

/** Trading tools are offered when trading is on and the company's API wallet is approved. */
export function tradingEnabled(c?: Pick<Company, "hlAgentApprovedAt">): boolean {
  return env.hlTrading && isLive() && (!c || !!c.hlAgentApprovedAt);
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtSz = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

type Position = { coin: string; size: number; entryPx: number; unrealizedPnl: number; leverage: number; liquidationPx: number | null; marginUsed: number; positionValue: number };
type OpenOrder = { coin: string; oid: number; side: "buy" | "sell"; limitPx: number; size: number };

export type Book = {
  equityUsd: number;
  perpValue: number;
  perpWithdrawable: number;
  spotUsdc: number;
  /** non-USDC spot tokens (excluding uSOL, which belongs to the bridge) with USD value */
  spot: { coin: string; total: number; usd: number }[];
  positions: Position[];
  orders: OpenOrder[];
  atRiskUsd: number;
  unrealizedPnl: number;
  dayStartEquityUsd: number;
  dayLossUsd: number;
};

async function usolCoin(): Promise<string | null> {
  return (await allMarkets()).find((m) => m.kind === "spot" && m.name === "USOL/USDC")?.coin ?? null;
}

/** Everything the limits need, from Hyperliquid, plus today's starting equity (recorded on first look). */
export async function book(c: Company): Promise<Book> {
  if (!c.hlAddress) throw new Error("no Hyperliquid account");
  const user = c.hlAddress as `0x${string}`;
  const [perp, spot, orders, fills, px, markets, usol] = await Promise.all([
    info().clearinghouseState({ user }),
    info().spotClearinghouseState({ user }),
    info().openOrders({ user }),
    info().userFillsByTime({ user, startTime: utcDayStart() }),
    mids(),
    allMarkets(),
    usolCoin(),
  ]);
  const spotPair = new Map(markets.filter((m) => m.kind === "spot").sort((a, b) => a.dayVolumeUsd - b.dayVolumeUsd).map((m) => [m.name.split("/")[0], m]));
  const spotUsdc = Number(spot.balances.find((b) => b.coin === "USDC")?.total ?? 0);
  const held = spot.balances
    .filter((b) => b.coin !== "USDC" && b.coin !== "USOL" && Number(b.total) > 0)
    .map((b) => {
      const m = spotPair.get(String(b.coin));
      return { coin: String(b.coin), total: Number(b.total), usd: m ? Number(b.total) * (px[m.coin] ?? m.midPx) : 0 };
    });
  const positions: Position[] = perp.assetPositions.map(({ position: p }) => ({
    coin: p.coin, size: Number(p.szi), entryPx: Number(p.entryPx), unrealizedPnl: Number(p.unrealizedPnl), leverage: p.leverage.value,
    liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null, marginUsed: Number(p.marginUsed), positionValue: Number(p.positionValue),
  }));
  const perpValue = Number(perp.marginSummary.accountValue);
  const spotUsd = held.reduce((a, h) => a + h.usd, 0);
  const equityUsd = perpValue + spotUsdc + spotUsd;
  const unrealizedPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
  const tradeFills = (fills as { coin: string; closedPnl: string; fee: string }[])
    .filter((f) => f.coin !== usol) // the bridge's uSOL conversions aren't trading
    .map((f) => ({ closedPnl: Number(f.closedPnl), fee: Number(f.fee) }));

  const day = utcDay();
  const D = schema.hlTradingDays;
  let start = await db.query.hlTradingDays.findFirst({ where: and(eq(D.companyId, c.id), eq(D.day, day)) });
  if (!start) {
    await db.insert(D).values({ companyId: c.id, day, startEquityUsd: equityUsd }).onConflictDoNothing();
    start = await db.query.hlTradingDays.findFirst({ where: and(eq(D.companyId, c.id), eq(D.day, day)) });
  }
  return {
    equityUsd, perpValue, perpWithdrawable: Number(perp.withdrawable), spotUsdc, spot: held, positions,
    orders: (orders as { coin: string; oid: number; side: string; limitPx: string; sz: string }[]).map((o) => ({ coin: o.coin, oid: o.oid, side: o.side === "B" ? "buy" : "sell", limitPx: Number(o.limitPx), size: Number(o.sz) })),
    atRiskUsd: Number(perp.marginSummary.totalMarginUsed) + spotUsd,
    unrealizedPnl,
    dayStartEquityUsd: start?.startEquityUsd ?? equityUsd,
    dayLossUsd: dayLoss(tradeFills, unrealizedPnl),
  };
}

// ───────────────────────────── read tools ─────────────────────────────

export async function marketsText(query?: string): Promise<string> {
  const ms = await allMarkets();
  const lim = riskLimits();
  const q = query?.trim().toUpperCase();
  const pick = (kind: Market["kind"], n: number) => ms
    .filter((m) => m.kind === kind && m.name !== "USOL/USDC" && (!q || m.name.toUpperCase().includes(q)) && (!lim.allowed || lim.allowed.has(m.name.toUpperCase())))
    .sort((a, b) => b.dayVolumeUsd - a.dayVolumeUsd).slice(0, n);
  const perps = pick("perp", q ? 20 : 15).map((m) =>
    `- ${m.name} perp: $${m.midPx} · 24h vol ${usd(m.dayVolumeUsd)} · funding ${(m.funding * 100).toFixed(4)}%/h · max ${Math.min(m.maxLeverage, lim.maxLeverage)}×`);
  const spots = pick("spot", q ? 20 : 10).map((m) => `- ${m.name} spot: $${m.midPx} · 24h vol ${usd(m.dayVolumeUsd)}`);
  if (!perps.length && !spots.length) return q ? `No markets match "${query}".` : "No markets available.";
  return [`Hyperliquid ${env.hlNetwork} markets${q ? ` matching "${query}"` : " (top by volume)"}:`, ...perps, ...spots].join("\n");
}

export async function positionsText(c: Company): Promise<string> {
  const b = await book(c);
  const lim = riskLimits();
  const maxRisk = (lim.maxRiskPct / 100) * b.equityUsd;
  const lines = [
    `Hyperliquid account ${c.hlAddress} (${env.hlNetwork})`,
    `Equity ${usd(b.equityUsd)} · USDC: ${usd(b.spotUsdc)} spot + ${usd(b.perpValue)} in perps · unrealised PnL ${usd(b.unrealizedPnl)}`,
    `Capital at risk ${usd(b.atRiskUsd)} of ${usd(maxRisk)} allowed (${lim.maxRiskPct}%) · per order ≤ ${usd((lim.maxOrderPct / 100) * b.equityUsd)} · leverage ≤ ${lim.maxLeverage}× isolated`,
    `Today: loss ${usd(b.dayLossUsd)} of ${usd((lim.dailyLossPct / 100) * b.dayStartEquityUsd)} daily limit${dailyLossHit(b.dayLossUsd, b.dayStartEquityUsd, lim) ? " (REACHED: only closing trades until 00:00 UTC)" : ""}`,
  ];
  lines.push(b.positions.length ? "Perp positions:" : "No perp positions.");
  for (const p of b.positions) {
    lines.push(`- ${p.coin} ${p.size > 0 ? "LONG" : "SHORT"} ${fmtSz(Math.abs(p.size))} @ $${p.entryPx} · ${p.leverage}× · value ${usd(p.positionValue)} · PnL ${usd(p.unrealizedPnl)} · liq ${p.liquidationPx ? `$${p.liquidationPx}` : "-"}`);
  }
  if (b.spot.length) lines.push("Spot tokens:", ...b.spot.map((h) => `- ${h.coin} ${fmtSz(h.total)} (${usd(h.usd)})`));
  if (b.orders.length) lines.push("Open orders:", ...b.orders.map((o) => `- #${o.oid} ${o.coin} ${o.side} ${fmtSz(o.size)} @ $${o.limitPx}`));
  return lines.join("\n");
}

// ───────────────────────────── orders ─────────────────────────────

export type OrderArgs = {
  market: string;
  side: "buy" | "sell";
  /** in the market's base asset (e.g. BTC); or give usd */
  size?: number;
  usd?: number;
  type: "market" | "limit";
  price?: number;
  leverage?: number;
  reduceOnly?: boolean;
  tif?: "Gtc" | "Ioc" | "Alo";
};

const describe = (m: Market, side: "buy" | "sell", reduceOnly: boolean) =>
  m.kind === "spot" ? (side === "buy" ? `Bought ${m.name.split("/")[0]}` : `Sold ${m.name.split("/")[0]}`)
    : reduceOnly ? `Reduced ${m.name}` : side === "buy" ? `Long ${m.name}` : `Short ${m.name}`;

async function resultText(c: Company, m: Market, a: OrderArgs, lev: number, r: TradeResult): Promise<string> {
  const reduceOnly = !!a.reduceOnly;
  if (r.status === "filled") {
    const notional = r.size * r.avgPx;
    const what = `${describe(m, a.side, reduceOnly)}${m.kind === "perp" && !reduceOnly ? ` ${lev}×` : ""}: ${fmtSz(r.size)} @ $${r.avgPx}`;
    await record(c.id, "TRADE", 0, `${what} (${usd(notional)}) on Hyperliquid`.slice(0, 300), null, String(r.oid));
    await emit(c.id, "TREASURY", what, `${usd(notional)} on Hyperliquid${m.kind === "perp" ? " perps" : " spot"}.`);
    return `filled: ${what} (${usd(notional)})`;
  }
  if (r.status === "resting") {
    await emit(c.id, "TREASURY", `Placed ${a.side} order on ${m.name}`, `${a.size ?? ""} @ $${a.price} (order #${r.oid})`.trim());
    return `order #${r.oid} is resting on the book: ${a.side} ${m.name} @ $${a.price}`;
  }
  return `not filled: ${r.reason}`;
}

/** Move USDC from spot to perps when a perp order needs more margin than is free there. */
async function ensurePerpMargin(c: Company, b: Book, marginUsd: number) {
  const need = marginUsd * 1.05 - b.perpWithdrawable;
  if (need <= 0) return;
  const amount = Math.ceil(need + 1);
  if (b.spotUsdc < amount) return; // let Hyperliquid report insufficient margin
  try {
    await hlExecute(c, { kind: "class-transfer", usd: amount, toPerp: true });
  } catch (e) {
    // unified/portfolio-margin accounts share one balance and reject class transfers; nothing to do then
    if (!/unified|abstraction|portfolio/i.test((e as Error).message)) throw e;
  }
}

export async function placeOrder(c: Company, a: OrderArgs): Promise<string> {
  const m = await findMarket(a.market);
  if (!m) return `error: unknown market "${a.market}". Use hl_markets to find one (perps like BTC, spot like HYPE/USDC).`;
  if (a.side !== "buy" && a.side !== "sell") return "error: side must be buy or sell";
  const reduceOnly = m.kind === "perp" && !!a.reduceOnly;
  const mid = (await mids())[m.coin] ?? m.midPx;
  if (!(mid > 0)) return `error: no price for ${m.name} right now`;

  let px: number;
  let tif: "Gtc" | "Ioc" | "Alo";
  if (a.type === "market") {
    const s = env.hlMaxSlippageBps / 10_000;
    px = a.side === "buy" ? mid * (1 + s) : mid * (1 - s);
    tif = "Ioc";
  } else {
    if (!(Number(a.price) > 0)) return "error: limit orders need a price";
    px = Number(a.price);
    tif = a.tif ?? "Gtc";
  }
  const price = formatPrice(px, m.szDecimals, m.kind, a.type === "market" ? (a.side === "buy" ? "up" : "down") : "nearest");
  const rawSize = a.size ?? (a.usd ? a.usd / (a.type === "market" ? mid : px) : 0);
  const size = roundSize(rawSize, m.szDecimals);
  if (!(Number(size) > 0)) return `error: size rounds to zero (${m.name} trades in steps of ${10 ** -m.szDecimals})`;
  const notional = Number(size) * (a.type === "market" ? mid : Number(price));
  const lev = m.kind === "perp" ? Math.round(a.leverage ?? 1) : 1;

  const b = await book(c);
  const heldBase = m.kind === "spot" ? (b.spot.find((h) => h.coin === m.name.split("/")[0])?.total ?? 0) : 0;
  const v = checkOrder({
    market: { kind: m.kind, name: m.name, maxLeverage: m.maxLeverage }, side: a.side, reduceOnly, notionalUsd: notional, leverage: lev,
    closesExposure: m.kind === "spot" && a.side === "sell" && heldBase >= Number(size),
    equityUsd: b.equityUsd, atRiskUsd: b.atRiskUsd, dayStartEquityUsd: b.dayStartEquityUsd, dayLossUsd: b.dayLossUsd,
  }, riskLimits());
  if (!v.ok) return `error: ${v.reason}`;

  if (m.kind === "perp" && !reduceOnly) {
    await hlTrade(c, { kind: "leverage", asset: m.asset, leverage: lev });
    await ensurePerpMargin(c, b, notional / lev);
  }
  const r = await hlTrade(c, { kind: "order", asset: m.asset, isBuy: a.side === "buy", size, price, tif, reduceOnly });
  return resultText(c, m, { ...a, size: Number(size), price: Number(price) }, lev, r);
}

export async function cancelOrder(c: Company, market: string, oid: number): Promise<string> {
  const m = await findMarket(market);
  if (!m) return `error: unknown market "${market}"`;
  await hlTrade(c, { kind: "cancel", asset: m.asset, oid: Math.trunc(oid) });
  return `cancelled order #${oid} on ${m.name}`;
}

/** Close a whole perp position (reduce-only) or sell all of a spot token, at market. Always allowed. */
export async function closePosition(c: Company, market: string): Promise<string> {
  const m = await findMarket(market);
  if (!m) return `error: unknown market "${market}"`;
  const b = await book(c);
  if (m.kind === "perp") {
    const p = b.positions.find((x) => x.coin === m.coin);
    if (!p || p.size === 0) return `no open ${m.name} position`;
    return placeOrder(c, { market: m.name, side: p.size > 0 ? "sell" : "buy", size: Math.abs(p.size), type: "market", reduceOnly: true });
  }
  const h = b.spot.find((x) => x.coin === m.name.split("/")[0]);
  if (!h || h.total <= 0) return `you hold no ${m.name.split("/")[0]}`;
  return placeOrder(c, { market: m.name, side: "sell", size: h.total, type: "market" });
}
