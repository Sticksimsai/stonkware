// Settle a customer payment that arrived on the company's Hyperliquid account: pay the platform's share, keep the
// treasury in USDC, and book the revenue.
//  • FeeSplitter off: the share is paid in the asset received, split between the flagship and the platform wallet.
//  • FeeSplitter on: HYPE is sold for USDC first, the whole share goes to the platform wallet in USDC, and the
//    contract pays the flagship its part on-chain (recorded in platform_revenue until distributed).
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { env } from "../env";
import { FEES } from "../fees";
import { emit, record } from "../feed";
import { creditFlagship, flagshipSharePct, getFlagship } from "../flagship";
import { bookRevenue } from "../treasury";
import { solPrice } from "./bridge";
import { evmUnits, splitterEnabled } from "./fee-splitter";
import { hlConvert, hlExecute, type Fill } from "./signer";
import { formatSpotPrice, limitPrice, mids, roundSize, spotMarket, tokenWire } from "./spot";

/** Below this the platform's share stays with the company (not worth a transfer). */
const MIN_CUT_USD = 0.1;

/** Platform share of a payment, split into the flagship's part and the rest (asset units). Pure; exported for tests. */
export function splitCut(amount: number, usdValue: number, flagshipPct: number, hasFlagship: boolean, hasPlatformWallet: boolean) {
  const cut = (amount * FEES.platformRevenueBps) / 10_000;
  if ((usdValue * FEES.platformRevenueBps) / 10_000 < MIN_CUT_USD) return { toFlagship: 0, toPlatform: 0, kept: amount };
  const toFlagship = hasFlagship ? (cut * flagshipPct) / 100 : 0;
  const toPlatform = hasPlatformWallet ? cut - toFlagship : 0;
  return { toFlagship, toPlatform, kept: amount - toFlagship - toPlatform };
}

const units = (asset: "USDC" | "HYPE", x: number) => roundSize(x, asset === "USDC" ? 6 : 8);

/** Sell HYPE for USDC with the API wallet (IOC, never worse than HL_MAX_SLIPPAGE_BPS under mid). */
async function sellHype(c: Company, amount: number, px: number, orderId: string): Promise<Fill | null> {
  if (!c.hlAgentApprovedAt) return null;
  try {
    const m = await spotMarket("HYPE");
    const size = roundSize(amount, m.szDecimals);
    if (Number(size) * px < 10) return null; // under Hyperliquid's $10 minimum
    const fill = await hlConvert(c, m.asset, { coin: "HYPE", side: "sell", size, limitPx: formatSpotPrice(limitPrice("sell", px, env.hlMaxSlippageBps), m.szDecimals, "up") });
    if (fill.size > 0) await record(c.id, "SWAP", 0, `sold ${fill.size} HYPE from order ${orderId} for $${(fill.size * fill.avgPx).toFixed(2)} USDC`, null);
    return fill.size > 0 ? fill : null;
  } catch (e) {
    console.error(`[hl] HYPE → USDC for order ${orderId}:`, (e as Error).message.slice(0, 200));
    return null;
  }
}

export async function settleHlPayment(c: Company, p: { asset: "USDC" | "HYPE"; amount: number; ref: string; orderId: string }): Promise<{ usd: number }> {
  let px = 1;
  if (p.asset === "HYPE") px = (await mids())[(await spotMarket("HYPE")).name] ?? 0;
  const usd = p.amount * px; // revenue, valued when it arrived
  const viaSplitter = splitterEnabled();

  // what the platform share is taken from
  let asset = p.asset;
  let amount = p.amount;
  let sold = false;
  if (viaSplitter && p.asset === "HYPE") {
    const fill = await sellHype(c, p.amount, px, p.orderId);
    // the share is charged on the full order value; the USDC from the sale covers it (it's ≤ 5%)
    if (fill) { asset = "USDC"; amount = usd; sold = true; }
  }
  // the contract can only split USDC, so a share still in HYPE is split here as before
  const splitHere = !viaSplitter || asset === "HYPE";
  const flagship = await getFlagship();
  const flag = splitHere && flagship && flagship.id !== c.id && flagship.hlAddress ? flagship : null;
  const { toFlagship, toPlatform, kept } = splitCut(amount, asset === "USDC" ? amount : amount * px, flagshipSharePct(), !!flag, !!env.platformHlWallet);
  const solUsd = await solPrice();
  const lamportsOfUsd = (x: number) => Math.round((x / solUsd) * 1e9);
  const assetPx = asset === "USDC" ? 1 : px;

  if (toFlagship > 0 && flag) {
    const ref = await hlExecute(c, { kind: "spot-send", to: flag.hlAddress!, token: tokenWire(asset), amount: units(asset, toFlagship) });
    await record(c.id, "PLATFORM_FEE", -lamportsOfUsd(toFlagship * assetPx), `share of order ${p.orderId} → $${flag.ticker} (${units(asset, toFlagship)} ${asset})`, ref);
    await creditFlagship(lamportsOfUsd(toFlagship * assetPx), `${flagshipSharePct()}% of Hypeware's cut from $${c.ticker}`, ref);
  }
  if (toPlatform > 0) {
    const sendAmt = asset === "USDC" && viaSplitter ? (Number(evmUnits(toPlatform)) / 1e6).toString() : units(asset, toPlatform);
    const ref = await hlExecute(c, { kind: "spot-send", to: env.platformHlWallet, token: tokenWire(asset), amount: sendAmt });
    await record(c.id, "PLATFORM_FEE", -lamportsOfUsd(Number(sendAmt) * assetPx), `${FEES.platformRevenueBps / 100}% platform share of order ${p.orderId} (${sendAmt} ${asset})${viaSplitter && asset === "USDC" ? ", split on-chain by the FeeSplitter" : ""}`, ref);
    if (viaSplitter && asset === "USDC") {
      await db.insert(schema.platformRevenue).values({ companyId: c.id, orderId: p.orderId, units: evmUnits(Number(sendAmt)).toString() });
    }
  }

  // keep the treasury in USDC: sell HYPE that's left (splitter-off path, or a sell that didn't fill above)
  if (p.asset === "HYPE" && !sold && kept > 0) await sellHype(c, kept, px, p.orderId);

  await bookRevenue(c, lamportsOfUsd(usd), p.ref, `order ${p.orderId} (${p.amount} ${p.asset} on Hyperliquid)`, { platformPaid: true });
  await emit(c.id, "TREASURY", `+$${usd.toFixed(2)} — new order`, `Paid ${p.amount} ${p.asset} on Hyperliquid.`);
  return { usd };
}
