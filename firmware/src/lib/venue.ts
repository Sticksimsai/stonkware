// StonkFun venue (Raydium LaunchLab under StonkFun's platform). Everything chain-specific for v2 launches:
// launch, dev buy → creator, pool status, fee collection (quote token → SOL) and buying the company's own token.
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { connection } from "./solana";
import { launchPricing, prepareFeeClaim, submitFeeClaim } from "./stonkfun";
import { buildLaunchTx, creatorFeeClaim, curveBuyIxs, isWsol, mintProgram, poolAccounts, poolState, programOf, LAUNCHLAB_PROGRAM, type PoolState } from "./launchlab";
import { jupSwapTx, WSOL_MINT } from "./jupiter";
import { priorityMicroLamports, signAndSend, signInstructions, signOnly } from "./signer";
import { emit, record } from "./feed";

const C = schema.companies;
const conn = () => connection();
const pk = (s: string) => new PublicKey(s);

export const isStonkfun = (c: Pick<Company, "quoteMint" | "source">) => !!c.quoteMint && c.source !== "external";

/** Raw balance of `mint` held by `owner` (all token accounts, either token program). */
export async function tokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  if (mint.toBase58() === WSOL_MINT) {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
    const b = await conn().getTokenAccountBalance(ata).catch(() => null);
    return b ? BigInt(b.value.amount) : 0n;
  }
  const r = await conn().getParsedTokenAccountsByOwner(owner, { mint });
  return r.value.reduce((a, acc) => a + BigInt(acc.account.data.parsed.info.tokenAmount.amount as string), 0n);
}

export async function stonkPool(c: Company): Promise<PoolState | null> {
  if (!c.quoteMint) return null;
  return poolState(conn(), pk(c.mintPubkey), pk(c.quoteMint), pk(LAUNCHLAB_PROGRAM)).catch(() => null);
}

/**
 * Launch on LaunchLab under StonkFun's standard platform. Idempotent-ish for retries: a dev-buy swap that already
 * happened (quote tokens sitting in the treasury) is reused instead of swapping again.
 */
export async function launchStonkfun(c: Company, uri: string): Promise<{ sig: string; pool: string }> {
  if (!c.quoteMint) throw new Error("no quote token chosen");
  if (!c.mintSecretEnc) throw new Error("mint key missing");
  const pricing = await launchPricing(c.quoteMint);
  const treasury = pk(c.treasuryPubkey), mintA = pk(c.mintPubkey), mintB = pk(c.quoteMint);
  const mintProgramB = await mintProgram(conn(), mintB);
  const devLamports = Math.round(c.devBuySol * 1e9);
  const wsol = isWsol(mintB);

  let devBuyB = 0n;
  if (devLamports > 0) {
    if (wsol) devBuyB = BigInt(devLamports);
    else {
      devBuyB = await tokenBalance(treasury, mintB);
      if (devBuyB === 0n) {
        const { tx } = await jupSwapTx(c.treasuryPubkey, WSOL_MINT, c.quoteMint, devLamports);
        const sig = await signAndSend({ treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey, tx, intent: { kind: "trade", maxTopLevelSolOut: devLamports + 5_000_000 } });
        devBuyB = await tokenBalance(treasury, mintB);
        if (devBuyB === 0n) throw new Error("dev-buy swap landed but no quote tokens arrived");
        await record(c.id, "SWAP", -devLamports, `dev buy: SOL → ${c.quoteSymbol ?? "quote"}`, sig, devBuyB.toString());
      }
    }
  }

  const { tx, accounts } = buildLaunchTx({
    pricing, treasury, mintA, mintB, mintProgramB, name: c.name, symbol: c.ticker, uri, devBuyB, microLamports: await priorityMicroLamports(),
  });
  const sig = await signAndSend({
    treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey, tx, extraSealed: c.mintSecretEnc,
    intent: { kind: "launch", maxTopLevelSolOut: (wsol ? devLamports : 0) + 60_000_000 },
  });
  return { sig, pool: accounts.pool.toBase58() };
}

/** Send the dev-buy tokens the treasury bought at launch to the creator's wallet. Safe to call repeatedly. */
export async function payDevBuy(c: Company): Promise<string | null> {
  if (!isStonkfun(c) || c.devBuySol <= 0 || c.status !== "LIVE") return null;
  const done = await db.query.ledger.findFirst({ where: and(eq(schema.ledger.companyId, c.id), eq(schema.ledger.kind, "DEVBUY_PAYOUT")) });
  if (done) return null;
  const treasury = pk(c.treasuryPubkey), mint = pk(c.mintPubkey), creator = pk(c.creatorWallet);
  // only the tokens bought at launch (recorded on the LAUNCH row), never anything the agent bought later
  const launchRow = await db.query.ledger.findFirst({ where: and(eq(schema.ledger.companyId, c.id), eq(schema.ledger.kind, "LAUNCH")) });
  const bought = launchRow?.tokens ? BigInt(launchRow.tokens) : 0n;
  if (bought === 0n) return null;
  const held = await tokenBalance(treasury, mint);
  const amount = held < bought ? held : bought;
  if (amount === 0n) return null;
  const from = getAssociatedTokenAddressSync(mint, treasury, false, TOKEN_2022_PROGRAM_ID);
  const to = getAssociatedTokenAddressSync(mint, creator, true, TOKEN_2022_PROGRAM_ID);
  const decimals = 6;
  const sig = await signInstructions(c.treasurySecretEnc, c.treasuryPubkey, [
    createAssociatedTokenAccountIdempotentInstruction(treasury, to, creator, mint, TOKEN_2022_PROGRAM_ID),
    createTransferCheckedInstruction(from, mint, to, treasury, amount, decimals, [], TOKEN_2022_PROGRAM_ID),
  ], { kind: "token-transfer" });
  await record(c.id, "DEVBUY_PAYOUT", 0, `dev buy sent to creator ${c.creatorWallet}`, sig, amount.toString());
  await emit(c.id, "TREASURY", `Dev buy sent to the creator`, `${(Number(amount) / 1e6).toLocaleString()} $${c.ticker} → ${c.creatorWallet.slice(0, 4)}…${c.creatorWallet.slice(-4)}`, sig);
  return sig;
}

