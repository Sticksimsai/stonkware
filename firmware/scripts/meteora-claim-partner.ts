// Claim Hypeware's partner share of trading fees across every pool launched with DBC_CONFIG.
//   npm run meteora:claim            (run daily from cron)
import "./_env";
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { partnerKeypair } from "./_env";

(async () => {
  const { dbc } = await import("../src/lib/meteora");
  const configKey = process.env.DBC_CONFIG;
  if (!configKey) {
    // StonkFun venue: there's no Hypeware partner config to claim from (Hypeware earns a share of creator fees instead)
    console.log((process.env.LAUNCH_VENUE || "stonkfun") === "stonkfun" ? "venue is StonkFun: no partner fees to claim" : "DBC_CONFIG not set");
    process.exit(0);
  }
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const partner = partnerKeypair();
  const client = dbc(conn);
  const pools = await client.state.getPoolsFeesByConfig(new PublicKey(configKey));
  const min = Number(process.env.MIN_PARTNER_CLAIM_LAMPORTS || 5_000_000);
  let total = 0;
  for (const p of pools) {
    const amt = p.partnerQuoteFee.toNumber();
    if (amt < min) continue;
    const tx = await client.partner.claimPartnerTradingFee({
      feeClaimer: partner.publicKey, payer: partner.publicKey, pool: p.poolAddress,
      maxBaseAmount: new BN(0), maxQuoteAmount: new BN(amt),
    });
    const sig = await sendAndConfirmTransaction(conn, tx, [partner], { commitment: "confirmed" });
    total += amt;
    console.log(`claimed ${(amt / 1e9).toFixed(4)} SOL from ${p.poolAddress.toBase58()} — ${sig}`);
  }
  console.log(`done: ${(total / 1e9).toFixed(4)} SOL across ${pools.length} pools`);

  // forward the flagship's share of these partner fees to its treasury
  const { getFlagship, flagshipSharePct, creditFlagship } = await import("../src/lib/flagship");
  const flagship = await getFlagship(true);
  const share = flagship ? Math.floor((total * flagshipSharePct()) / 100) : 0;
  if (flagship && share >= 1_000_000) {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: partner.publicKey, toPubkey: new PublicKey(flagship.treasuryPubkey), lamports: share }));
    const sig = await sendAndConfirmTransaction(conn, tx, [partner], { commitment: "confirmed" });
    await creditFlagship(share, `${flagshipSharePct()}% of Hypeware's launchpad partner fees`, sig);
    console.log(`forwarded ${(share / 1e9).toFixed(4)} SOL to $${flagship.ticker} treasury — ${sig}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
