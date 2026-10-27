// Proves a request comes from the company's creator: they sign a short, timestamped message
// with the wallet that launched the company (Phantom/Solflare "Sign message", no transaction).
import nacl from "tweetnacl";
import bs58 from "bs58";
import type { Company } from "@/db/schema";
import { isLive } from "./env";

export const creatorMessage = (action: string, ticker: string, ts: number) => `Stonkware: ${action} for $${ticker}\ntime: ${ts}`;

export function verifyCreator(c: Company, p: { wallet?: string; signature?: string; ts?: number; action: string }) {
  if (!isLive() && process.env.ALLOW_MOCK_CONNECT === "1" && p.signature === "mock") return; // local dev only
  if (!p.wallet || p.wallet !== c.creatorWallet) throw Object.assign(new Error("only the creator's wallet can do this"), { status: 403 });
  const ts = Number(p.ts);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60_000) throw Object.assign(new Error("signature expired, sign again"), { status: 401 });
  let sig: Uint8Array;
  try { sig = bs58.decode(String(p.signature)); } catch { throw Object.assign(new Error("bad signature"), { status: 401 }); }
  const ok = nacl.sign.detached.verify(new TextEncoder().encode(creatorMessage(p.action, c.ticker, ts)), sig, bs58.decode(c.creatorWallet));
  if (!ok) throw Object.assign(new Error("signature doesn't match the creator wallet"), { status: 401 });
}
