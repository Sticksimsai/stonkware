// Jupiter swaps for treasuries: SOL ↔ quote tokens (StonkFun pairs) and SOL → the company's own token.
import { VersionedTransaction } from "@solana/web3.js";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export type JupQuote = { outAmount: string; inAmount: string; [k: string]: unknown };

export async function jupQuote(inputMint: string, outputMint: string, amount: bigint | number, slippageBps = 300): Promise<JupQuote> {
  const base = process.env.JUPITER_API_URL || "https://lite-api.jup.ag/swap/v1";
  const r = await fetch(`${base}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=${slippageBps}`, { signal: AbortSignal.timeout(12_000) });
  const q = (await r.json().catch(() => null)) as JupQuote & { error?: string } | null;
  if (!r.ok || !q || q.error || !q.outAmount) throw new Error(`jupiter quote ${inputMint.slice(0, 4)}→${outputMint.slice(0, 4)}: ${q?.error ?? r.status}`);
  return q;
}

/** Swap transaction for `owner` (it pays fees and signs). wSOL is wrapped/unwrapped automatically. */
export async function jupSwapTx(owner: string, inputMint: string, outputMint: string, amount: bigint | number, slippageBps = 300): Promise<{ tx: VersionedTransaction; quote: JupQuote }> {
  const base = process.env.JUPITER_API_URL || "https://lite-api.jup.ag/swap/v1";
  const quote = await jupQuote(inputMint, outputMint, amount, slippageBps);
  const r = await fetch(`${base}/swap`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: owner, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: "auto" }),
  });
  const j = (await r.json().catch(() => ({}))) as { swapTransaction?: string; error?: string };
  if (!j.swapTransaction) throw new Error(`jupiter swap: ${j.error ?? r.status}`);
  return { tx: VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64")), quote };
}
