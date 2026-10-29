// Settle a customer payment that arrived on the company's Hyperliquid account: pay the platform's share (and the
// flagship's part of it) in the asset received, convert any HYPE left to USDC, and book the revenue.
import type { Company } from "@/db/schema";
import { env } from "../env";
import { FEES } from "../fees";
import { emit, record } from "../feed";
import { creditFlagship, flagshipSharePct, getFlagship } from "../flagship";
import { bookRevenue } from "../treasury";
import { solPrice } from "./bridge";
import { hlConvert, hlExecute } from "./signer";
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

export async function settleHlPayment(c: Company, p: { asset: "USDC" | "HYPE"; amount: number; ref: string; orderId: string }): Promise<{ usd: number }> {
  let px = 1;
  if (p.asset === "HYPE") {
    const m = await spotMarket("HYPE");
    px = (await mids())[m.name] ?? 0;
  }
  const usd = p.amount * px;
  const flagship = await getFlagship();
  const flag = flagship && flagship.id !== c.id && flagship.hlAddress ? flagship : null;
  const { toFlagship, toPlatform, kept } = splitCut(p.amount, usd, flagshipSharePct(), !!flag, !!env.platformHlWallet);
  const solUsd = await solPrice();
  const lamportsOf = (assetAmt: number) => Math.round(((assetAmt * px) / solUsd) * 1e9);

  if (toFlagship > 0 && flag) {
    const ref = await hlExecute(c, { kind: "spot-send", to: flag.hlAddress!, token: tokenWire(p.asset), amount: units(p.asset, toFlagship) });
    await record(c.id, "PLATFORM_FEE", -lamportsOf(toFlagship), `share of order ${p.orderId} → $${flag.ticker} (${units(p.asset, toFlagship)} ${p.asset})`, ref);
    await creditFlagship(lamportsOf(toFlagship), `${flagshipSharePct()}% of Hypeware's cut from $${c.ticker}`, ref);
  }
  if (toPlatform > 0) {
    const ref = await hlExecute(c, { kind: "spot-send", to: env.platformHlWallet, token: tokenWire(p.asset), amount: units(p.asset, toPlatform) });
    await record(c.id, "PLATFORM_FEE", -lamportsOf(toPlatform), `${FEES.platformRevenueBps / 100}% platform share of order ${p.orderId} (${units(p.asset, toPlatform)} ${p.asset})`, ref);
  }

  // the treasury runs on USDC: sell the HYPE that's left (IOC, never worse than HL_MAX_SLIPPAGE_BPS under mid)
  if (p.asset === "HYPE" && kept > 0 && c.hlAgentApprovedAt) {
    try {
      const m = await spotMarket("HYPE");
      const size = roundSize(kept, m.szDecimals);
      if (Number(size) * px >= 10) {
        const fill = await hlConvert(c, m.asset, { coin: "HYPE", side: "sell", size, limitPx: formatSpotPrice(limitPrice("sell", px, env.hlMaxSlippageBps), m.szDecimals, "up") });
        if (fill.size > 0) await record(c.id, "SWAP", 0, `sold ${fill.size} HYPE from order ${p.orderId} for $${(fill.size * fill.avgPx).toFixed(2)} USDC`, null);
      }
    } catch (e) {
      console.error(`[hl] HYPE → USDC for order ${p.orderId}:`, (e as Error).message.slice(0, 200));
    }
  }

  await bookRevenue(c, lamportsOf(p.amount), p.ref, `order ${p.orderId} (${p.amount} ${p.asset} on Hyperliquid)`, { platformPaid: true });
  await emit(c.id, "TREASURY", `+$${usd.toFixed(2)} — new order`, `Paid ${p.amount} ${p.asset} on Hyperliquid.`);
  return { usd };
}
