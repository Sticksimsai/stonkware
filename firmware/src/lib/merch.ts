// Print-on-demand through Printful: the agent designs (generate_image), picks a product and price,
// customers pay SOL and enter a shipping address, and Hypeware submits the order to Printful.
// Printful bills Hypeware's account in USD; the production + shipping cost is charged to the
// company treasury and repaid to PLATFORM_FEE_WALLET like compute.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company, Order } from "@/db/schema";
import { env, isLive } from "./env";
import { seal, open } from "./vault";
import { solUsd, usdToLamports } from "./price";
import { chargeCompute, getCompany } from "./treasury";
import { emit } from "./feed";
import { mediaUrl } from "./media";

const BASE = () => (process.env.PRINTFUL_API_URL || "https://api.printful.com").replace(/\/+$/, "");
export const merchEnabled = () => !!process.env.PRINTFUL_API_KEY;
const SHIPPING_USD = () => Number(process.env.MERCH_SHIPPING_USD || 8);
/** Submit orders for fulfillment automatically? Default: only on mainnet live; drafts everywhere else. */
const autoConfirm = () => (process.env.PRINTFUL_CONFIRM ? process.env.PRINTFUL_CONFIRM === "1" : isLive() && env.cluster !== "devnet");

async function pf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
      ...(process.env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => ({}))) as { code?: number; result?: T; error?: { message?: string } };
  if (!r.ok || (j.code && j.code >= 400)) throw new Error(`printful ${r.status}: ${j.error?.message ?? (typeof j.result === "string" ? j.result : "error")}`);
  return j.result as T;
}

// ───────── catalog ─────────
type CatalogItem = { id: number; title: string; type_name?: string; type?: string; brand?: string; variant_count?: number; is_discontinued?: boolean };
let catalog: { at: number; items: CatalogItem[] } | null = null;
export async function searchCatalog(q: string) {
  if (!catalog || Date.now() - catalog.at > 6 * 3600_000) catalog = { at: Date.now(), items: await pf<CatalogItem[]>("/products") };
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return catalog.items
    .filter((p) => !p.is_discontinued && words.every((w) => `${p.title} ${p.type_name ?? ""} ${p.type ?? ""} ${p.brand ?? ""}`.toLowerCase().includes(w)))
    .slice(0, 25);
}

type Variant = { id: number; name: string; size?: string; color?: string; price: string; in_stock?: boolean };
export async function getProduct(id: number) {
  const r = await pf<{ product: { id: number; title: string; type_name?: string; files?: { type: string; title: string }[] }; variants: Variant[] }>(`/products/${id}`);
  return r;
}

// ───────── offers ─────────
export type MerchMeta = { productId: number; productTitle: string; variants: { id: number; label: string; costUsd: number }[]; designMediaId: string; designUrl: string; placement: string };

export async function createMerchOffer(c: Company, a: { title: string; description: string; productId: number; variantIds: number[]; designMediaId: string; placement?: string; priceSol: number }) {
  if (!merchEnabled()) throw new Error("print-on-demand isn't enabled on this Hypeware server");
  const design = await db.query.media.findFirst({ where: and(eq(schema.media.id, a.designMediaId), eq(schema.media.companyId, c.id)) });
  if (!design || design.kind !== "image" || design.status !== "completed") throw new Error("design_media_id must be one of your completed images (generate_image)");
  const p = await getProduct(a.productId);
  const placements = (p.product.files ?? []).map((f) => f.type).filter((t) => !["preview", "mockup"].includes(t));
  const placement = a.placement || (placements.includes("front") ? "front" : placements[0] ?? "default");
  if (placements.length && !placements.includes(placement)) throw new Error(`placement must be one of: ${placements.join(", ")}`);
  const wanted = new Set(a.variantIds.map(Number));
  const variants = p.variants.filter((v) => wanted.has(v.id) && v.in_stock !== false).slice(0, 30);
  if (!variants.length) throw new Error("none of those variant ids are in stock for this product (see merch_product)");
  const maxCost = Math.max(...variants.map((v) => Number(v.price))) + SHIPPING_USD();
  const minSol = (maxCost * 1.15) / (await solUsd());
  if (a.priceSol < minSol) throw new Error(`price too low: production + shipping is up to $${maxCost.toFixed(2)}; charge at least ${minSol.toFixed(3)} SOL`);
  const meta: MerchMeta = {
    productId: p.product.id, productTitle: p.product.title,
    variants: variants.map((v) => ({ id: v.id, label: [v.size, v.color].filter(Boolean).join(" · ") || v.name, costUsd: Number(v.price) })),
    designMediaId: design.id, designUrl: mediaUrl(design), placement,
  };
  const [o] = await db.insert(schema.offers).values({
    companyId: c.id, title: a.title.slice(0, 100), description: a.description.slice(0, 1000), priceLamports: Math.round(a.priceSol * 1e9), kind: "merch", meta: JSON.stringify(meta),
  }).returning();
  await emit(c.id, "ACTION", `New merch: ${o.title} · ${a.priceSol} SOL`, `${meta.designUrl}\n${p.product.title}, ${variants.length} options`);
  return { offer: o, meta, maxCostUsd: maxCost };
}

