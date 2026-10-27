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

export const runtime = "nodejs";

const Body = z.object({ signature: z.string().min(4) });

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
  const { signature } = Body.parse(await req.json());
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, params.id) });
  if (!o) return fail(404, "order not found");
  if (o.status !== "AWAITING_PAYMENT") return ok({ id: o.id, status: o.status });
  const c = await getCompany(o.companyId);
  const sig = isLive() ? signature : mockSig();
  const paid = isLive() ? await verifyPayment(sig, o.buyerWallet, c.treasuryPubkey, o.reference, o.priceLamports) : o.priceLamports;

  const moved = await db.update(schema.orders).set({ status: "PAID", paySig: sig, paidAt: new Date() })
    .where(and(eq(schema.orders.id, o.id), eq(schema.orders.status, "AWAITING_PAYMENT"))).returning({ id: schema.orders.id });
  if (!moved.length) return ok({ id: o.id, status: "PAID" });

  await bookRevenue(c, paid, sig, `order ${o.id}`);
  await emit(c.id, "TREASURY", `+${(paid / 1e9).toFixed(3)} SOL — new order`, "", sig);
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
