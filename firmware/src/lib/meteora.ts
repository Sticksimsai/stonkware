// Meteora integration: Hypeware runs its own launchpad on the Dynamic Bonding Curve (DBC).
//  • Hypeware is the DBC *partner*: one config (curve + fees) shared by every company.
//  • Each company's treasury is the pool *creator*: it receives the creator share of trading fees.
//  • Pools graduate to DAMM v2; the treasury then earns LP fees from its locked position.
import { Connection, PublicKey, type Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption, MigrationOption,
  TokenAuthorityOption, TokenDecimal, TokenType, buildCurveWithMarketCap, getCurrentPoint, type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getTokenProgram, getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import { LAUNCHPAD, feeSplitBps } from "./launchpad";

export const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
export { LAUNCHPAD, feeSplitBps };

/** The curve/fee/migration config every Hypeware token launches with. */
export function buildFirmwareConfig(): ConfigParameters {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9,
      // No mint authority, no metadata changes after launch: fixed supply, nothing anyone can rug.
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: LAUNCHPAD.totalSupply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: LAUNCHPAD.startFeeBps,
          endingFeeBps: LAUNCHPAD.feeBps,
          numberOfPeriod: 12,
          totalDuration: LAUNCHPAD.antiSniperSeconds,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken, // fees accrue in SOL
      creatorTradingFeePercentage: LAUNCHPAD.creatorSharePct,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: true, // the treasury's dev buy at launch isn't hit by the anti-sniper fee
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    // After graduation all LP is permanently locked; positions still earn LP fees for their owners.
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100 - LAUNCHPAD.creatorSharePct,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: LAUNCHPAD.creatorSharePct,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: LAUNCHPAD.initialMarketCapSol,
    migrationMarketCap: LAUNCHPAD.migrationMarketCapSol,
  });
}

export function dbc(conn: Connection) {
  return new DynamicBondingCurveClient(conn, "confirmed");
}

const U64_MAX = new BN("18446744073709551615");

/** Pool creation (+ optional dev buy, paid by the treasury, tokens to the creator's wallet) in one transaction. Signers: treasury + mint. */
export async function buildCreatePoolTx(conn: Connection, p: { config: string; treasury: string; mint: string; name: string; symbol: string; uri: string; devBuyLamports: number; devBuyReceiver?: string }): Promise<Transaction> {
  const treasury = new PublicKey(p.treasury);
  return dbc(conn).creator.createPoolWithFirstBuy({
    createPoolParam: {
      name: p.name, symbol: p.symbol, uri: p.uri,
      payer: treasury, poolCreator: treasury,
      config: new PublicKey(p.config), baseMint: new PublicKey(p.mint),
    },
    firstBuyParam: p.devBuyLamports > 0
      ? { buyer: treasury, receiver: p.devBuyReceiver ? new PublicKey(p.devBuyReceiver) : treasury, buyAmount: new BN(p.devBuyLamports), minimumAmountOut: new BN(1), referralTokenAccount: null }
      : undefined,
  });
}

export type PoolInfo = { pool: PublicKey; migrated: boolean; unclaimedCreatorLamports: number };

export async function poolInfo(conn: Connection, mint: string): Promise<PoolInfo | null> {
  const client = dbc(conn);
  const p = await client.state.getPoolByBaseMint(mint);
  if (!p) return null;
  const metrics = await client.state.getPoolFeeMetrics(p.publicKey);
  return { pool: p.publicKey, migrated: Number(p.account.poolState.isMigrated) === 1, unclaimedCreatorLamports: metrics.current.creatorQuoteFee.toNumber() };
}

/** Claim the creator share of DBC trading fees into the treasury (unwraps to native SOL). */
export async function buildClaimCreatorFeeTx(conn: Connection, treasury: string, pool: PublicKey): Promise<Transaction> {
  const t = new PublicKey(treasury);
  return dbc(conn).creator.claimCreatorTradingFee({ creator: t, payer: t, pool, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX });
}

/** Buy the company's own token on the bonding curve (pre-graduation). */
export async function buildCurveBuyTx(conn: Connection, treasury: string, pool: PublicKey, lamports: number, slippageBps = 300): Promise<Transaction> {
  const client = dbc(conn);
  const virtualPool = await client.state.getPool(pool);
  if (!virtualPool) throw new Error("pool not found");
  const config = await client.state.getPoolConfig(virtualPool.poolState.config);
  if (!config) throw new Error("pool config not found");
  const currentPoint = await getCurrentPoint(conn, config.activationType);
  const q = client.pool.swapQuote({
    virtualPool, config, swapBaseForQuote: false, amountIn: new BN(lamports), slippageBps,
    hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint,
  });
  const t = new PublicKey(treasury);
  return client.pool.swap({ owner: t, payer: t, pool, amountIn: new BN(lamports), minimumAmountOut: q.minimumAmountOut, swapBaseForQuote: false, referralTokenAccount: null });
}

/** Post-graduation buy via Jupiter (routes through DAMM v2 or anything with better price). */
export async function buildJupiterBuyTx(treasury: string, mint: string, lamports: number, slippageBps = 300): Promise<VersionedTransaction> {
  const base = process.env.JUPITER_API_URL || "https://lite-api.jup.ag/swap/v1";
  const q = await (await fetch(`${base}/quote?inputMint=${WSOL.toBase58()}&outputMint=${mint}&amount=${lamports}&slippageBps=${slippageBps}`)).json();
  if (!q || q.error) throw new Error(`jupiter quote: ${q?.error ?? "failed"}`);
  const r = await fetch(`${base}/swap`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: treasury, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  });
  const j = (await r.json()) as { swapTransaction?: string; error?: string };
  if (!j.swapTransaction) throw new Error(`jupiter swap: ${j.error ?? r.status}`);
  return VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
}

/** After graduation: claim LP fees from the treasury's locked DAMM v2 position(s). */
export async function buildClaimLpFeeTxs(conn: Connection, treasury: string, mint: string): Promise<{ tx: Transaction; estLamports: number }[]> {
  const cp = new CpAmm(conn);
  const owner = new PublicKey(treasury);
  const positions = await cp.getPositionsByUserAndTokenMint(owner, new PublicKey(mint));
  const out: { tx: Transaction; estLamports: number }[] = [];
  for (const pos of positions) {
    const pool = await cp.fetchPoolState(pos.pool);
    const fee = getUnClaimLpFee(pool, pos.positionState);
    const quoteIsB = pool.tokenBMint.equals(WSOL);
    const est = (quoteIsB ? fee.feeTokenB : fee.feeTokenA).toNumber();
    if (est <= 0) continue;
    const tx = await cp.claimPositionFee2({
      owner, receiver: owner, feePayer: owner, pool: pos.pool, position: pos.position, positionNftAccount: pos.positionNftAccount,
      tokenAMint: pool.tokenAMint, tokenBMint: pool.tokenBMint, tokenAVault: pool.tokenAVault, tokenBVault: pool.tokenBVault,
      tokenAProgram: getTokenProgram(pool.tokenAFlag), tokenBProgram: getTokenProgram(pool.tokenBFlag),
    });
    out.push({ tx, estLamports: est });
  }
  return out;
}
