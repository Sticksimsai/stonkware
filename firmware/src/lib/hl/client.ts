// Read-only Hyperliquid access (no keys). Mock mode never touches the network.
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { env, isLive } from "../env";

let _transport: HttpTransport | null = null;
let _info: InfoClient | null = null;

export function transport(): HttpTransport {
  if (!_transport) {
    _transport = new HttpTransport({ isTestnet: env.hlNetwork === "testnet", ...(env.hlApiUrl ? { apiUrl: env.hlApiUrl } : {}) });
  }
  return _transport;
}

export function info(): InfoClient {
  if (!_info) _info = new InfoClient({ transport: transport() });
  return _info;
}

export type HlBalance = {
  /** spot USDC + perps account value: what the company can spend */
  usd: number;
  spotUsdc: number;
  perpValue: number;
  /** perps USDC that is free to move (not used as margin) */
  withdrawable: number;
  /** other spot tokens held, e.g. uSOL arriving from Solana */
  spot: { coin: string; total: number }[];
};

export const EMPTY_BALANCE: HlBalance = { usd: 0, spotUsdc: 0, perpValue: 0, withdrawable: 0, spot: [] };

export async function hlBalance(address: string): Promise<HlBalance> {
  if (!isLive()) return EMPTY_BALANCE;
  const user = address as `0x${string}`;
  const [perp, spot] = await Promise.all([info().clearinghouseState({ user }), info().spotClearinghouseState({ user })]);
  const balances = spot.balances.map((b) => ({ coin: String(b.coin), total: Number(b.total) })).filter((b) => b.total > 0);
  const spotUsdc = balances.find((b) => b.coin === "USDC")?.total ?? 0;
  const perpValue = Number(perp.marginSummary.accountValue);
  return { usd: spotUsdc + perpValue, spotUsdc, perpValue, withdrawable: Number(perp.withdrawable), spot: balances.filter((b) => b.coin !== "USDC") };
}

/** Hyperliquid only knows an address once it has received funds; before that it can't approve an API wallet. */
export async function accountExists(address: string): Promise<boolean> {
  if (!isLive()) return true;
  const r = await info().userRole({ user: address as `0x${string}` });
  return r.role !== "missing";
}

export async function agentIsApproved(user: string, agent: string): Promise<boolean> {
  if (!isLive()) return true;
  const list = await info().extraAgents({ user: user as `0x${string}` });
  return list.some((a) => a.address.toLowerCase() === agent.toLowerCase() && (a.validUntil == null || a.validUntil > Date.now()));
}
