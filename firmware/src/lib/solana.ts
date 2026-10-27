import { Connection, PublicKey } from "@solana/web3.js";
import { env } from "./env";

let _conn: Connection | null = null;
export function connection(): Connection {
  if (!_conn) _conn = new Connection(env.rpcUrl, "confirmed");
  return _conn;
}

/** True for any syntactically valid 32-byte base58 address. */
export function isAddress(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    return new PublicKey(s).toBytes().length === 32;
  } catch {
    return false;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
