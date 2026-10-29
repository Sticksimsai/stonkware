// What a company's Hyperliquid master key may sign. Pure checks, no keys or network: the signer runs
// these before every action, and tests exercise them directly. Orders are not here on purpose: they are
// signed only by the API wallet, which Hyperliquid itself stops from withdrawing or transferring.
import { isAddress } from "viem";

export type Hex = `0x${string}`;

/** Name the API wallet is approved under. Re-approving the same name replaces the previous one. */
export const AGENT_NAME = "hypeware";

export type HlIntent =
  /** Approve the company's own stored API wallet (never an arbitrary address). */
  | { kind: "approve-agent"; agent: string; name: string }
  /** USDC from the perps balance to another Hyperliquid address. */
  | { kind: "usd-send"; to: string; usd: number }
  /** Any spot token to another Hyperliquid address (or a system address to move it to HyperEVM). */
  | { kind: "spot-send"; to: string; token: string; amount: string }
  /** Move USDC between the company's own spot and perps balances. */
  | { kind: "class-transfer"; usd: number; toPerp: boolean }
  /** USDC out to Arbitrum (Hyperliquid charges a $1 fee). */
  | { kind: "withdraw"; to: string; usd: number };

export class HlRefusal extends Error {}

export type PolicyContext = { self: string; agent: string | null; maxTransferUsd: number };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** HyperCore → HyperEVM system addresses: 0x20…<token index> and HYPE's 0x2222…2222. */
export const isSystemAddress = (a: string) => /^0x20[0-9a-f]{38}$/i.test(a) || /^0x(22){20}$/i.test(a);

function addr(a: string, what: string): Hex {
  if (!isAddress(a, { strict: false })) throw new HlRefusal(`${what} is not a valid address`);
  return a as Hex;
}

/** USD amounts go over the wire as decimal strings with at most 6 places (USDC precision). */
export function usdString(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) throw new HlRefusal("amount must be a positive number");
  const s = usd.toFixed(6).replace(/\.?0+$/, "");
  if (s === "0") throw new HlRefusal("amount is below USDC precision");
  return s;
}

function capped(usd: number, ctx: PolicyContext) {
  if (usd > ctx.maxTransferUsd) throw new HlRefusal(`$${usd} exceeds the per-transfer cap of $${ctx.maxTransferUsd}`);
}

function outbound(to: string, ctx: PolicyContext, allowSystem = false) {
  addr(to, "destination");
  if (same(to, ctx.self)) throw new HlRefusal("destination is the company's own account");
  if (ctx.agent && same(to, ctx.agent)) throw new HlRefusal("destination is the company's API wallet");
  if (isSystemAddress(to) && !allowSystem) throw new HlRefusal("system addresses are only allowed for spot-send");
}

/** Throws HlRefusal when the intent is not allowed. */
export function checkHlIntent(intent: HlIntent, ctx: PolicyContext): void {
  addr(ctx.self, "company address");
  switch (intent.kind) {
    case "approve-agent":
      if (!ctx.agent) throw new HlRefusal("company has no API wallet");
      if (!same(addr(intent.agent, "agent"), ctx.agent)) throw new HlRefusal("can only approve the company's own API wallet");
      if (intent.name !== AGENT_NAME) throw new HlRefusal(`API wallet must be named "${AGENT_NAME}"`);
      return;
    case "usd-send":
      outbound(intent.to, ctx);
      usdString(intent.usd);
      capped(intent.usd, ctx);
      return;
    case "spot-send": {
      outbound(intent.to, ctx, true);
      if (!/^[A-Za-z0-9]{1,20}:0x[0-9a-f]{32}$/i.test(intent.token)) throw new HlRefusal("token must look like NAME:0x<token id>");
      const n = Number(intent.amount);
      if (!/^\d+(\.\d+)?$/.test(intent.amount) || !(n > 0)) throw new HlRefusal("amount must be a positive decimal string");
      return;
    }
    case "class-transfer":
      usdString(intent.usd);
      return;
    case "withdraw":
      outbound(intent.to, ctx);
      usdString(intent.usd);
      if (intent.usd <= 1) throw new HlRefusal("withdrawals must be more than the $1 fee");
      capped(intent.usd, ctx);
      return;
    default:
      throw new HlRefusal(`unknown intent ${(intent as { kind: string }).kind}`);
  }
}
