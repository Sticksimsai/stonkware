// Customer payments on Hyperliquid. Two ways to pay, both landing straight in the company's HyperCore account:
//  • hl-core: a USDC or HYPE transfer from the buyer's Hyperliquid account (instant, no gas)
//  • hl-evm:  USDC from HyperEVM through Circle's CoreDepositWallet.depositFor(company, amount, spot)
import { createPublicClient, decodeFunctionData, defineChain, getAddress, http, parseAbi, type PublicClient } from "viem";
import type { Company } from "@/db/schema";
import { env } from "../env";
import { info } from "./client";
import { mids, spotMarket } from "./spot";

/** Verified on-chain 2026-10-30: code present, USDC symbol + 6 decimals, CoreDepositWallet.token() == USDC. */
export const HYPEREVM = {
  mainnet: { chainId: 999, rpc: "https://rpc.hyperliquid.xyz/evm", usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", coreDepositWallet: "0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24" },
  testnet: { chainId: 998, rpc: "https://rpc.hyperliquid-testnet.xyz/evm", usdc: "0x2B3370eE501B4a559b57D449569354196457D8Ab", coreDepositWallet: "0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206" },
} as const;
export const USDC_DECIMALS = 6;
/** destinationDex for HyperCore's spot balance */
export const SPOT_DEX = 0xffffffff;
export const QUOTE_TTL_MS = 15 * 60_000;

export const depositAbi = parseAbi([
  "function depositFor(address recipient, uint256 amount, uint32 destinationId)",
  "function deposit(uint256 amount, uint32 destinationDex)",
]);
export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const evmConfig = () => HYPEREVM[env.hlNetwork];

let _pc: PublicClient | null = null;
function evm(): PublicClient {
  if (!_pc) {
    const n = evmConfig();
    const chain = defineChain({ id: n.chainId, name: `HyperEVM ${env.hlNetwork}`, nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [env.hyperEvmRpc || n.rpc] } } });
    _pc = createPublicClient({ chain, transport: http() }) as PublicClient;
  }
  return _pc;
}

export type PayMethod = "sol" | "hl-core" | "hl-evm";
export type PayAsset = "SOL" | "USDC" | "HYPE";

export function paymentsEnabled() {
  return env.hlPayments;
}

/** Which ways a company can be paid right now. */
export function methodsFor(c: Pick<Company, "hlAddress">): { method: PayMethod; asset: PayAsset }[] {
  const out: { method: PayMethod; asset: PayAsset }[] = [];
  if (env.solCheckout || !paymentsEnabled() || !c.hlAddress) out.push({ method: "sol", asset: "SOL" });
  if (paymentsEnabled() && c.hlAddress) {
    out.push({ method: "hl-core", asset: "USDC" }, { method: "hl-core", asset: "HYPE" }, { method: "hl-evm", asset: "USDC" });
  }
  return out;
}

/** Round up so the buyer never pays less than the price. */
export function ceilDecimal(x: number, decimals: number): string {
  const f = 10 ** decimals;
  const v = Math.ceil(x * f - 1e-9) / f;
  const s = v.toFixed(decimals);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Amount to pay for `usd`, in the asset's units. HYPE is priced at Hyperliquid's HYPE/USDC mid. */
export async function quote(asset: "USDC" | "HYPE", usd: number): Promise<{ amount: string; px: number }> {
  if (!(usd > 0)) throw new Error("price must be positive");
  if (asset === "USDC") return { amount: ceilDecimal(usd, USDC_DECIMALS), px: 1 };
  const m = await spotMarket("HYPE");
  const px = (await mids())[m.name];
  if (!(px > 0)) throw new Error("no HYPE price right now");
  return { amount: ceilDecimal(usd / px, 4), px }; // HYPE spot moves in 0.01, but transfers accept more precision
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Pure check of a decoded depositFor call against the order. Exported for tests. */
export function checkEvmDeposit(p: { status: string; from: string; to: string | null; input: `0x${string}`; buyer: string; recipient: string; minUnits: bigint }): bigint {
  if (p.status !== "success") throw new Error("the HyperEVM transaction failed");
  if (!p.to || !same(p.to, evmConfig().coreDepositWallet)) throw new Error("that transaction isn't a USDC deposit to Hyperliquid");
  if (!same(p.from, p.buyer)) throw new Error("the payment came from a different wallet than the order's");
  let d;
  try { d = decodeFunctionData({ abi: depositAbi, data: p.input }); } catch { throw new Error("unrecognised deposit call"); }
  if (d.functionName !== "depositFor") throw new Error("the deposit must be made for the company (depositFor), not to your own account");
  const [recipient, amount] = d.args as readonly [string, bigint, number];
  if (!same(recipient, p.recipient)) throw new Error("the deposit went to a different Hyperliquid account");
  if (amount < p.minUnits) throw new Error("payment amount too low");
  return amount;
}

/** Verify a HyperEVM depositFor tx. Returns the USDC amount (6-decimal units). */
export async function verifyEvmDeposit(txHash: string, buyer: string, recipient: string, minUnits: bigint): Promise<bigint> {
  if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw new Error("invalid transaction hash");
  const hash = txHash as `0x${string}`;
  const receipt = await evm().getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) throw new Error("payment not found yet — wait a few seconds and retry");
  const tx = await evm().getTransaction({ hash });
  return checkEvmDeposit({ status: receipt.status, from: tx.from, to: tx.to, input: tx.input, buyer, recipient, minUnits });
}

export type LedgerTransfer = { time: number; hash: string; delta: { type: string; user?: string; destination?: string; token?: string; amount?: string; usdc?: string } };

/** Pure: pick the buyer's transfer to the company from the company's ledger updates. Exported for tests. */
export function findCoreTransfer(updates: LedgerTransfer[], p: { buyer: string; recipient: string; asset: "USDC" | "HYPE"; min: number; since: number; hash?: string; used: Set<string> }): LedgerTransfer | null {
  const ok = updates.filter((u) => {
    const d = u.delta;
    if (u.time < p.since || p.used.has(u.hash.toLowerCase())) return false;
    if (d.type !== "spotTransfer" && d.type !== "send" && d.type !== "internalTransfer") return false;
    if (!d.user || !d.destination || !same(d.user, p.buyer) || !same(d.destination, p.recipient)) return false;
    // internalTransfer = USDC sent from a perps balance (older ledger format: amount in `usdc`)
    const token = d.type === "internalTransfer" ? "USDC" : (d.token ?? "").split(":")[0].toUpperCase();
    if (token !== p.asset) return false;
    return Number(d.amount ?? d.usdc) + 1e-9 >= p.min;
  });
  if (p.hash) return ok.find((u) => same(u.hash, p.hash!)) ?? null;
  return ok.sort((a, b) => a.time - b.time)[0] ?? null;
}

/** Verify a transfer from the buyer's Hyperliquid account to the company's. */
export async function verifyCoreTransfer(p: { buyer: string; recipient: string; asset: "USDC" | "HYPE"; min: number; since: number; hash?: string; used: Set<string> }): Promise<{ hash: string; amount: number }> {
  const updates = (await info().userNonFundingLedgerUpdates({ user: p.recipient as `0x${string}`, startTime: p.since })) as unknown as LedgerTransfer[];
  const hit = findCoreTransfer(updates, p);
  if (!hit) throw new Error("payment not found yet — wait a few seconds and retry");
  return { hash: hit.hash, amount: Number(hit.delta.amount ?? hit.delta.usdc) };
}

export const normalizeEvm = (a: string) => getAddress(a);
