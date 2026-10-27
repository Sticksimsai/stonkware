// End-to-end check of the Meteora integration on DEVNET, using throwaway keys.
// Exercises exactly the code paths Stonkware uses in live mode (and the signer's inspection rules):
//   create config → create pool with dev buy → buy on curve → read fee metrics → claim creator fees
//
//   SOLANA_RPC_URL=https://api.devnet.solana.com PARTNER_KEYPAIR=~/.config/solana/devnet.json npm run meteora:smoke
// The partner keypair needs ~2 devnet SOL (solana airdrop 2 --url devnet).
import "./_env";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { partnerKeypair } from "./_env";

(async () => {
  const rpc = process.env.SOLANA_RPC_URL || "";
  if (!rpc.includes("devnet")) throw new Error("Refusing to run: set SOLANA_RPC_URL to a devnet endpoint.");
  const { WSOL, buildFirmwareConfig, dbc, buildCreatePoolTx, poolInfo, buildCurveBuyTx, buildClaimCreatorFeeTx } = await import("../src/lib/meteora");
  const { inspect } = await import("../src/lib/signer");
  const conn = new Connection(rpc, "confirmed");
  const partner = partnerKeypair();
  const treasury = Keypair.generate();
  const mint = Keypair.generate();
  const send = async (tx: Transaction, signers: Keypair[], label: string, intent?: Parameters<typeof inspect>[3]) => {
    if (intent) {
      tx.feePayer = treasury.publicKey;
      inspect(treasury.publicKey, tx.instructions, treasury.publicKey, intent); // must pass Stonkware's signer rules
    }
    const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
    console.log(`✓ ${label}  ${sig}`);
    return sig;
  };

  // 1. config (reuse DBC_CONFIG if given)
  let config = process.env.DBC_CONFIG;
  if (!config) {
    const kp = Keypair.generate();
    const tx = await dbc(conn).partner.createConfig({ ...buildFirmwareConfig(), config: kp.publicKey, feeClaimer: partner.publicKey, leftoverReceiver: partner.publicKey, quoteMint: WSOL, payer: partner.publicKey });
    await send(tx, [partner, kp], "create config");
    config = kp.publicKey.toBase58();
  }

  // 2. fund the throwaway treasury
  await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: partner.publicKey, toPubkey: treasury.publicKey, lamports: 0.5 * LAMPORTS_PER_SOL })), [partner], "fund treasury 0.5 SOL");

  // 3. launch: pool + dev buy, treasury is creator
  const devBuy = 0.05 * LAMPORTS_PER_SOL;
  const create = await buildCreatePoolTx(conn, { config, treasury: treasury.publicKey.toBase58(), mint: mint.publicKey.toBase58(), name: "Stonkware Smoke", symbol: "SMOKE", uri: "https://example.com/meta.json", devBuyLamports: devBuy });
  await send(create, [treasury, mint], "create pool + dev buy", { kind: "launch", maxTopLevelSolOut: devBuy + 60_000_000 });

  const info = await poolInfo(conn, mint.publicKey.toBase58());
  if (!info) throw new Error("pool not found after creation");
  console.log(`  pool ${info.pool.toBase58()} migrated=${info.migrated}`);

  // 4. buyback on the curve (generates trading fees)
  const buy = 0.1 * LAMPORTS_PER_SOL;
  await send(await buildCurveBuyTx(conn, treasury.publicKey.toBase58(), info.pool, buy), [treasury], "buy on curve", { kind: "trade", maxTopLevelSolOut: buy + 5_000_000 });

  // 5. fees
  const after = await poolInfo(conn, mint.publicKey.toBase58());
  console.log(`  unclaimed creator fees: ${(after!.unclaimedCreatorLamports / 1e9).toFixed(6)} SOL`);
  if (after!.unclaimedCreatorLamports > 0) {
    await send(await buildClaimCreatorFeeTx(conn, treasury.publicKey.toBase58(), info.pool), [treasury], "claim creator fees", { kind: "claim-fees", maxTopLevelSolOut: 3_000_000 });
  }
  console.log(`\nAll good. Config ${config}. Treasury balance ${(await conn.getBalance(treasury.publicKey)) / 1e9} SOL.`);
})().catch((e) => { console.error("✗", e); process.exit(1); });
