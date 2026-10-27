// Raydium LaunchLab under StonkFun's platform: launch (Token-2022 base, any StonkFun quote), curve buys,
// and the creator-fee claim. The company treasury is payer + creator, so the creator-fee vault is the treasury's.
import { ComputeBudgetProgram, Connection, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction,
  createSyncNativeInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  LAUNCHPAD_PROGRAM, LaunchpadPool, buyExactInInstruction, claimCreatorFee, getPdaCreatorFeeVaultAuth, getPdaCreatorVault,
  getPdaLaunchpadAuth, getPdaLaunchpadConfigId, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, getPdaPlatformVault, initializeWithToken2022,
} from "@raydium-io/raydium-sdk-v2";
import type { Pricing } from "./stonkfun";
import { WSOL_MINT } from "./jupiter";

export const LAUNCHLAB_PROGRAM = LAUNCHPAD_PROGRAM.toBase58();
const WSOL = new PublicKey(WSOL_MINT);
const LAUNCH_CU = 600_000;

export const isWsol = (mint: string | PublicKey) => new PublicKey(mint).equals(WSOL);

export function programOf(p?: Pick<Pricing, "programId"> | null) {
  return new PublicKey(p?.programId || LAUNCHLAB_PROGRAM);
}

/** Every account a LaunchLab pool for (mintA, mintB) uses. */
export function poolAccounts(programId: PublicKey, mintA: PublicKey, mintB: PublicKey, platformId: PublicKey, creator: PublicKey, configId?: PublicKey) {
  const pool = getPdaLaunchpadPoolId(programId, mintA, mintB).publicKey;
  return {
    programId, mintA, mintB, platformId, creator, pool,
    auth: getPdaLaunchpadAuth(programId).publicKey,
    configId: configId ?? getPdaLaunchpadConfigId(programId, mintB, 0, 0).publicKey,
    vaultA: getPdaLaunchpadVaultId(programId, pool, mintA).publicKey,
    vaultB: getPdaLaunchpadVaultId(programId, pool, mintB).publicKey,
    platformFeeVault: getPdaPlatformVault(programId, platformId, mintB).publicKey,
    creatorFeeVault: getPdaCreatorVault(programId, creator, mintB).publicKey,
    creatorFeeAuth: getPdaCreatorFeeVaultAuth(programId).publicKey,
  };
}

export async function mintProgram(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  if (mint.equals(WSOL)) return TOKEN_PROGRAM_ID;
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error(`quote mint ${mint.toBase58()} not found`);
  return info.owner;
}

export type LaunchParams = {
  pricing: Pricing;
  treasury: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  mintProgramB: PublicKey;
  name: string; symbol: string; uri: string;
  /** Dev buy, in the quote token's raw units. For a wSOL quote this many lamports are wrapped first. */
  devBuyB: bigint;
  microLamports: number;
};

/** Pool creation (+ optional dev buy into the treasury's own token account) in one transaction. Signers: treasury, mintA. */
export function buildLaunchTx(p: LaunchParams): { tx: Transaction; accounts: ReturnType<typeof poolAccounts> } {
  const programId = programOf(p.pricing);
  const a = poolAccounts(programId, p.mintA, p.mintB, new PublicKey(p.pricing.platformId), p.treasury, p.pricing.configId ? new PublicKey(p.pricing.configId) : undefined);
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: LAUNCH_CU }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.microLamports }),
    initializeWithToken2022(
      programId, p.treasury, p.treasury, a.configId, a.platformId, a.auth, a.pool, p.mintA, p.mintB, a.vaultA, a.vaultB, p.mintProgramB,
      p.pricing.baseDecimals, p.name, p.symbol, p.uri,
      { type: "ConstantCurve", totalSellA: new BN(p.pricing.totalSellA), migrateType: p.pricing.migrateType, supply: new BN(p.pricing.supply), totalFundRaisingB: new BN(p.pricing.totalFundRaisingB) },
      new BN(0), new BN(0), new BN(0),
      p.pricing.cpmmCreatorFeeOn ?? 0,
      undefined,
      p.pricing.allowConfig ? new PublicKey(p.pricing.allowConfig) : undefined,
      p.pricing.curveRule ? new PublicKey(p.pricing.curveRule) : undefined,
    ),
  ];
  if (p.devBuyB > 0n) ixs.push(...curveBuyIxs(a, p.treasury, p.mintProgramB, p.devBuyB, 1n));
  return { tx: new Transaction().add(...ixs), accounts: a };
}

