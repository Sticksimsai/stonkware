"use client";
import { PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

/** Send SOL from the connected wallet, optionally tagging the tx with a reference key (order payments). */
export async function sendSol(conn: Connection, wallet: WalletContextState, to: string, lamports: number, reference?: string): Promise<string> {
  if (!wallet.publicKey || (!wallet.signTransaction && !wallet.sendTransaction)) throw new Error("Connect a wallet first");
  const ix = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(to), lamports });
  if (reference) ix.keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false });
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  let sig: string;
  if (wallet.signTransaction) {
    // Sign in the wallet, broadcast through Hypeware's RPC: works whichever network the wallet UI is set to.
    const signed = await wallet.signTransaction(tx);
    sig = await conn.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
  } else {
    sig = await wallet.sendTransaction(tx, conn);
  }
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

/** Placeholder address used only in mock mode when no wallet is connected. */
export const MOCK_WALLET = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
