// Treasury operations. The agent has full control; these functions only enforce physics
// (balance, rent floor, optional caps) and hand every transaction to the isolated signer.
import { PublicKey } from "@solana/web3.js";
import { createBurnInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { and, eq, gte, inArray, sql, type AnyColumn } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { env, isLive } from "./env";
import { connection } from "./solana";
import { FEES, platformCut } from "./fees";
import { checkSpend } from "./policy";
import { buildClaimCreatorFeeTx, buildClaimLpFeeTxs, buildCreatePoolTx, buildCurveBuyTx, buildJupiterBuyTx, poolInfo } from "./meteora";
import { uploadMetadata } from "./ipfs";
import { mockSig, signAndSend, signInstructions, transferFromTreasury } from "./signer";
import { creditFlagship, flagshipSharePct, getFlagship, isPrelaunch } from "./flagship";
import { emit, record } from "./feed";
import { fmtSol } from "./units";
import { siteUrlFor } from "./sites";
import { buyOwnToken, collectStonkfunFees, isStonkfun, launchStonkfun, markGraduation, payDevBuy, tokenBalance } from "./venue";
import { bridgeReady, ensureSolLiquidity, hlValueLamports, solPrice } from "./hl/bridge";
import { hlBalance } from "./hl/client";
import { hlExecute } from "./hl/signer";
import { tokenWire } from "./hl/spot";

const C = schema.companies;
const L = schema.ledger;
const bump = (col: AnyColumn, by: number) => sql`${col} + ${Math.trunc(by)}`;

export async function getCompany(id: string): Promise<Company> {
  const c = await db.query.companies.findFirst({ where: eq(C.id, id) });
  if (!c) throw new Error("company not found");
  return c;
}

async function unsettledCompute(companyId: string) {
  const [r] = await db.select({ s: sql<number>`coalesce(-sum(${L.lamports}),0)` }).from(L)
    .where(and(eq(L.companyId, companyId), eq(L.kind, "COMPUTE"), eq(L.settled, false)));
  return r.s;
}

/**
 * Spendable view of the treasury, in lamports: Solana balance + everything on Hyperliquid (USDC valued at the SOL
 * price, uSOL 1:1, and transfers in flight) minus compute not yet reimbursed. Mock: ledger sum.
 */
export async function treasuryBalance(c: Company): Promise<number> {
  if (isLive()) {
    const [sol, hl] = await Promise.all([connection().getBalance(new PublicKey(c.treasuryPubkey)), hlValueLamports(c).catch(() => 0)]);
    return sol + hl - (await unsettledCompute(c.id));
  }
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${L.lamports}),0)` }).from(L).where(eq(L.companyId, c.id));
  return r.s;
}

export async function spentLast24h(companyId: string) {
  const [r] = await db.select({ s: sql<number>`coalesce(-sum(${L.lamports}),0)` }).from(L)
    .where(and(eq(L.companyId, companyId), inArray(L.kind, ["TRANSFER", "BUYBACK"]), gte(L.createdAt, new Date(Date.now() - 86_400_000))));
  return r.s;
}

async function guardSpend(c: Company, amount: number) {
  const v = checkSpend({ status: c.status, balance: await treasuryBalance(c), amount, spentLast24h: await spentLast24h(c.id) });
  if (!v.ok) throw new Error(v.reason);
}

// ───────────────────────────── funding & launch ─────────────────────────────

export async function verifyDeposit(sig: string, from: string, to: string, minLamports: number): Promise<number> {
  if (!isLive()) return minLamports;
  const tx = await connection().getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx || tx.meta?.err) throw new Error("deposit transaction not found or failed");
  let received = 0;
  for (const ix of tx.transaction.message.instructions) {
    if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
      const i = ix.parsed.info as { source: string; destination: string; lamports: number };
      if (i.source === from && i.destination === to) received += Number(i.lamports);
    }
  }
  if (received < minLamports) throw new Error(`deposit too small: ${received} < ${minLamports}`);
  return received;
}

export async function launch(companyId: string): Promise<Company> {
  const c = await getCompany(companyId);
  if (c.status !== "LAUNCHING") throw new Error(`cannot launch from status ${c.status}`);
  try {
    const uri = c.metadataUri ?? (await uploadMetadata({
      companyId: c.id, image: c.image ?? Buffer.alloc(0), mime: c.imageMime ?? "image/png",
      name: c.name, symbol: c.ticker, description: c.aim.slice(0, 500), twitter: c.twitter, website: siteUrlFor(c.slug),
    }));
    await db.update(C).set({ metadataUri: uri }).where(eq(C.id, c.id));

    let sig: string;
    let pool: string | null = null;
    const devBuy = Math.round(c.devBuySol * 1e9);
    const stonk = isStonkfun(c);
    if (isLive()) {
      if (!c.mintSecretEnc) throw new Error("mint key missing");
      if (stonk) {
        ({ sig, pool } = await launchStonkfun(c, uri));
      } else {
        if (!env.dbcConfig) throw new Error("DBC_CONFIG is not set — run `npm run meteora:config` first");
        const tx = await buildCreatePoolTx(connection(), { config: env.dbcConfig, treasury: c.treasuryPubkey, mint: c.mintPubkey, name: c.name, symbol: c.ticker, uri, devBuyLamports: devBuy, devBuyReceiver: c.creatorWallet });
        sig = await signAndSend({
          treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey, tx, extraSealed: c.mintSecretEnc,
          // dev buy is wrapped to wSOL with a top-level transfer; rent for new accounts is small
          intent: { kind: "launch", maxTopLevelSolOut: devBuy + 60_000_000 },
        });
        pool = (await poolInfo(connection(), c.mintPubkey))?.pool.toBase58() ?? null;
      }
    } else sig = mockSig();

    await db.update(C).set({ status: "LIVE", launchSig: sig, poolAddress: pool, mintSecretEnc: null, launchError: null, wakeRequested: true, venue: stonk ? "StonkFun" : c.venue }).where(eq(C.id, c.id));
    // live: book the real cost from the transaction; mock: the estimate
    const launchCost = isLive() ? Math.min(0, await treasuryDeltaFromTx(sig, c.treasuryPubkey)) : -(FEES.launchCostLamports + devBuy);
    const devTokens = stonk && isLive() && devBuy > 0 ? (await tokenBalance(new PublicKey(c.treasuryPubkey), new PublicKey(c.mintPubkey)).catch(() => 0n)).toString() : undefined;
    await record(c.id, "LAUNCH", launchCost, stonk ? `StonkFun launch (paired with ${c.quoteSymbol ?? "quote"})${devBuy > 0 ? " + dev buy" : ""}` : devBuy > 0 ? "Meteora DBC pool + dev buy (tokens to the creator)" : "Meteora DBC pool", sig, devTokens);
    await emit(c.id, "SYSTEM", `$${c.ticker} is live`, stonk
      ? `Launched on StonkFun, paired with ${c.quoteSymbol ?? "its quote token"}. The treasury is the coin's creator, so its share of every trade's fee funds the agent. The agent (${c.modelLabel}) now has full control.`
      : `Launched on Meteora. The treasury is the pool creator — its share of every trade's fee funds the agent from the first trade. The agent (${c.modelLabel}) now has full control.`, sig);
    if (stonk && isLive() && devBuy > 0) await payDevBuy(await getCompany(c.id)).catch((e) => console.error(`[launch] dev buy payout $${c.ticker}:`, (e as Error).message));
    return getCompany(c.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(C).set({ status: "FAILED", launchError: msg.slice(0, 500) }).where(eq(C.id, c.id));
    await emit(c.id, "SYSTEM", "Launch failed", msg);
    throw e;
  }
}

