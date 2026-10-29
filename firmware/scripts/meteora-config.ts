// One-time setup: create Hypeware's Meteora DBC config (curve + fees + graduation rules).
// Every company launches a pool against this config. Configs are immutable — to change
// economics, create a new one and update DBC_CONFIG (existing pools keep their old config).
//
//   npm run meteora:config -- --dry-run     # print the config, send nothing
//   npm run meteora:config                  # create it on-chain (PARTNER_KEYPAIR pays ~0.01 SOL)
import "./_env";
import { Connection, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import { partnerKeypair } from "./_env";

(async () => {
  const { LAUNCHPAD, WSOL, buildFirmwareConfig, dbc, feeSplitBps } = await import("../src/lib/meteora");
  const { validateConfigParameters } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const split = feeSplitBps();
  console.log("Hypeware launchpad config");
  console.log(`  trading fee        ${split.total / 100}%  (starts at ${LAUNCHPAD.startFeeBps / 100}% and decays over ${LAUNCHPAD.antiSniperSeconds}s — anti-sniper)`);
  console.log(`  → company treasury ${split.company / 100}%   → Hypeware ${split.firmware / 100}%   → Meteora ${split.meteora / 100}%`);
  console.log(`  market cap         ${LAUNCHPAD.initialMarketCapSol} SOL at launch → graduates to DAMM v2 at ${LAUNCHPAD.migrationMarketCapSol} SOL`);
  console.log(`  supply             ${LAUNCHPAD.totalSupply.toLocaleString()} (${LAUNCHPAD.decimals} decimals), immutable, no mint authority`);

  const params = buildFirmwareConfig();
  if (process.argv.includes("--dry-run")) {
    validateConfigParameters({ ...params, leftoverReceiver: Keypair.generate().publicKey } as never);
    console.log(`  migration threshold ${Number(params.migrationQuoteThreshold.toString()) / 1e9} SOL in the curve`);
    console.log("\n✓ config is valid (dry run, nothing sent)");
    return;
  }

  const rpc = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const partner = partnerKeypair();
  const config = Keypair.generate();
  const tx = await dbc(conn).partner.createConfig({
    ...params,
    config: config.publicKey,
    feeClaimer: partner.publicKey,
    leftoverReceiver: partner.publicKey,
    quoteMint: WSOL,
    payer: partner.publicKey,
  });
  const sig = await sendAndConfirmTransaction(conn, tx, [partner, config], { commitment: "confirmed" });
  console.log(`\n✓ created config ${config.publicKey.toBase58()}\n  tx ${sig}\n\nAdd to .env:\nDBC_CONFIG="${config.publicKey.toBase58()}"`);
})().catch((e) => { console.error(e); process.exit(1); });
