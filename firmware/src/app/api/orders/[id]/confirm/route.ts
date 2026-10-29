// Verify a buyer's payment (transfer to the treasury carrying the order's reference key), book it,
// and wake the agent so it delivers.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handle, ok, fail } from "@/lib/http";
import { connection } from "@/lib/solana";
import { isLive } from "@/lib/env";
import { bookRevenue, getCompany } from "@/lib/treasury";
import { emit } from "@/lib/feed";
import { mockSig } from "@/lib/signer";
import { startShiftNow } from "@/lib/tick";
import { fulfillMerch } from "@/lib/merch";
import { downloadUrl } from "@/lib/packages";
import { verifyCoreTransfer, verifyEvmDeposit, USDC_DECIMALS } from "@/lib/hl/payments";
import { settleHlPayment } from "@/lib/hl/revenue";

export const runtime = "nodejs";

/** signature: Solana signature (sol), HyperEVM tx hash (hl-evm), or optional Hyperliquid tx hash (hl-core) */
const Body = z.object({ signature: z.string().min(4).optional() });

/** Hyperliquid payment → { ref, amount } after verifying it on-chain. */
async function verifyHl(o: typeof schema.orders.$inferSelect, c: Awaited<ReturnType<typeof getCompany>>, signature?: string) {
  if (!c.hlAddress || !o.payAmount) throw new Error("order has no Hyperliquid payment details");
  const min = Number(o.payAmount);
  if (!isLive()) return { ref: mockSig(), amount: min };
  if (o.payMethod === "hl-evm") {
    if (!signature) throw new Error("send the HyperEVM transaction hash");
    const units = await verifyEvmDeposit(signature, o.buyerWallet, c.hlAddress, BigInt(Math.round(min * 10 ** USDC_DECIMALS)));
    return { ref: signature.toLowerCase(), amount: Number(units) / 10 ** USDC_DECIMALS };
  }
  // hl-core: find the buyer's transfer in the company's ledger since the order was created
  const used = new Set((await db.select({ r: schema.orders.paySig }).from(schema.orders).where(eq(schema.orders.companyId, c.id))).map((x) => (x.r ?? "").toLowerCase()));
  const t = await verifyCoreTransfer({ buyer: o.buyerWallet, recipient: c.hlAddress, asset: o.payAsset as "USDC" | "HYPE", min, since: o.createdAt.getTime() - 60_000, hash: signature, used });
  return { ref: t.hash.toLowerCase(), amount: t.amount };
}

async function verifyPayment(sig: string, buyer: string, treasury: string, reference: string, min: number) {
  const tx = await connection().getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx || tx.meta?.err) throw new Error("payment not found or failed — wait a few seconds and retry");
  if (!tx.transaction.message.accountKeys.some((k) => k.pubkey.toBase58() === reference)) throw new Error("payment does not reference this order");
  let paid = 0;
  for (const ix of tx.transaction.message.instructions) {
    if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
      const i = ix.parsed.info as { source: string; destination: string; lamports: number };
      if (i.source === buyer && i.destination === treasury) paid += Number(i.lamports);
    }
  }
  if (paid < min) throw new Error("payment amount too low");
  return paid;
}

export const POST = handle(async (req: Request, { params }: { params: { id: string } }) => {
  const { signature } = Body.parse(await req.json().catch(() => ({})));
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, params.id) });
  if (!o) return fail(404, "order not found");
  if (o.status !== "AWAITING_PAYMENT") return ok({ id: o.id, status: o.status });
  const c = await getCompany(o.companyId);

  if (o.payMethod === "sol") {
    if (!signature) return fail(400, "signature required");
    const sig = isLive() ? signature : mockSig();
    const paid = isLive() ? await verifyPayment(sig, o.buyerWallet, c.treasuryPubkey, o.reference, o.priceLamports) : o.priceLamports;
    const moved = await db.update(schema.orders).set({ status: "PAID", paySig: sig, paidAt: new Date() })
      .where(and(eq(schema.orders.id, o.id), eq(schema.orders.status, "AWAITING_PAYMENT"))).returning({ id: schema.orders.id });
    if (!moved.length) return ok({ id: o.id, status: "PAID" });
    await bookRevenue(c, paid, sig, `order ${o.id}`);
    await emit(c.id, "TREASURY", `+${(paid / 1e9).toFixed(3)} SOL — new order`, "", sig);
  } else {
    // a payment made after the quote expired is still accepted if it covers the quoted amount (we can't refuse it on-chain)
    const { ref, amount } = await verifyHl(o, c, signature);
    const moved = await db.update(schema.orders).set({ status: "PAID", paySig: ref, paidAt: new Date() })
      .where(and(eq(schema.orders.id, o.id), eq(schema.orders.status, "AWAITING_PAYMENT"))).returning({ id: schema.orders.id })
      .catch((e) => { if (/UNIQUE/i.test((e as Error).message)) throw new Error("that payment was already used for another order"); throw e; });
    if (!moved.length) return ok({ id: o.id, status: "PAID" });
    await settleHlPayment(c, { asset: o.payAsset as "USDC" | "HYPE", amount, ref, orderId: o.id });
  }
  const offer = await db.query.offers.findFirst({ where: eq(schema.offers.id, o.offerId) });
  if (offer?.kind === "download") {
    // instant delivery: a signed link to the package the agent built
    const pkg = await db.query.packages.findFirst({ where: eq(schema.packages.id, JSON.parse(offer.meta || "{}").packageId ?? "") });
    if (pkg && pkg.version > 0) {
      const url = downloadUrl(pkg, true);
      const md = `# ${pkg.title || pkg.name}\n\n[⬇ Download v${pkg.version} (.zip)](${url})\n\n${pkg.description}\n\n${pkg.kind === "extension" ? "**Install:** unzip it, open chrome://extensions, turn on Developer mode, click **Load unpacked** and pick the folder." : ""}`;
      await db.update(schema.orders).set({ status: "DELIVERED", deliverable: md, format: "markdown", deliveredAt: new Date() }).where(eq(schema.orders.id, o.id));
      await emit(c.id, "DELIVERY", `Sold a download: ${pkg.title || pkg.name}`, "");
      return ok({ id: o.id, status: "DELIVERED" });
    }
  }
  if (offer?.kind === "merch") {
    void fulfillMerch(o.id).catch((e) => console.error("[merch]", o.id, (e as Error).message));
    return ok({ id: o.id, status: "PAID" });
  }
  startShiftNow(c.id);
  return ok({ id: o.id, status: "PAID" });
});
