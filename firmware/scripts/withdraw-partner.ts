// Withdraw Stonkware's partner-fee revenue from the partner wallet to your own wallet.
//   npm run withdraw:partner                     preview (sends nothing)
//   npm run withdraw:partner -- --send           send everything above the reserve to PLATFORM_FEE_WALLET
//   npm run withdraw:partner -- --send --to <address> --keep 0.05
// The reserve (default 0.05 SOL) stays behind to pay for future fee-claim transactions.
import "./_env";
import { partnerKeypair } from "./_env";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

(async () => {
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const partner = partnerKeypair();
  const to = new PublicKey(flag("to") || process.env.PLATFORM_FEE_WALLET || "");
  const keep = Math.round(Number(flag("keep") ?? 0.05) * LAMPORTS_PER_SOL);
  const bal = await conn.getBalance(partner.publicKey);
  const amount = bal - keep;
  console.log(`partner wallet ${partner.publicKey.toBase58()} holds ${(bal / 1e9).toFixed(4)} SOL`);
  if (amount < 1_000_000) { console.log(`nothing to withdraw (keeping ${(keep / 1e9).toFixed(3)} SOL for claim fees)`); process.exit(0); }
  console.log(`→ ${(amount / 1e9).toFixed(4)} SOL to ${to.toBase58()} (keeps ${(keep / 1e9).toFixed(3)} SOL)`);
  if (!args.includes("--send")) { console.log("preview only. Re-run with --send to transfer."); process.exit(0); }
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }))
    .add(SystemProgram.transfer({ fromPubkey: partner.publicKey, toPubkey: to, lamports: amount }));
  const sig = await sendAndConfirmTransaction(conn, tx, [partner], { commitment: "confirmed" });
  console.log(`✓ sent: https://solscan.io/tx/${sig}`);
  process.exit(0);
})().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
