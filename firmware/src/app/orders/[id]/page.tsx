import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { short } from "@/lib/units";
import OrderView from "./OrderView";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: { id: string } }) {
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, params.id) });
  if (!o) notFound();
  const [s, c] = await Promise.all([
    db.query.offers.findFirst({ where: eq(schema.offers.id, o.offerId) }),
    db.query.companies.findFirst({ where: eq(schema.companies.id, o.companyId), columns: { slug: true, name: true, ticker: true } }),
  ]);
  return (
    <div className="wrap py-10">
      <Link href={`/c/${c?.slug}`} className="font-mono text-xs text-mute hover:text-cream">← {c?.name} (${c?.ticker})</Link>
      <h1 className="mt-3 text-2xl font-display font-bold text-cream glow">{s?.title}</h1>
      <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px] text-mute">
        <span>order {short(o.id, 6)}</span>
        <span>{o.payMethod === "sol" ? `${(o.priceLamports / 1e9).toLocaleString()} SOL` : `${o.payAmount} ${o.payAsset} on Hyperliquid`}</span>
        <span>buyer {short(o.buyerWallet)}</span>
        <span className="text-cream">{o.status.toLowerCase()}</span>
      </div>
      <details className="card mt-6 p-4 text-sm text-soft">
        <summary className="label cursor-pointer">Brief</summary>
        <p className="mt-3 whitespace-pre-line">{o.brief}</p>
      </details>
      <div className="mt-6">
        <OrderView initial={{ id: o.id, status: o.status, format: o.format, deliverable: o.deliverable }} />
      </div>
      <p className="mt-4 text-xs text-mute">Bookmark this page — the link is your receipt.</p>
    </div>
  );
}
