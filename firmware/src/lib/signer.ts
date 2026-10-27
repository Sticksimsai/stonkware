// The isolated signer. This is the ONLY module that decrypts keys.
// It refuses any transaction that touches programs outside the allow-list, isn't paid by
// the treasury, or moves SOL top-level beyond what the declared intent permits.
// In production run this behind its own service boundary (separate process / HSM / KMS).
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { randomBytes } from "crypto";
import bs58 from "bs58";
import { connection } from "./solana";
import { open, seal } from "./vault";
import { isLive } from "./env";

export const PROGRAMS = {
  system: "11111111111111111111111111111111",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  meteoraDbc: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  meteoraDammV2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  metaplex: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  // Raydium (StonkFun launches): LaunchLab curve, CPMM after graduation + its fee-key lock, CLMM
  raydiumLaunchlab: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  raydiumCpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  raydiumLockCpmm: "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE",
  raydiumClmm: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  raydiumAmmV4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
} as const;

const EXTRA = (process.env.SIGNER_EXTRA_PROGRAMS || "").split(",").map((s) => s.trim()).filter(Boolean);
const ALLOWED = new Set<string>([...Object.values(PROGRAMS), ...EXTRA]);

export type Intent =
  | { kind: "launch"; maxTopLevelSolOut: number } // Meteora DBC pool creation + dev buy
  | { kind: "trade"; maxTopLevelSolOut: number } // buyback on the curve or via Jupiter
  | { kind: "claim-fees"; maxTopLevelSolOut: number }
  | { kind: "burn" }
  | { kind: "token-transfer" } // moving the company's tokens (e.g. dev buy to the creator); no SOL may leave
  | { kind: "transfer"; to: string; lamports: number }; // platform fee or approved payout

export class SignerRefusal extends Error {}

/** Generate a fresh keypair and return only its sealed secret + pubkey. */
export function newSealedKeypair(): { pubkey: string; sealed: string } {
  const kp = Keypair.generate();
  return { pubkey: kp.publicKey.toBase58(), sealed: seal(kp.secretKey) };
}

function unseal(sealed: string): Keypair {
  return Keypair.fromSecretKey(open(sealed));
}

async function resolveInstructions(tx: VersionedTransaction): Promise<{ payer: PublicKey; ixs: TransactionInstruction[] }> {
  const msg = tx.message;
  let luts: AddressLookupTableAccount[] = [];
  if (msg.addressTableLookups.length) {
    luts = await Promise.all(
      msg.addressTableLookups.map(async (l) => {
        const r = await connection().getAddressLookupTable(l.accountKey);
        if (!r.value) throw new SignerRefusal("unresolvable lookup table");
        return r.value;
      }),
    );
  }
  const keys = msg.getAccountKeys({ addressLookupTableAccounts: luts });
  const ixs = msg.compiledInstructions.map(
    (ci) =>
      new TransactionInstruction({
        programId: keys.get(ci.programIdIndex)!,
        keys: ci.accountKeyIndexes.map((i) => ({ pubkey: keys.get(i)!, isSigner: msg.isAccountSigner(i), isWritable: msg.isAccountWritable(i) })),
        data: Buffer.from(ci.data),
      }),
  );
  return { payer: keys.get(0)!, ixs };
}