// ───────── checkout + fulfillment ─────────
export type Address = { name: string; address1: string; address2?: string; city: string; state_code?: string; country_code: string; zip: string; email?: string; phone?: string };
export function sealAddress(a: Address) {
  const clean: Address = {
    name: a.name.trim().slice(0, 100), address1: a.address1.trim().slice(0, 200), address2: a.address2?.trim().slice(0, 200) || undefined,
    city: a.city.trim().slice(0, 100), state_code: a.state_code?.trim().toUpperCase().slice(0, 10) || undefined, country_code: a.country_code.trim().toUpperCase().slice(0, 2),
    zip: a.zip.trim().slice(0, 20), email: a.email?.trim().slice(0, 200) || undefined, phone: a.phone?.trim().slice(0, 40) || undefined,
  };
  if (!clean.name || !clean.address1 || !clean.city || !/^[A-Z]{2}$/.test(clean.country_code) || !clean.zip) throw new Error("incomplete shipping address");
  return seal(Buffer.from(JSON.stringify(clean)));
}

type Fulfillment = { printfulId?: number; status: string; costUsd?: number; error?: string; tracking?: { carrier: string; number: string; url: string }[]; checkedAt?: number; draft?: boolean };
const getF = (o: Order) => (o.fulfillment ? (JSON.parse(o.fulfillment) as Fulfillment) : null);
const setF = (id: string, f: Fulfillment) => db.update(schema.orders).set({ fulfillment: JSON.stringify(f) }).where(eq(schema.orders.id, id));

/** Called once an order for a merch offer is paid. */
export async function fulfillMerch(orderId: string) {
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!o || !o.shippingEnc || getF(o)) return;
  const offer = await db.query.offers.findFirst({ where: eq(schema.offers.id, o.offerId) });
  const meta = JSON.parse(offer?.meta || "{}") as MerchMeta;
  const c = await getCompany(o.companyId);
  const recipient = JSON.parse(Buffer.from(open(o.shippingEnc)).toString("utf8")) as Address;
  await setF(o.id, { status: "submitting" });
  try {
    const confirm = autoConfirm();
    const r = await pf<{ id: number; status: string; costs?: { total?: string } }>(`/orders?confirm=${confirm ? "true" : "false"}`, {
      method: "POST",
      body: JSON.stringify({
        external_id: o.id,
        shipping: "STANDARD",
        recipient,
        items: [{ variant_id: o.variantId, quantity: 1, retail_price: ((o.priceLamports / 1e9) * (await solUsd())).toFixed(2), files: [{ type: meta.placement, url: meta.designUrl }] }],
        packing_slip: { store_name: c.name.slice(0, 50), message: `Made by ${c.name}, an AI-run company on Hypeware.` },
      }),
    });
    const costUsd = Number(r.costs?.total ?? 0);
    if (costUsd > 0) await chargeCompute(c, await usdToLamports(costUsd), `merch order ${o.id.slice(-6)}: Printful $${costUsd.toFixed(2)}`);
    await setF(o.id, { printfulId: r.id, status: r.status, costUsd, draft: !confirm, checkedAt: Date.now() });
    await emit(c.id, "DELIVERY", confirm ? "Sent an order to print" : "Merch order saved as a draft (test mode)", `${meta.productTitle} → ships to ${recipient.country_code}`);
  } catch (e) {
    await setF(o.id, { status: "failed", error: (e as Error).message.slice(0, 300) });
    await emit(c.id, "SYSTEM", "A merch order couldn't be submitted", (e as Error).message.slice(0, 300));
  }
}

/** Scheduler: follow submitted merch orders until they ship. */
export async function pollMerch() {
  if (!merchEnabled()) return 0;
  const rows = await db.select().from(schema.orders).where(and(eq(schema.orders.status, "PAID"), isNotNull(schema.orders.fulfillment))).limit(30);
  let n = 0;
  for (const o of rows) {
    const f = getF(o)!;
    if (!f.printfulId || ["failed", "canceled", "draft"].includes(f.status) || f.draft || Date.now() - (f.checkedAt ?? 0) < 10 * 60_000) continue;
    n++;
    try {
      const r = await pf<{ status: string; shipments?: { carrier: string; tracking_number: string; tracking_url: string }[] }>(`/orders/@${o.id}`);
      const tracking = (r.shipments ?? []).map((s) => ({ carrier: s.carrier, number: s.tracking_number, url: s.tracking_url }));
      await setF(o.id, { ...f, status: r.status, tracking, checkedAt: Date.now() });
      if (tracking.length) {
        const md = `# Your order has shipped 📦\n\n${tracking.map((t) => `- ${t.carrier}: [${t.number}](${t.url})`).join("\n")}\n\nThanks for supporting this company.`;
        await db.update(schema.orders).set({ status: "DELIVERED", deliverable: md, format: "markdown", deliveredAt: new Date() }).where(and(eq(schema.orders.id, o.id), eq(schema.orders.status, "PAID")));
        await emit(o.companyId, "DELIVERY", "Shipped a merch order", tracking.map((t) => t.carrier).join(", "));
      }
    } catch (e) { console.error("[merch]", o.id, (e as Error).message); }
  }
  return n;
}

/** For the agent's briefing: merch orders, without addresses. */
export async function merchStatus(companyId: string) {
  const rows = await db.select().from(schema.orders).where(and(eq(schema.orders.companyId, companyId), isNotNull(schema.orders.shippingEnc), inArray(schema.orders.status, ["PAID", "DELIVERED"]))).limit(20);
  return rows.map((o) => ({ order: o.id, status: o.status, fulfillment: getF(o)?.status ?? "pending", cost_usd: getF(o)?.costUsd ?? null, error: getF(o)?.error ?? null }));
}

export const publicMerchMeta = (meta: string | null) => {
  if (!meta) return null;
  const m = JSON.parse(meta) as MerchMeta;
  return { productTitle: m.productTitle, designUrl: m.designUrl, variants: m.variants.map((v) => ({ id: v.id, label: v.label })) };
};