// ───────────────────────────── income ─────────────────────────────

async function payPlatform(c: Company, amount: number, memo: string) {
  if (amount <= 0 || amount < 1_000_000) return; // dust: stays with the company
  // a share of Hypeware's revenue funds the flagship (the platform's own token and its agent)
  const flagship = await getFlagship();
  const share = flagship && flagship.id !== c.id ? Math.floor((amount * flagshipSharePct()) / 100) : 0;
  const toFlagship = share >= 1_000_000 ? share : 0;
  const toPlatform = env.platformFeeWallet ? amount - toFlagship : 0;
  if (toFlagship) {
    const sig = await transferFromTreasury(c.treasurySecretEnc, c.treasuryPubkey, flagship!.treasuryPubkey, toFlagship);
    await record(c.id, "PLATFORM_FEE", -toFlagship, `${memo} → $${flagship!.ticker} treasury`, sig);
    await creditFlagship(toFlagship, `${flagshipSharePct()}% of Hypeware's cut from $${c.ticker}`, sig);
  }
  if (toPlatform >= 1_000_000) {
    const sig = await transferFromTreasury(c.treasurySecretEnc, c.treasuryPubkey, env.platformFeeWallet, toPlatform);
    await record(c.id, "PLATFORM_FEE", -toPlatform, memo, sig);
  }
}

