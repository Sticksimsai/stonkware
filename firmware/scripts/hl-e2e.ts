// End-to-end check of the Solana → Hyperliquid bridge on TEST networks only (Solana devnet + Hyperliquid testnet).
//   npm run hl:e2e
// Uses its own throwaway database. It prints a devnet address and waits for you to fund it (≥ 0.5 devnet SOL from
// https://faucet.solana.com), then: sweep → Unit → uSOL on Hyperliquid testnet → approve API wallet → sell for USDC.
// The testnet USOL/USDC book is far off the SOL price, so this run allows up to 95% slippage. Never use on mainnet.
import { randomBytes } from "crypto";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

Object.assign(process.env, {
  FIRMWARE_MODE: "live", HL_NETWORK: "testnet", HL_BRIDGE: "on", SOLANA_CLUSTER: "devnet",
  SOLANA_RPC_URL: process.env.E2E_DEVNET_RPC || "https://api.devnet.solana.com",
  DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), "hl-e2e-")), "e2e.db")}`,
  VAULT_KEY: randomBytes(32).toString("hex"),
  SOL_FLOAT_SOL: "0.05", SOL_SWEEP_MIN_SOL: "0.25", HL_MAX_SLIPPAGE_BPS: "9500", PRIORITY_MICROLAMPORTS: "1000",
});

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { execSync } = await import("child_process");
  execSync("npx drizzle-kit push --force", { stdio: "ignore", env: process.env });
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("../src/db");
  const { newSealedKeypair } = await import("../src/lib/signer");
  const { newHlKeys } = await import("../src/lib/hl/accounts");
  const { sweepToHl, pollBridges, convertUsol } = await import("../src/lib/hl/bridge");
  const { hlBalance } = await import("../src/lib/hl/client");

  const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const t = newSealedKeypair(), m = newSealedKeypair();
  const [c0] = await db.insert(schema.companies).values({
    slug: `e2e${Date.now()}`, name: "E2E", ticker: "E2E", aim: "bridge end-to-end test on test networks", model: "x/y", modelLabel: "Y",
    creatorWallet: t.pubkey, treasuryPubkey: t.pubkey, treasurySecretEnc: t.sealed, mintPubkey: m.pubkey, status: "LIVE", ...newHlKeys(),
  }).returning();
  const get = async () => (await db.query.companies.findFirst({ where: eq(schema.companies.id, c0.id) }))!;
  log(`Send ≥ 0.5 devnet SOL to: ${t.pubkey}   (https://faucet.solana.com)`);
  log(`Hyperliquid testnet account: ${c0.hlAddress}`);

  for (let i = 0; ; i++) {
    const bal = await conn.getBalance(new PublicKey(t.pubkey));
    if (bal >= 0.35e9) { log(`funded: ${bal / 1e9} SOL`); break; }
    if (i > 180) throw new Error("not funded after 30 minutes");
    await sleep(10_000);
  }

  const b = await sweepToHl(await get());
  if (!b) throw new Error("nothing was swept");
  log(`swept ${b.lamports / 1e9} SOL to Unit ${b.protocolAddress} (tx ${b.sourceRef})`);
  for (let i = 0; i < 80; i++) {
    await sleep(15_000);
    await pollBridges();
    const row = (await db.query.hlBridges.findFirst({ where: eq(schema.hlBridges.id, b.id) }))!;
    log(`bridge ${row.state} · unit: ${row.unitState ?? "not seen yet"}`);
    if (row.state !== "SENT") break;
  }
  log("Hyperliquid before convert:", JSON.stringify(await hlBalance(c0.hlAddress!)));
  const usd = await convertUsol(await get());
  log(`converted to $${usd.toFixed(2)} USDC; API wallet approved: ${!!(await get()).hlAgentApprovedAt}`);
  log("Hyperliquid after:", JSON.stringify(await hlBalance(c0.hlAddress!)));
  for (const f of await db.select().from(schema.feedEvents).where(eq(schema.feedEvents.companyId, c0.id))) log(`feed: ${f.title} | ${f.body}`);
  process.exit(usd > 0 ? 0 : 1);
})().catch((e) => { console.error("FAILED:", (e as Error).message); process.exit(1); });
