"use client";
// Paying on Hyperliquid from a browser EVM wallet (MetaMask, Rabby…): either a transfer from the buyer's
// Hyperliquid account, or USDC from HyperEVM through Circle's CoreDepositWallet.depositFor.
import { createPublicClient, createWalletClient, custom, defineChain, http, parseAbi, type Address, type EIP1193Provider, type Hash } from "viem";

export type HlOrder = {
  id: string; method: "hl-core" | "hl-evm"; asset: "USDC" | "HYPE"; amount: string; usd: number; to: Address; expiresAt: string;
  network: "testnet" | "mainnet"; mode: string; token?: string;
  evm?: { chainId: number; rpc: string; usdc: Address; coreDepositWallet: Address; units: string; destinationDex: number };
};

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const cdw = parseAbi(["function depositFor(address recipient, uint256 amount, uint32 destinationId)"]);

function provider(): EIP1193Provider {
  const eth = typeof window !== "undefined" ? (window as unknown as { ethereum?: EIP1193Provider }).ethereum : undefined;
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask, Rabby or another browser wallet to pay on Hyperliquid.");
  return eth;
}

export const hasEvmWallet = () => typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;

export async function connectEvm(): Promise<Address> {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as Address[];
  if (!accounts?.[0]) throw new Error("Your wallet didn't share an account.");
  return accounts[0];
}

const chain = (id: number, rpc: string) =>
  defineChain({ id, name: id === 999 ? "HyperEVM" : "HyperEVM Testnet", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });

async function useChain(id: number, rpc: string) {
  const eth = provider();
  const hex = `0x${id.toString(16)}` as const;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(err.message ?? "")) throw e;
    const c = chain(id, rpc);
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: c.name, nativeCurrency: c.nativeCurrency, rpcUrls: [rpc] }] });
  }
}

/** USDC on HyperEVM → company's Hyperliquid spot balance. Returns the depositFor tx hash. */
export async function payOnHyperEvm(o: HlOrder, account: Address, step: (s: string) => void): Promise<Hash> {
  const e = o.evm;
  if (!e) throw new Error("missing HyperEVM payment details");
  await useChain(e.chainId, e.rpc);
  const c = chain(e.chainId, e.rpc);
  const pub = createPublicClient({ chain: c, transport: http(e.rpc) });
  const wallet = createWalletClient({ account, chain: c, transport: custom(provider()) });
  const units = BigInt(e.units);
  const bal = await pub.readContract({ address: e.usdc, abi: erc20, functionName: "balanceOf", args: [account] });
  if (bal < units) throw new Error(`You need ${o.amount} USDC on HyperEVM (you have ${(Number(bal) / 1e6).toFixed(2)}).`);
  const allowed = await pub.readContract({ address: e.usdc, abi: erc20, functionName: "allowance", args: [account, e.coreDepositWallet] });
  if (allowed < units) {
    step("Approve USDC in your wallet (1 of 2)…");
    const h = await wallet.writeContract({ address: e.usdc, abi: erc20, functionName: "approve", args: [e.coreDepositWallet, units] });
    step("Waiting for the approval…");
    await pub.waitForTransactionReceipt({ hash: h });
  }
  step(allowed < units ? "Confirm the payment in your wallet (2 of 2)…" : "Confirm the payment in your wallet…");
  const hash = await wallet.writeContract({ address: e.coreDepositWallet, abi: cdw, functionName: "depositFor", args: [o.to, units, e.destinationDex] });
  step("Waiting for HyperEVM to confirm…");
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("The payment transaction failed on HyperEVM.");
  return hash;
}

/** USDC or HYPE from the buyer's Hyperliquid account (a signed spot transfer; no gas). */
export async function payOnHypercore(o: HlOrder, account: Address, step: (s: string) => void): Promise<void> {
  if (!o.token) throw new Error("missing Hyperliquid payment details");
  const { ExchangeClient, HttpTransport, InfoClient } = await import("@nktkas/hyperliquid");
  const transport = new HttpTransport({ isTestnet: o.network === "testnet" });
  const spot = await new InfoClient({ transport }).spotClearinghouseState({ user: account });
  const have = Number(spot.balances.find((b) => b.coin === o.asset)?.total ?? 0);
  if (have < Number(o.amount)) {
    throw new Error(`Your Hyperliquid spot balance has ${have} ${o.asset}; this costs ${o.amount}. Top it up on Hyperliquid${o.asset === "USDC" ? " (or pay with USDC on HyperEVM)" : ""}.`);
  }
  const wallet = createWalletClient({ account, transport: custom(provider()) });
  step("Sign the transfer in your wallet…");
  try {
    await new ExchangeClient({ transport, wallet }).spotSend({ destination: o.to, token: o.token, amount: o.amount });
  } catch (e) {
    const m = (e as Error).message;
    if (/must deposit/i.test(m)) throw new Error("That wallet has no funded Hyperliquid account yet.");
    throw e;
  }
}