async function treasuryDeltaFromTx(sig: string, treasury: string): Promise<number> {
  const tx = await connection().getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx?.meta) return 0;
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  for (let i = 0; i < keys.length; i++) {
    if (keys.get(i)?.toBase58() === treasury) return tx.meta.postBalances[i] - tx.meta.preBalances[i] + (i === 0 ? tx.meta.fee : 0);
  }
  return 0;
}

/** Minimum unclaimed amount worth paying a transaction fee for. */
const MIN_CLAIM_LAMPORTS = 2_000_000;

/**
 * Claim the company's trading-fee income into the treasury:
 *  • on the bonding curve: the creator share of DBC trading fees
 *  • after graduation: LP fees from the treasury's locked DAMM v2 position
 */
export async function claimCreatorFees(c: Company): Promise<number> {
  if (c.source === "external") {
    // launched elsewhere: there's no Hypeware pool to claim from (it's funded by platform revenue)
    await db.update(C).set({ lastClaimAt: new Date() }).where(eq(C.id, c.id));
    return 0;
  }
  let claimed = 0;
  const sigs: string[] = [];
  const stonk = isStonkfun(c);
  if (isLive() && stonk) {
    const r = await collectStonkfunFees(c);
    claimed = r.lamports;
    if (r.sig) sigs.push(r.sig);
    await markGraduation(c, r.migrated);
  } else if (isLive()) {
    const conn = connection();
    const info = await poolInfo(conn, c.mintPubkey);
    if (info && !c.poolAddress) await db.update(C).set({ poolAddress: info.pool.toBase58() }).where(eq(C.id, c.id));
    if (info && info.migrated !== c.migrated) {
      await db.update(C).set({ migrated: info.migrated }).where(eq(C.id, c.id));
      if (info.migrated) await emit(c.id, "SYSTEM", `$${c.ticker} graduated to Meteora DAMM v2`, "The bonding curve filled. The token now trades in a full AMM pool; the treasury earns LP fees from its locked position.");
    }
    if (info && info.unclaimedCreatorLamports >= MIN_CLAIM_LAMPORTS) {
      const sig = await signAndSend({ treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey, tx: await buildClaimCreatorFeeTx(conn, c.treasuryPubkey, info.pool), intent: { kind: "claim-fees", maxTopLevelSolOut: 3_000_000 } });
      claimed += Math.max(0, await treasuryDeltaFromTx(sig, c.treasuryPubkey));
      sigs.push(sig);
    }
    if (info?.migrated) {
      for (const { tx, estLamports } of await buildClaimLpFeeTxs(conn, c.treasuryPubkey, c.mintPubkey)) {
        if (estLamports < MIN_CLAIM_LAMPORTS) continue;
        const sig = await signAndSend({ treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey, tx, intent: { kind: "claim-fees", maxTopLevelSolOut: 3_000_000 } });
        claimed += Math.max(0, await treasuryDeltaFromTx(sig, c.treasuryPubkey));
        sigs.push(sig);
      }
    }
  } else {
    // simulated trading volume so the economy is visible in mock mode
    claimed = Math.floor(3_000_000 + Math.random() * 30_000_000);
  }
  await db.update(C).set({ lastClaimAt: new Date() }).where(eq(C.id, c.id));
  if (claimed <= 0) return 0;
  const sig = sigs.at(-1) ?? null;
  await record(c.id, "FEE_CLAIM", claimed, stonk ? `StonkFun creator fees${c.quoteSymbol && c.quoteSymbol !== "SOL" ? ` (${c.quoteSymbol} → SOL)` : ""}` : c.migrated ? "Meteora trading + LP fees" : "Meteora trading fees (creator share)", sig);
  // Meteora: Hypeware is paid directly as the DBC partner (no cut here). StonkFun: Hypeware takes CREATOR_FEE_SHARE_BPS.
  const { platform } = platformCut(claimed, "fees", stonk ? env.creatorFeeShareBps : undefined);
  await payPlatform(c, platform, `${((stonk ? env.creatorFeeShareBps : FEES.platformCreatorFeeBps) / 100).toFixed(0)}% platform share of creator fees`);
  await db.update(C).set({ lifetimeFees: bump(C.lifetimeFees, claimed) }).where(eq(C.id, c.id));
  await emit(c.id, "TREASURY", `+${fmtSol(claimed, 4)} trading fees`, "", sig);
  return claimed;
}

