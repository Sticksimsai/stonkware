// Check the StonkFun launch path on a real server WITHOUT sending anything.
//   npm run stonkfun:probe                       SOL pair
//   npm run stonkfun:probe -- --quote <mint>     a specific quote token (e.g. an xStock)
//   npm run stonkfun:probe -- --raw              also print the raw API responses
// It fetches pairs + pricing, derives the LaunchLab accounts, checks them on-chain, builds a launch transaction
// (with a 0.01 SOL dev buy on the SOL pair) and SIMULATES it with your PLATFORM_FEE_WALLET as the payer
// (signatures aren't checked in a simulation, so no keys are used and nothing is broadcast).
import "./_env";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`\x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  ${m}`);

(async () => {
  const { launchPairs, launchPricing } = await import("../src/lib/stonkfun");
  const { buildLaunchTx, mintProgram, poolAccounts, programOf, isWsol } = await import("../src/lib/launchlab");
  const { inspect } = await import("../src/lib/signer");
  const { connection } = await import("../src/lib/solana");
  const { env } = await import("../src/lib/env");
  const { WSOL_MINT } = await import("../src/lib/jupiter");
  const conn = connection();
  let failures = 0;

  // 1. pairs
  let pairs: Awaited<ReturnType<typeof launchPairs>> = [];
  try {
    pairs = await launchPairs();
    ok(`pairs: ${pairs.length} launchable quote tokens`);
    info(pairs.slice(0, 12).map((p) => `${p.symbol}${p.category ? `(${p.category})` : ""}`).join(", "));
  } catch (e) { bad(`pairs: ${(e as Error).message}`); failures++; }

  // 2. pricing
  const quote = flag("quote") || WSOL_MINT;
  let pricing: Awaited<ReturnType<typeof launchPricing>>;
  try {
    pricing = await launchPricing(quote);
    ok(`pricing for ${quote === WSOL_MINT ? "SOL" : quote}`);
    info(`program ${pricing.programId ?? "(default LaunchLab)"} · platform ${pricing.platformId}`);
    info(`config ${pricing.configId ?? "(derived)"} · supply ${pricing.supply} · sell ${pricing.totalSellA} · raise ${pricing.totalFundRaisingB} · ${pricing.migrateType} · decimals ${pricing.baseDecimals}`);
    info(`allowConfig ${pricing.allowConfig ?? "-"}${pricing.allowConfigRequired ? " (required)" : ""} · curveRule ${pricing.curveRule ?? "-"}`);
    if (args.includes("--raw")) console.log(JSON.stringify(pricing.raw, null, 2).slice(0, 6000));
  } catch (e) { bad(`pricing: ${(e as Error).message}`); process.exit(1); }

  // 3. accounts
  const programId = programOf(pricing);
  const payer = new PublicKey(env.platformFeeWallet || "5TdswKDjVuodij2UegUYQVZQKfEAAiiYcEhAyCw8M4wB");
  const mintA = Keypair.generate().publicKey;
  const mintB = new PublicKey(quote);
  const a = poolAccounts(programId, mintA, mintB, new PublicKey(pricing.platformId), payer, pricing.configId ? new PublicKey(pricing.configId) : undefined);
  const derivedConfig = poolAccounts(programId, mintA, mintB, new PublicKey(pricing.platformId), payer).configId;
  if (pricing.configId) (derivedConfig.equals(a.configId) ? ok : (m: string) => { console.log(`\x1b[33m!\x1b[0m ${m}`); })(`config id ${pricing.configId === derivedConfig.toBase58() ? "matches the derived PDA" : `differs from derived ${derivedConfig.toBase58()} (using StonkFun's)`}`);
  {
    const { getPdaPlatformAllowConfig, getPdaPlatformCurveRule } = await import("@raydium-io/raydium-sdk-v2");
    const dAllow = getPdaPlatformAllowConfig(programId, a.platformId, a.configId).publicKey.toBase58();
    const dRule = getPdaPlatformCurveRule(programId, a.platformId, a.configId).publicKey.toBase58();
    if (pricing.allowConfig) (pricing.allowConfig === dAllow ? ok : bad)(`allow-config ${pricing.allowConfig === dAllow ? "matches" : `differs from derived ${dAllow}`}`);
    if (pricing.curveRule) (pricing.curveRule === dRule ? ok : bad)(`curve-rule ${pricing.curveRule === dRule ? "matches" : `differs from derived ${dRule}`}`);
  }
  for (const [name, key] of [["program", programId], ["platform", a.platformId], ["global config", a.configId], ["quote mint", mintB]] as const) {
    const acc = await conn.getAccountInfo(key).catch(() => null);
    acc ? ok(`${name} exists on-chain (${key.toBase58()})`) : (bad(`${name} NOT found on-chain: ${key.toBase58()}`), failures++);
  }

  // 4. build + inspect + simulate
  const devBuyB = isWsol(mintB) ? 10_000_000n : 0n;
  const { tx } = buildLaunchTx({ pricing, treasury: payer, mintA, mintB, mintProgramB: await mintProgram(conn, mintB), name: "Probe", symbol: "PROBE", uri: "https://example.com/probe.json", devBuyB, microLamports: 50_000 });
  try { inspect(payer, tx.instructions, payer, { kind: "launch", maxTopLevelSolOut: 70_000_000 }); ok("Hypeware's signer would accept this launch transaction"); }
  catch (e) { bad(`signer refuses the launch tx: ${(e as Error).message}`); failures++; }
  tx.feePayer = payer;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const sim = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true }).catch((e: Error) => ({ value: { err: e.message, logs: [] as string[], unitsConsumed: 0 } }));
  const v = (sim as { value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }).value;
  if (!v.err) ok(`simulated launch${devBuyB ? " + 0.01 SOL dev buy" : ""} succeeded (${v.unitsConsumed ?? "?"} CU), payer ${payer.toBase58().slice(0, 4)}…`);
  else {
    const insufficient = JSON.stringify(v.err).includes("InsufficientFunds") || (v.logs ?? []).some((l) => /insufficient lamports|insufficient funds/i.test(l));
    (insufficient ? (m: string) => console.log(`\x1b[33m!\x1b[0m ${m}`) : bad)(`simulation ${insufficient ? "ran out of SOL in the payer wallet (the instructions themselves were accepted up to that point)" : "failed"}: ${JSON.stringify(v.err)}`);
    if (!insufficient) failures++;
    for (const l of (v.logs ?? []).slice(-15)) info(l);
  }
  console.log(failures ? `\n${failures} problem(s): don't launch on mainnet until these are fixed` : "\nStonkFun launch path looks good.");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
