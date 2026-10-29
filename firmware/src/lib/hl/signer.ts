// The Hyperliquid signer. With src/lib/signer.ts (Solana), this is the ONLY place that decrypts keys.
// Every master-key action passes checkHlIntent first. Orders, leverage and cancels are signed with the API wallet only.
import { randomBytes } from "crypto";
import { ExchangeClient } from "@nktkas/hyperliquid";
import { bytesToHex, createPublicClient, createWalletClient, defineChain, hexToBytes, http, parseAbi, parseEventLogs } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { env, isLive } from "../env";
import { open, seal } from "../vault";
import { transport } from "./client";
import { evmConfig } from "./payments";
import { tokenWire } from "./spot";
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

// ───────────────────────────── platform key (FeeSplitter distributions only) ─────────────────────────────

/** HyperCore → HyperEVM system address for USDC (token index 0). Credits the sender's own EVM address. */
export const USDC_SYSTEM_ADDRESS = "0x2000000000000000000000000000000000000000";

/** Seal the platform wallet's private key for PLATFORM_HL_KEY_SEALED. Checks it matches PLATFORM_HL_WALLET. */
export function sealPlatformKey(privateKey: string): { address: string; sealed: string } {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new HlRefusal("private key must be 0x + 64 hex characters");
  const address = privateKeyToAccount(privateKey as `0x${string}`).address;
  if (env.platformHlWallet && address.toLowerCase() !== env.platformHlWallet.toLowerCase()) throw new HlRefusal(`key is for ${address}, not PLATFORM_HL_WALLET`);
  return { address, sealed: seal(hexToBytes(privateKey as `0x${string}`)) };
}

function platformAccount(): PrivateKeyAccount {
  if (!env.platformHlKeySealed || !env.platformHlWallet) throw new HlRefusal("platform Hyperliquid key not configured");
  return unseal(env.platformHlKeySealed, env.platformHlWallet);
}

/** USDC on HyperEVM has 6 decimals and HyperCore 8: anything finer is burned on the way, so only 6-decimal amounts. */
export const isEvmUsdcAmount = (a: string) => /^\d+(\.\d{1,6})?$/.test(a) && Number(a) > 0;

/** Platform: move USDC from its HyperCore spot balance to its own HyperEVM address (the only destination allowed). */
export async function platformUsdcToEvm(amount: string): Promise<string> {
  if (!isEvmUsdcAmount(amount)) throw new HlRefusal("amount must be positive with at most 6 decimals");
  if (!isLive()) return mockId();
  const exchange = new ExchangeClient({ transport: transport(), wallet: platformAccount() });
  await exchange.spotSend({ destination: USDC_SYSTEM_ADDRESS, token: tokenWire("USDC"), amount });
  return `hl:usdc-to-evm:${Date.now()}`;
}

const splitterAbi = parseAbi([
  "function distribute(bytes32 ref) returns (uint256 toFlagship, uint256 toPlatform)",
  "event Distributed(bytes32 indexed ref, uint256 amount, uint256 toFlagship, uint256 toPlatform)",
]);
const usdcAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/** Platform: hand `units` USDC to the FeeSplitter and run distribute(ref). Fixed contract calls only. */
export async function platformDistribute(units: bigint, ref: `0x${string}`): Promise<{ transferTx: string; distributeTx: string; toFlagship: bigint; toPlatform: bigint }> {
  if (!env.feeSplitter) throw new HlRefusal("FEE_SPLITTER_ADDRESS not set");
  if (units <= 0n) throw new HlRefusal("nothing to distribute");
  if (!isLive()) return { transferTx: mockId(), distributeTx: mockId(), toFlagship: units / 2n, toPlatform: units - units / 2n };
  const n = evmConfig();
  const chain = defineChain({ id: n.chainId, name: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [env.hyperEvmRpc || n.rpc] } } });
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account: platformAccount(), chain, transport: http() });
  const splitter = env.feeSplitter as `0x${string}`;
  const transferTx = await wallet.writeContract({ address: n.usdc as `0x${string}`, abi: usdcAbi, functionName: "transfer", args: [splitter, units] });
  if ((await pub.waitForTransactionReceipt({ hash: transferTx })).status !== "success") throw new Error("USDC transfer to the FeeSplitter failed");
  const distributeTx = await wallet.writeContract({ address: splitter, abi: splitterAbi, functionName: "distribute", args: [ref] });
  const r = await pub.waitForTransactionReceipt({ hash: distributeTx });
  if (r.status !== "success") throw new Error("FeeSplitter.distribute failed");
  const ev = parseEventLogs({ abi: splitterAbi, logs: r.logs, eventName: "Distributed" }).find((l) => l.address.toLowerCase() === splitter.toLowerCase());
  if (!ev) throw new Error("no Distributed event in the receipt");
  return { transferTx, distributeTx, toFlagship: ev.args.toFlagship, toPlatform: ev.args.toPlatform };
}
