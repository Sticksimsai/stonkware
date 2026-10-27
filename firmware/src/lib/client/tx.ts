"use client";
import { PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

/** Send SOL from the connected wallet, optionally tagging the tx with a reference key. */
export async function sendSol(conn: Connection, wallet: WalletContextState, to: string, lamports: number, reference?: string): Promise<string> {
  if (!wallet.publicKey || !wallet.sendTransaction) throw new Error("Connect a wallet first");
  const ix = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(to), lamports });
  if (reference) ix.keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false });
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const sig = await wallet.sendTransaction(tx, conn);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

/** Sign a UTF-8 message with the connected wallet, returning base58. */
export async function signMessage(wallet: WalletContextState, message: string): Promise<string> {
  if (!wallet.signMessage) throw new Error("This wallet cannot sign messages");
  const bs58 = (await import("bs58")).default;
  return bs58.encode(await wallet.signMessage(new TextEncoder().encode(message)));
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}

/** A syntactically valid placeholder address used only in mock mode when no wallet is connected. */
export const MOCK_WALLET = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
