// Take SOL back from the flagship's treasury to your revenue wallet, leaving a reserve for its shifts.
//   npx tsx scripts/flagship-withdraw.ts                 preview (keeps 0.11 SOL)
//   npx tsx scripts/flagship-withdraw.ts --send          send
//   npx tsx scripts/flagship-withdraw.ts --send --keep 0.5 [--to <address>]
import "./_env";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

(async () => {
  const { env } = await import("../src/lib/env");
  const { getFlagship } = await import("../src/lib/flagship");
  const { treasuryBalance } = await import("../src/lib/treasury");
  const { priorityMicroLamports, transferFeeLamports, transferFromTreasury } = await import("../src/lib/signer");
  const { record, emit } = await import("../src/lib/feed");
  const { isAddress } = await import("../src/lib/solana");
  const f = await getFlagship(true);
  if (!f) throw new Error("no flagship");
  const to = flag("to") || env.platformFeeWallet;
  if (!to || !isAddress(to)) throw new Error("no valid destination (set PLATFORM_FEE_WALLET or pass --to)");
  const keep = Math.round(Number(flag("keep") ?? 0.11) * 1e9);
  const bal = await treasuryBalance(f);
  const micro = await priorityMicroLamports();
  const amount = keep > 0 ? bal - keep : bal - transferFeeLamports(micro);
  console.log(`$${f.ticker} treasury ${f.treasuryPubkey} holds ${(bal / 1e9).toFixed(4)} SOL`);
  if (keep > 0 && keep < 1_000_000) throw new Error("--keep must be 0 or at least 0.001 SOL");
  if (amount < 1_000_000) { console.log("nothing to withdraw"); process.exit(0); }
  console.log(`→ ${(amount / 1e9).toFixed(4)} SOL to ${to} (leaves ${(Math.max(0, bal - amount) / 1e9).toFixed(4)} SOL for the agent)`);
  if (!args.includes("--send")) { console.log("preview only. Re-run with --send to transfer."); process.exit(0); }
  const sig = await transferFromTreasury(f.treasurySecretEnc, f.treasuryPubkey, to, amount, { microLamports: micro });
  await record(f.id, "WITHDRAW", -amount, `withdrawn by Hypeware to ${to}`, sig);
  await emit(f.id, "TREASURY", `${(amount / 1e9).toFixed(4)} SOL moved to Hypeware's wallet`, "", sig);
  console.log(`✓ sent: https://solscan.io/tx/${sig}`);
  process.exit(0);
})().catch((e) => { const c = (e as { cause?: Error }).cause; console.error(`✗ ${(e as Error).message}${c ? `\n  cause: ${c.message}` : ""}`); process.exit(1); });
