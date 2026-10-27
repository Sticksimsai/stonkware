// DEVNET ONLY: buy a company's token on its bonding curve to generate trading fees for testing.
// Jupiter and DEX screeners don't index devnet, so this is how you "trade" while testing.
//   npm run devnet:trade -- <ticker|slug> [solPerBuy=0.1] [buys=3]
// Pays with PARTNER_KEYPAIR (or TRADER_KEYPAIR if set).
import "./_env";
import { existsSync, readFileSync } from "fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import { partnerKeypair } from "./_env";

(async () => {
  const rpc = process.env.SOLANA_RPC_URL || "";
  if (!rpc.includes("devnet")) throw new Error("Refusing to run: SOLANA_RPC_URL is not a devnet endpoint.");
  const [who, solArg, nArg] = process.argv.slice(2);
  if (!who) throw new Error("usage: npm run devnet:trade -- <ticker|slug> [solPerBuy] [buys]");
  const { db, schema } = await import("../src/db");
  const { eq, or } = await import("drizzle-orm");
  const { poolInfo, buildCurveBuyTx } = await import("../src/lib/meteora");
  const c = await db.query.companies.findFirst({ where: or(eq(schema.companies.slug, who.toLowerCase()), eq(schema.companies.ticker, who.toUpperCase())) });
  if (!c) throw new Error(`no company ${who}`);
  const conn = new Connection(rpc, "confirmed");
  const info = await poolInfo(conn, c.mintPubkey);
  if (!info) throw new Error(`$${c.ticker} has no pool on devnet yet (launch status: ${c.status})`);
  const t = process.env.TRADER_KEYPAIR;
  const trader = t && existsSync(t) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(t, "utf8")))) : partnerKeypair();
  const lamports = Math.round(Number(solArg || 0.1) * LAMPORTS_PER_SOL);
  const n = Number(nArg || 3);
  console.log(`buying $${c.ticker} ${n}× ${lamports / LAMPORTS_PER_SOL} SOL from ${trader.publicKey.toBase58()}`);
  for (let i = 0; i < n; i++) {
    const tx = await buildCurveBuyTx(conn, trader.publicKey.toBase58(), info.pool, lamports);
    const sig = await sendAndConfirmTransaction(conn, tx, [trader], { commitment: "confirmed" });
    console.log(`✓ buy ${i + 1}/${n}  https://solscan.io/tx/${sig}?cluster=devnet`);
  }
  const after = await poolInfo(conn, c.mintPubkey);
  console.log(`unclaimed creator fees now ${((after?.unclaimedCreatorLamports ?? 0) / LAMPORTS_PER_SOL).toFixed(5)} SOL (claimed into the treasury every CLAIM_EVERY_MIN)`);
  process.exit(0);
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