/** Pure inspection — exported for tests. Throws SignerRefusal on violation. */
export function inspect(payer: PublicKey, ixs: TransactionInstruction[], treasury: PublicKey, intent: Intent) {
  if (!payer.equals(treasury)) throw new SignerRefusal("fee payer must be the company treasury");
  let solOut = 0;
  for (const ix of ixs) {
    const pid = ix.programId.toBase58();
    if (!ALLOWED.has(pid)) throw new SignerRefusal(`program not allow-listed: ${pid}`);
    if (pid !== PROGRAMS.system) continue;
    const type = SystemInstruction.decodeInstructionType(ix);
    if (type === "Transfer") {
      const t = SystemInstruction.decodeTransfer(ix);
      if (!t.fromPubkey.equals(treasury)) continue;
      const amt = Number(t.lamports);
      if (intent.kind === "transfer") {
        if (t.toPubkey.toBase58() !== intent.to || amt !== intent.lamports) throw new SignerRefusal("transfer does not match approved intent");
      }
      solOut += amt;
    } else if (type === "Create" || type === "CreateWithSeed") {
      // Account creation (rent). Counted toward SOL out so it is bounded by the intent cap.
      if (intent.kind === "transfer") throw new SignerRefusal("account creation not allowed in transfer intent");
      const d = type === "Create" ? SystemInstruction.decodeCreateAccount(ix) : SystemInstruction.decodeCreateWithSeed(ix);
      if (d.fromPubkey.equals(treasury)) solOut += Number(d.lamports);
    } else {
      throw new SignerRefusal(`system instruction not allowed: ${type}`);
    }
  }
  if (intent.kind === "transfer") {
    if (solOut !== intent.lamports) throw new SignerRefusal("unexpected SOL movement for transfer intent");
  } else if (intent.kind === "burn" || intent.kind === "token-transfer") {
    if (solOut > 0) throw new SignerRefusal(`${intent.kind} must not move SOL`);
  } else if (solOut > intent.maxTopLevelSolOut) {
    throw new SignerRefusal(`top-level SOL out ${solOut} exceeds intent cap ${intent.maxTopLevelSolOut}`);
  }
}

export type SignArgs = {
  treasurySealed: string;
  treasuryPubkey: string;
  tx: VersionedTransaction | Transaction;
  intent: Intent;
  /** Sealed extra signer (the mint keypair on launch). */
  extraSealed?: string;
};

const mockSig = () => "mock" + bs58.encode(randomBytes(40)).slice(0, 80);

/**
 * Priority fee (micro-lamports per compute unit). Without one, transactions are often dropped on a busy
 * mainnet and expire ("block height exceeded"). Uses recent network fees (75th percentile), clamped.
 * PRIORITY_MICROLAMPORTS overrides; PRIORITY_MAX_MICROLAMPORTS caps it.
 */
export async function priorityMicroLamports(): Promise<number> {
  const fixed = Number(process.env.PRIORITY_MICROLAMPORTS || 0);
  if (fixed > 0) return Math.floor(fixed);
  const max = Number(process.env.PRIORITY_MAX_MICROLAMPORTS || 1_000_000);
  try {
    const fees = (await connection().getRecentPrioritizationFees()).map((f) => f.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
    const p75 = fees.length ? fees[Math.floor(fees.length * 0.75)] : 0;
    return Math.min(max, Math.max(50_000, Math.ceil(p75 * 1.2)));
  } catch {
    return Math.min(max, 100_000);
  }
}

/** Inspect, sign, send and confirm. Returns the signature. */
export async function signAndSend({ treasurySealed, treasuryPubkey, tx, intent, extraSealed }: SignArgs): Promise<string> {
  const treasury = new PublicKey(treasuryPubkey);
  const conn = connection();
  const bh = await conn.getLatestBlockhash("confirmed");
  let raw: Uint8Array;
  const kp = unseal(treasurySealed);
  if (!kp.publicKey.equals(treasury)) throw new SignerRefusal("sealed key does not match treasury");
  const signers = [kp];
  if (extraSealed) signers.push(unseal(extraSealed));

  if (tx instanceof Transaction) {
    // legacy transactions (Meteora SDKs): add a priority fee if the SDK didn't, pin payer + blockhash, then inspect
    if (!tx.instructions.some((ix) => ix.programId.toBase58() === PROGRAMS.computeBudget)) {
      tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: await priorityMicroLamports() }));
    }
    tx.feePayer = treasury;
    tx.recentBlockhash = bh.blockhash;
    inspect(treasury, tx.instructions, treasury, intent);
    tx.sign(...signers);
    raw = tx.serialize();
  } else {
    const { payer, ixs } = await resolveInstructions(tx);
    inspect(payer, ixs, treasury, intent);
    tx.message.recentBlockhash = bh.blockhash; // fresh blockhash so it matches the expiry we track below
    tx.sign(signers);
    raw = tx.serialize();
  }

  return sendUntilConfirmed(raw, bh.lastValidBlockHeight);
}