/**
 * Collect creator fees into SOL. Returns lamports gained.
 *  1. curve phase: claim the treasury's LaunchLab creator-fee vault (quote token)
 *  2. graduated: StonkFun's fee-claim intent for the locked Raydium position (signed here, submitted to StonkFun)
 *  3. convert whatever quote token the treasury holds to SOL (wSOL is just unwrapped)
 */
export async function collectStonkfunFees(c: Company): Promise<{ lamports: number; sig: string | null; migrated: boolean | null }> {
  if (!c.quoteMint) return { lamports: 0, sig: null, migrated: null };
  const treasury = pk(c.treasuryPubkey), mintB = pk(c.quoteMint);
  const state = await stonkPool(c);
  const mintProgramB = await mintProgram(conn(), mintB);
  const before = await conn().getBalance(treasury);
  let lastSig: string | null = null;

  const claim = await creatorFeeClaim(conn(), programOf(null), treasury, mintB, mintProgramB);
  if (claim && claim.amount > 0n) {
    lastSig = await signInstructions(c.treasurySecretEnc, c.treasuryPubkey, claim.ixs, { kind: "claim-fees", maxTopLevelSolOut: 3_000_000 });
  }

  if (state?.migrated) {
    try {
      const intent = await prepareFeeClaim(c.mintPubkey, c.treasuryPubkey);
      if (intent) {
        const signed = await signOnly(c.treasurySecretEnc, c.treasuryPubkey, intent.tx, { kind: "claim-fees", maxTopLevelSolOut: 3_000_000 });
        lastSig = (await submitFeeClaim(c.mintPubkey, c.treasuryPubkey, intent.intentId, signed)) ?? lastSig;
        await new Promise((r) => setTimeout(r, 4000)); // let it land before converting
      }
    } catch (e) { console.error(`[fees] $${c.ticker} post-graduation claim:`, (e as Error).message.slice(0, 200)); }
  }

  // convert the quote token (fees) to SOL
  const held = await tokenBalance(treasury, mintB);
  if (held > 0n) {
    if (isWsol(mintB)) {
      const ata = getAssociatedTokenAddressSync(mintB, treasury, false, TOKEN_PROGRAM_ID);
      lastSig = await signInstructions(c.treasurySecretEnc, c.treasuryPubkey, [createCloseAccountInstruction(ata, treasury, treasury, [], TOKEN_PROGRAM_ID)], { kind: "claim-fees", maxTopLevelSolOut: 0 });
    } else {
      try {
        const { tx } = await jupSwapTx(c.treasuryPubkey, c.quoteMint, WSOL_MINT, held);
        lastSig = await signAndSend({ treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey, tx, intent: { kind: "trade", maxTopLevelSolOut: 5_000_000 } });
      } catch (e) { console.error(`[fees] $${c.ticker} ${c.quoteSymbol}→SOL swap:`, (e as Error).message.slice(0, 200)); }
    }
  }
  const after = await conn().getBalance(treasury);
  return { lamports: Math.max(0, after - before), sig: lastSig, migrated: state ? state.migrated : null };
}

/** Buy the company's own token with `lamports` of SOL: Jupiter first; on the curve fall back to LaunchLab directly. */
export async function buyOwnToken(c: Company, lamports: number): Promise<string> {
  if (!c.quoteMint) throw new Error("not a StonkFun company");
  const sealed = { treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey };
  try {
    const { tx } = await jupSwapTx(c.treasuryPubkey, WSOL_MINT, c.mintPubkey, lamports);
    return await signAndSend({ ...sealed, tx, intent: { kind: "trade", maxTopLevelSolOut: lamports + 5_000_000 } });
  } catch (jupErr) {
    const state = await stonkPool(c);
    if (!state || state.migrated) throw jupErr;
    const treasury = pk(c.treasuryPubkey), mintB = pk(c.quoteMint);
    const mintProgramB = await mintProgram(conn(), mintB);
    let amountB = BigInt(lamports);
    if (!isWsol(mintB)) {
      const pre = await tokenBalance(treasury, mintB);
      const { tx } = await jupSwapTx(c.treasuryPubkey, WSOL_MINT, c.quoteMint, lamports);
      await signAndSend({ ...sealed, tx, intent: { kind: "trade", maxTopLevelSolOut: lamports + 5_000_000 } });
      amountB = (await tokenBalance(treasury, mintB)) - pre;
      if (amountB <= 0n) throw new Error("SOL → quote swap gave nothing");
    }
    const a = poolAccounts(programOf(null), pk(c.mintPubkey), mintB, state.platformId, state.creator, state.configId);
    return signInstructions(c.treasurySecretEnc, c.treasuryPubkey, curveBuyIxs(a, treasury, mintProgramB, amountB, 1n), { kind: "trade", maxTopLevelSolOut: (isWsol(mintB) ? lamports : 0) + 5_000_000 });
  }
}

export async function markGraduation(c: Company, migrated: boolean | null) {
  if (migrated === null || migrated === c.migrated) return;
  await db.update(C).set({ migrated }).where(eq(C.id, c.id));
  if (migrated) await emit(c.id, "SYSTEM", `$${c.ticker} graduated on StonkFun`, `The bonding curve filled and liquidity moved to a Raydium pool. The treasury keeps earning creator fees from it.`);
}
