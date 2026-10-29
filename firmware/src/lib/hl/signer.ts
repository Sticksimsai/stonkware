// The Hyperliquid signer. With src/lib/signer.ts (Solana), this is the ONLY place that decrypts keys.
// Every master-key action passes checkHlIntent first. Orders, leverage and cancels are signed with the API wallet only.
import { randomBytes } from "crypto";
import { ExchangeClient } from "@nktkas/hyperliquid";
import { bytesToHex, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { env, isLive } from "../env";
import { open, seal } from "../vault";
import { transport } from "./client";
import { checkConvert, checkHlIntent, checkTrade, HlRefusal, usdString, type ConvertIntent, type HlIntent, type TradeIntent } from "./policy";

/** A fresh EVM key; only the address and the sealed secret leave this function. */
export function newSealedEvmKey(): { address: string; sealed: string } {
  const pk = generatePrivateKey();
  return { address: privateKeyToAccount(pk).address, sealed: seal(hexToBytes(pk)) };
}

function unseal(sealed: string, expected: string): PrivateKeyAccount {
  const account = privateKeyToAccount(bytesToHex(open(sealed)));
  if (account.address.toLowerCase() !== expected.toLowerCase()) throw new HlRefusal("sealed key does not match its address");
  return account;
}

export type HlAccount = {
  hlAddress: string | null;
  hlSecretEnc: string | null;
  hlAgentAddress: string | null;
};
export type HlAgentAccount = HlAccount & { hlAgentSecretEnc: string | null; hlAgentApprovedAt: Date | null };

const mockId = () => `mockhl_${randomBytes(12).toString("hex")}`;

/**
 * Sign and send one master-key action. Returns a reference for the ledger (Hyperliquid doesn't return a tx hash
 * for these actions, so it's "hl:<kind>:<nonce-ish time>"; mock mode returns a mock id).
 */
export async function hlExecute(c: HlAccount, intent: HlIntent): Promise<string> {
  if (!c.hlAddress || !c.hlSecretEnc) throw new HlRefusal("company has no Hyperliquid account");
  checkHlIntent(intent, { self: c.hlAddress, agent: c.hlAgentAddress, maxTransferUsd: env.hlMaxTransferUsd });
  if (!isLive()) return mockId();

  const exchange = new ExchangeClient({ transport: transport(), wallet: unseal(c.hlSecretEnc, c.hlAddress) });
  const to = (a: string) => a as `0x${string}`;
  switch (intent.kind) {
    case "approve-agent":
      await exchange.approveAgent({ agentAddress: to(intent.agent), agentName: intent.name });
      break;
    case "usd-send":
      await exchange.usdSend({ destination: to(intent.to), amount: usdString(intent.usd) });
      break;
    case "spot-send":
      await exchange.spotSend({ destination: to(intent.to), token: intent.token, amount: intent.amount });
      break;
    case "class-transfer":
      await exchange.usdClassTransfer({ amount: usdString(intent.usd), toPerp: intent.toPerp });
      break;
    case "withdraw":
      await exchange.withdraw3({ destination: to(intent.to), amount: usdString(intent.usd) });
      break;
  }
  return `hl:${intent.kind}:${Date.now()}`;
}

export type Fill = { size: number; avgPx: number };

/**
 * Convert between a treasury token and USDC with an immediate-or-cancel order signed by the API wallet (which can
 * trade but never withdraw). Returns what filled; an order that can't fill within `limitPx` fills nothing.
 */
export async function hlConvert(c: HlAgentAccount, asset: number, intent: ConvertIntent): Promise<Fill> {
  if (!c.hlAddress || !c.hlAgentAddress || !c.hlAgentSecretEnc) throw new HlRefusal("company has no API wallet");
  if (!c.hlAgentApprovedAt) throw new HlRefusal("API wallet not approved yet");
  if (!Number.isInteger(asset) || asset < 10_000) throw new HlRefusal("conversions are spot-only");
  checkConvert(intent);
  if (!isLive()) return { size: Number(intent.size), avgPx: Number(intent.limitPx) };

  const exchange = new ExchangeClient({ transport: transport(), wallet: unseal(c.hlAgentSecretEnc, c.hlAgentAddress) });
  try {
    const r = await exchange.order({
      orders: [{ a: asset, b: intent.side === "buy", p: intent.limitPx, s: intent.size, r: false, t: { limit: { tif: "Ioc" } } }],
      grouping: "na",
    });
    const st = r.response.data.statuses[0] as { filled?: { totalSz: string; avgPx: string }; error?: string } | undefined;
    if (st?.filled) return { size: Number(st.filled.totalSz), avgPx: Number(st.filled.avgPx) };
    if (st?.error && !/could not immediately match/i.test(st.error)) throw new Error(st.error);
    return { size: 0, avgPx: 0 };
  } catch (e) {
    // an IOC order that finds no liquidity within the limit is "no fill", not a failure
    if (/could not immediately match/i.test((e as Error).message)) return { size: 0, avgPx: 0 };
    throw e;
  }
}

export type TradeResult =
  | { status: "filled"; size: number; avgPx: number; oid: number }
  | { status: "resting"; oid: number }
  | { status: "none"; reason: string };

function agentExchange(c: HlAgentAccount): ExchangeClient {
  if (!c.hlAddress || !c.hlAgentAddress || !c.hlAgentSecretEnc) throw new HlRefusal("company has no API wallet");
  if (!c.hlAgentApprovedAt) throw new HlRefusal("API wallet not approved yet");
  return new ExchangeClient({ transport: transport(), wallet: unseal(c.hlAgentSecretEnc, c.hlAgentAddress) });
}

/** Agent trading: orders, isolated leverage, cancels. API wallet only, so nothing here can move funds out. */
export async function hlTrade(c: HlAgentAccount, t: TradeIntent): Promise<TradeResult> {
  checkTrade(t);
  if (!isLive()) {
    if (t.kind === "order") return t.tif === "Ioc" ? { status: "filled", size: Number(t.size), avgPx: Number(t.price), oid: Date.now() } : { status: "resting", oid: Date.now() };
    return { status: "none", reason: "mock" };
  }
  const exchange = agentExchange(c);
  if (t.kind === "leverage") {
    await exchange.updateLeverage({ asset: t.asset, isCross: false, leverage: t.leverage });
    return { status: "none", reason: "leverage set" };
  }
  if (t.kind === "cancel") {
    await exchange.cancel({ cancels: [{ a: t.asset, o: t.oid }] });
    return { status: "none", reason: "cancelled" };
  }
  try {
    const r = await exchange.order({
      orders: [{ a: t.asset, b: t.isBuy, p: t.price, s: t.size, r: t.reduceOnly, t: { limit: { tif: t.tif } } }],
      grouping: "na",
    });
    const st = r.response.data.statuses[0] as { filled?: { totalSz: string; avgPx: string; oid: number }; resting?: { oid: number }; error?: string } | undefined;
    if (st?.filled) return { status: "filled", size: Number(st.filled.totalSz), avgPx: Number(st.filled.avgPx), oid: st.filled.oid };
    if (st?.resting) return { status: "resting", oid: st.resting.oid };
    return { status: "none", reason: st?.error ?? "no fill" };
  } catch (e) {
    const m = (e as Error).message;
    if (/could not immediately match/i.test(m)) return { status: "none", reason: "no liquidity within your price" };
    throw e;
  }
}