/** Send, then keep re-broadcasting every 2s until confirmed or the blockhash expires. */
async function sendUntilConfirmed(raw: Uint8Array, lastValidBlockHeight: number): Promise<string> {
  const conn = connection();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      // last look: it may have landed in the final blocks
      const last = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (last && !last.err && last.confirmationStatus) return sig;
      throw new Error(`Signature ${sig} has expired: block height exceeded. Nothing was spent; it can be retried.`);
    }
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  }
}

/**
 * Inspect + sign a transaction someone else built (e.g. StonkFun's fee-claim intent) WITHOUT sending it.
 * Returns the signed transaction, base64. Accepts legacy or versioned, base64-encoded.
 */
export async function signOnly(treasurySealed: string, treasuryPubkey: string, txBase64: string, intent: Intent): Promise<string> {
  const treasury = new PublicKey(treasuryPubkey);
  const kp = unseal(treasurySealed);
  if (!kp.publicKey.equals(treasury)) throw new SignerRefusal("sealed key does not match treasury");
  const buf = Buffer.from(txBase64, "base64");
  try {
    const vtx = VersionedTransaction.deserialize(buf);
    const { payer, ixs } = await resolveInstructions(vtx);
    inspect(payer, ixs, treasury, intent);
    vtx.sign([kp]);
    return Buffer.from(vtx.serialize()).toString("base64");
  } catch (e) {
    if (e instanceof SignerRefusal) throw e;
    const tx = Transaction.from(buf);
    inspect(tx.feePayer ?? treasury, tx.instructions, treasury, intent);
    tx.partialSign(kp);
    return tx.serialize({ requireAllSignatures: false }).toString("base64");
  }
}

/** Build + sign a plain SOL transfer from the treasury (platform fee, approved payout). */
/** Compute units a plain transfer + 2 compute-budget instructions needs (with headroom). */
export const TRANSFER_CU = 1_000;
/** Total network fee for transferFromTreasury at a given priority: base signature fee + priority. */
export const transferFeeLamports = (microLamports: number) => 5_000 + Math.ceil((TRANSFER_CU * microLamports) / 1e6);

export async function transferFromTreasury(treasurySealed: string, treasuryPubkey: string, to: string, lamports: number, opts: { microLamports?: number } = {}): Promise<string> {
  if (!isLive()) return mockSig();
  const { TransactionMessage } = await import("@solana/web3.js");
  const conn = connection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const from = new PublicKey(treasuryPubkey);
  const msg = new TransactionMessage({
    payerKey: from,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: TRANSFER_CU }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.microLamports ?? (await priorityMicroLamports()) }),
      SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(to), lamports }),
    ],
  }).compileToV0Message();
  return signAndSend({ treasurySealed, treasuryPubkey, tx: new VersionedTransaction(msg), intent: { kind: "transfer", to, lamports } });
}

/** Sign arbitrary instructions (used for burns) — still inspected. */
export async function signInstructions(treasurySealed: string, treasuryPubkey: string, instructions: TransactionInstruction[], intent: Intent): Promise<string> {
  if (!isLive()) return mockSig();
  const { TransactionMessage } = await import("@solana/web3.js");
  const conn = connection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: new PublicKey(treasuryPubkey), recentBlockhash: blockhash, instructions }).compileToV0Message();
  return signAndSend({ treasurySealed, treasuryPubkey, tx: new VersionedTransaction(msg), intent });
}

export { mockSig };