/** Book customer revenue. `platformPaid`: the platform's share was already paid another way (Hyperliquid payments). */
export async function bookRevenue(c: Company, lamports: number, sig: string, memo: string, opts: { platformPaid?: boolean } = {}) {
  await record(c.id, "REVENUE", lamports, memo, sig);
  if (!opts.platformPaid) await payPlatform(c, platformCut(lamports, "revenue").platform, "5% platform share of revenue");
  await db.update(C).set({ lifetimeRevenue: bump(C.lifetimeRevenue, lamports), wakeRequested: true, sleepingUntil: null }).where(eq(C.id, c.id));
}

// ───────────────────────────── spending (agent-controlled) ─────────────────────────────

export async function transferSol(c: Company, to: string, lamports: number, reason: string): Promise<string> {
  if (to === c.treasuryPubkey) throw new Error("cannot transfer to itself");
  await guardSpend(c, lamports);
  await ensureSolLiquidity(c, lamports);
  const sig = await transferFromTreasury(c.treasurySecretEnc, c.treasuryPubkey, to, lamports);
  await db.insert(L).values({ companyId: c.id, kind: "TRANSFER", lamports: -lamports, counterparty: to, sig, memo: reason.slice(0, 300) });
  await db.update(C).set({ lifetimeSpent: bump(C.lifetimeSpent, lamports) }).where(eq(C.id, c.id));
  await emit(c.id, "TREASURY", `Sent ${fmtSol(lamports, 4)} to ${to.slice(0, 4)}…${to.slice(-4)}`, reason, sig);
  return sig;
}

async function tokenProgramFor(mint: PublicKey) {
  const info = await connection().getAccountInfo(mint);
  if (!info) throw new Error("mint not found");
  return info.owner;
}
async function rawTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const r = await connection().getParsedTokenAccountsByOwner(owner, { mint });
  return r.value.reduce((a, acc) => a + BigInt(acc.account.data.parsed.info.tokenAmount.amount as string), 0n);
}

