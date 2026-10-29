// Tiny .env loader + partner keypair loader shared by scripts.
import { readFileSync, existsSync } from "fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// .env.local first (secrets kept out of git), then .env; real environment variables always win.
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/** PARTNER_KEYPAIR: path to a solana-keygen JSON file, or a base58 secret key. */
export function partnerKeypair(): Keypair {
  const v = process.env.PARTNER_KEYPAIR;
  if (!v) throw new Error("Set PARTNER_KEYPAIR (path to keypair JSON or base58 secret). This wallet is Hypeware's DBC partner / fee claimer.");
  if (existsSync(v)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(v, "utf8"))));
  return Keypair.fromSecretKey(bs58.decode(v));
}