/** Buy mintA on the curve with `amountB` of the quote token. For wSOL the lamports are wrapped (and the wrapper closed). */
export function curveBuyIxs(a: ReturnType<typeof poolAccounts>, owner: PublicKey, mintProgramB: PublicKey, amountB: bigint, minA: bigint): TransactionInstruction[] {
  const ataA = getAssociatedTokenAddressSync(a.mintA, owner, false, TOKEN_2022_PROGRAM_ID);
  const ataB = getAssociatedTokenAddressSync(a.mintB, owner, false, mintProgramB);
  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(owner, ataA, owner, a.mintA, TOKEN_2022_PROGRAM_ID),
  ];
  const wsol = a.mintB.equals(WSOL);
  if (wsol) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(owner, ataB, owner, WSOL, TOKEN_PROGRAM_ID),
      SystemProgram.transfer({ fromPubkey: owner, toPubkey: ataB, lamports: amountB }),
      createSyncNativeInstruction(ataB, TOKEN_PROGRAM_ID),
    );
  }
  ixs.push(buyExactInInstruction(
    a.programId, owner, a.auth, a.configId, a.platformId, a.pool, ataA, ataB, a.vaultA, a.vaultB, a.mintA, a.mintB,
    TOKEN_2022_PROGRAM_ID, mintProgramB, a.platformFeeVault, a.creatorFeeVault, new BN(amountB.toString()), new BN(minA.toString()),
  ));
  if (wsol) ixs.push(createCloseAccountInstruction(ataB, owner, owner, [], TOKEN_PROGRAM_ID));
  return ixs;
}

export type PoolState = { pool: PublicKey; status: number; migrated: boolean; mintB: PublicKey; platformId: PublicKey; configId: PublicKey; creator: PublicKey; realB: bigint; totalFundRaisingB: bigint };

/** On-chain pool state, or null if no pool exists. Status 0 = on the curve, 1 = migrating, 2 = graduated. */
export async function poolState(conn: Connection, mintA: PublicKey, mintB: PublicKey, programId = new PublicKey(LAUNCHLAB_PROGRAM)): Promise<PoolState | null> {
  const pool = getPdaLaunchpadPoolId(programId, mintA, mintB).publicKey;
  const info = await conn.getAccountInfo(pool);
  if (!info) return null;
  const d = LaunchpadPool.decode(info.data);
  return {
    pool, status: d.status, migrated: d.status >= 2, mintB: d.mintB, platformId: d.platformId, configId: d.configId, creator: d.creator,
    realB: BigInt(d.realB.toString()), totalFundRaisingB: BigInt(d.totalFundRaisingB.toString()),
  };
}

/** Claim the treasury's creator-fee vault (quote token) into its own quote token account. */
export async function creatorFeeClaim(conn: Connection, programId: PublicKey, treasury: PublicKey, mintB: PublicKey, mintProgramB: PublicKey): Promise<{ ixs: TransactionInstruction[]; amount: bigint } | null> {
  const vault = getPdaCreatorVault(programId, treasury, mintB).publicKey;
  const bal = await conn.getTokenAccountBalance(vault).catch(() => null);
  const amount = bal ? BigInt(bal.value.amount) : 0n;
  if (amount <= 0n) return null;
  const ata = getAssociatedTokenAddressSync(mintB, treasury, false, mintProgramB);
  return {
    amount,
    ixs: [
      createAssociatedTokenAccountIdempotentInstruction(treasury, ata, treasury, mintB, mintProgramB),
      claimCreatorFee(programId, treasury, getPdaCreatorFeeVaultAuth(programId).publicKey, vault, ata, mintB, mintProgramB),
    ],
  };
}