export async function buybackAndBurn(c: Company, lamports: number, burn = true): Promise<{ sig: string; tokens: bigint }> {
  if (isPrelaunch(c)) throw new Error("the token hasn't launched yet, so there is nothing to buy back");
  await guardSpend(c, lamports);
  await ensureSolLiquidity(c, lamports + 5_000_000);
  let sig: string, tokens: bigint, burnSig: string | null = null;
  if (isLive()) {
    const owner = new PublicKey(c.treasuryPubkey);
    const mint = new PublicKey(c.mintPubkey);
    const before = await rawTokenBalance(owner, mint);
    if (isStonkfun(c)) sig = await buyOwnToken(c, lamports);
    else {
      const conn = connection();
      const info = await poolInfo(conn, c.mintPubkey);
      const tx = info && !info.migrated
        ? await buildCurveBuyTx(conn, c.treasuryPubkey, info.pool, lamports) // still on the bonding curve
        : await buildJupiterBuyTx(c.treasuryPubkey, c.mintPubkey, lamports); // graduated: best route via Jupiter
      // the buy amount itself is wrapped to wSOL with a top-level transfer
      sig = await signAndSend({ treasurySealed: c.treasurySecretEnc, treasuryPubkey: c.treasuryPubkey, tx, intent: { kind: "trade", maxTopLevelSolOut: lamports + 5_000_000 } });
    }
    tokens = (await rawTokenBalance(owner, mint)) - before;
    if (tokens <= 0n) throw new Error("buy settled but no tokens received");
    if (burn) {
      const programId = await tokenProgramFor(mint);
      const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
      burnSig = await signInstructions(c.treasurySecretEnc, c.treasuryPubkey, [createBurnInstruction(ata, mint, owner, tokens, [], programId)], { kind: "burn" });
    }
  } else {
    sig = mockSig(); tokens = BigInt(lamports) * 31_000n; burnSig = burn ? mockSig() : null;
  }
  await record(c.id, "BUYBACK", -lamports, `bought $${c.ticker}`, sig, tokens.toString());
  if (burnSig) {
    await record(c.id, "BURN", 0, `burned $${c.ticker}`, burnSig, tokens.toString());
    await db.update(C).set({ tokensBurned: (BigInt(c.tokensBurned) + tokens).toString() }).where(eq(C.id, c.id));
  }
  await db.update(C).set({ lifetimeSpent: bump(C.lifetimeSpent, lamports) }).where(eq(C.id, c.id));
  await emit(c.id, "TREASURY", `${burn ? "Bought back & burned" : "Bought"} $${c.ticker} with ${fmtSol(lamports, 4)}`, `${fmtTokens(tokens)} tokens`, burnSig ?? sig);
  return { sig: burnSig ?? sig, tokens };
}

export function fmtTokens(raw: bigint | string, decimals = 6) {
  return (Number(BigInt(raw)) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ───────────────────────────── compute ─────────────────────────────

/** Bill the company for model + browser usage. Reimbursed on-chain in batches. */
export async function chargeCompute(c: Company, lamports: number, memo: string) {
  const amt = Math.max(1, Math.ceil(lamports));
  await db.insert(L).values({ companyId: c.id, kind: "COMPUTE", lamports: -amt, memo, settled: false });
  await db.update(C).set({ lifetimeCompute: bump(C.lifetimeCompute, amt) }).where(eq(C.id, c.id));
}

/**
 * Repay the platform for compute. Prefers USDC on Hyperliquid (instant, no gas) when the bridge is on and the
 * company holds enough; otherwise SOL from the Solana treasury, as before.
 */
export async function settleCompute(c: Company) {
  const rows = await db.select().from(L).where(and(eq(L.companyId, c.id), eq(L.kind, "COMPUTE"), eq(L.settled, false)));
  const total = rows.reduce((a, r) => a - r.lamports, 0);
  if (total < 10_000_000) return;
  let sig: string | null = null;
  if (bridgeReady() && env.platformHlWallet && c.hlAddress) {
    const usd = Math.ceil((total / 1e9) * (await solPrice()) * 100) / 100;
    const bal = await hlBalance(c.hlAddress).catch(() => null);
    if (bal && bal.spotUsdc >= usd) {
      sig = await hlExecute(c, { kind: "spot-send", to: env.platformHlWallet, token: tokenWire("USDC"), amount: usd.toFixed(2) });
    }
  }
  if (!sig) {
    if (!env.platformFeeWallet) return;
    if (isLive() && (await connection().getBalance(new PublicKey(c.treasuryPubkey))) < total + 1_000_000) return; // wait for SOL (or USDC)
    sig = await transferFromTreasury(c.treasurySecretEnc, c.treasuryPubkey, env.platformFeeWallet, total);
  }
  await db.update(L).set({ settled: true, sig }).where(inArray(L.id, rows.map((r) => r.id)));
}
