// StonkFun / LaunchLab launch transaction: accounts, PDAs, signer acceptance. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getPdaLaunchpadPoolId, getPdaCreatorVault, getPdaPlatformVault } from "@raydium-io/raydium-sdk-v2";
import { buildLaunchTx, LAUNCHLAB_PROGRAM, poolAccounts } from "../src/lib/launchlab";
import { inspect, SignerRefusal } from "../src/lib/signer";
import { pick } from "../src/lib/stonkfun";
import type { Pricing } from "../src/lib/stonkfun";

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const platform = Keypair.generate().publicKey;
const pricing: Pricing = {
  programId: null, configId: null, platformId: platform.toBase58(), baseDecimals: 6,
  supply: "1000000000000000", totalSellA: "793100000000000", totalFundRaisingB: "85000000000",
  migrateType: "cpmm", cpmmCreatorFeeOn: 0, allowConfig: null, allowConfigRequired: false, curveRule: null, raw: {},
};

test("launch tx: pool creation + dev buy, treasury pays and is creator", () => {
  const treasury = Keypair.generate().publicKey, mintA = Keypair.generate().publicKey;
  const { tx, accounts } = buildLaunchTx({ pricing, treasury, mintA, mintB: WSOL, mintProgramB: TOKEN_PROGRAM_ID, name: "Acme", symbol: "ACME", uri: "https://x/y.json", devBuyB: 50_000_000n, microLamports: 100_000 });
  const prog = new PublicKey(LAUNCHLAB_PROGRAM);
  assert.ok(accounts.pool.equals(getPdaLaunchpadPoolId(prog, mintA, WSOL).publicKey));
  assert.ok(accounts.creatorFeeVault.equals(getPdaCreatorVault(prog, treasury, WSOL).publicKey), "creator fee vault belongs to the treasury");
  assert.ok(accounts.platformFeeVault.equals(getPdaPlatformVault(prog, platform, WSOL).publicKey));
  const launchIxs = tx.instructions.filter((i) => i.programId.equals(prog));
  assert.equal(launchIxs.length, 2, "initialize + buy");
  const init = launchIxs[0];
  assert.ok(init.keys[0].pubkey.equals(treasury) && init.keys[0].isSigner, "treasury is payer");
  assert.ok(init.keys[1].pubkey.equals(treasury), "treasury is creator");
  assert.ok(init.keys[6].pubkey.equals(mintA) && init.keys[6].isSigner, "mint signs");
  const buy = launchIxs[1];
  assert.ok(buy.keys[0].pubkey.equals(treasury) && buy.keys[0].isSigner, "treasury buys");
  // the buy goes into the treasury's Token-2022 account for the new mint
  assert.ok(tx.instructions.some((i) => i.keys.some((k) => k.pubkey.equals(TOKEN_2022_PROGRAM_ID))));
  // Firmware's signer accepts it within the launch intent
  inspect(treasury, tx.instructions, treasury, { kind: "launch", maxTopLevelSolOut: 50_000_000 + 60_000_000 });
});

test("signer refuses a launch that moves more SOL than declared", () => {
  const treasury = Keypair.generate().publicKey, mintA = Keypair.generate().publicKey;
  const { tx } = buildLaunchTx({ pricing, treasury, mintA, mintB: WSOL, mintProgramB: TOKEN_PROGRAM_ID, name: "A", symbol: "A", uri: "u", devBuyB: 5_000_000_000n, microLamports: 1 });
  assert.throws(() => inspect(treasury, tx.instructions, treasury, { kind: "launch", maxTopLevelSolOut: 60_000_000 }), SignerRefusal);
});

test("stock pair: no SOL wrapping, quote token program passed through", () => {
  const treasury = Keypair.generate().publicKey, mintA = Keypair.generate().publicKey, xstock = Keypair.generate().publicKey;
  const { tx } = buildLaunchTx({ pricing, treasury, mintA, mintB: xstock, mintProgramB: TOKEN_2022_PROGRAM_ID, name: "A", symbol: "A", uri: "u", devBuyB: 1234n, microLamports: 1 });
  assert.ok(!tx.instructions.some((i) => i.programId.equals(new PublicKey("11111111111111111111111111111111"))), "no system transfer for a stock pair");
  inspect(treasury, tx.instructions, treasury, { kind: "launch", maxTopLevelSolOut: 60_000_000 });
});

test("token-transfer intent can't move SOL", () => {
  const t = Keypair.generate().publicKey;
  const { SystemProgram } = require("@solana/web3.js");
  assert.throws(() => inspect(t, [SystemProgram.transfer({ fromPubkey: t, toPubkey: Keypair.generate().publicKey, lamports: 1 })], t, { kind: "token-transfer" }), SignerRefusal);
});

test("pricing reader tolerates nested / differently named fields", () => {
  assert.equal(pick({ platform: { standard: "abc" } }, ["pricing.platform.standard", "platform.standard"]), "abc");
  assert.equal(pick({ raise: { raw: "85" } }, ["raise.raw"]), "85");
  assert.equal(pick({}, ["nope"]), undefined);
});

test("pool accounts are deterministic", () => {
  const p = new PublicKey(LAUNCHLAB_PROGRAM), a = Keypair.generate().publicKey, c = Keypair.generate().publicKey;
  const x = poolAccounts(p, a, WSOL, platform, c), y = poolAccounts(p, a, WSOL, platform, c);
  assert.ok(x.pool.equals(y.pool) && x.vaultA.equals(y.vaultA) && x.configId.equals(y.configId));
});
