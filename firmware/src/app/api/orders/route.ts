// Create an order for an offer. Returns the payment instruction (treasury + amount + reference key).
import { z } from "zod";
import { Keypair } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handle, ok, fail } from "@/lib/http";
import { isAddress } from "@/lib/solana";
import { env } from "@/lib/env";
import { sealAddress, type MerchMeta } from "@/lib/merch";
import { usdToLamports, solUsd } from "@/lib/price";
import { evmConfig, methodsFor, normalizeEvm, quote, QUOTE_TTL_MS, SPOT_DEX, USDC_DECIMALS } from "@/lib/hl/payments";
import { isAddress as isEvmAddress } from "viem";
import { tokenWire } from "@/lib/hl/spot";

export const runtime = "nodejs";

const Address = z.object({
  name: z.string().min(2), address1: z.string().min(3), address2: z.string().optional(), city: z.string().min(1),
  state_code: z.string().optional(), country_code: z.string().length(2), zip: z.string().min(2), email: z.string().email().optional().or(z.literal("")), phone: z.string().optional(),
});
const Body = z.object({
  offerId: z.string(), buyerWallet: z.string(),
  // services need a brief; downloads and merch don't
  brief: z.string().trim().max(4000).default(""),
  variantId: z.number().int().optional(),
  shipping: Address.optional(),
  /** sol (default) | hl-core | hl-evm */
  method: z.enum(["sol", "hl-core", "hl-evm"]).default("sol"),
  asset: z.enum(["SOL", "USDC", "HYPE"]).optional(),
});

export const POST = handle(async (req: Request) => {
  const b = Body.parse(await req.json());
  const hl = b.method !== "sol";
  if (hl ? !isEvmAddress(b.buyerWallet, { strict: false }) : !isAddress(b.buyerWallet)) return fail(400, "invalid buyer wallet");
  const o = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, b.offerId), eq(schema.offers.active, true)) });
  if (!o) return fail(404, "offer not available");
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.id, o.companyId) });
  if (!c || c.status !== "LIVE") return fail(409, "company is not live");
  let variantId: number | null = null, shippingEnc: string | null = null;
  if (o.kind === "merch") {
    const meta = JSON.parse(o.meta || "{}") as MerchMeta;
    if (!b.variantId || !meta.variants?.some((v) => v.id === b.variantId)) return fail(400, "pick a size/colour");
    if (!b.shipping) return fail(400, "shipping address required");
    variantId = b.variantId;
    shippingEnc = sealAddress({ ...b.shipping, email: b.shipping.email || undefined });
  } else if (o.kind === "service" && b.brief.length < 5) return fail(400, "describe what you need (at least a few words)");
  const asset = hl ? (b.method === "hl-evm" ? "USDC" : b.asset === "HYPE" ? "HYPE" : "USDC") : "SOL";
  if (!methodsFor(c).some((m) => m.method === b.method && m.asset === asset)) return fail(400, `${b.method === "sol" ? "SOL" : `${asset} on Hyperliquid`} isn't accepted here`);
  const priceUsd = o.priceUsd ?? (o.priceLamports / 1e9) * (await solUsd());
  // SOL checkout of a USD-priced offer is converted at today's SOL price
  const lamports = o.priceUsd ? await usdToLamports(o.priceUsd) : o.priceLamports;
  const reference = Keypair.generate().publicKey.toBase58();

  if (!hl) {
    const [row] = await db.insert(schema.orders).values({
      companyId: c.id, offerId: o.id, buyerWallet: b.buyerWallet, brief: b.brief || o.title, priceLamports: lamports, priceUsd, reference, variantId, shippingEnc,
    }).returning({ id: schema.orders.id });
    return ok({ id: row.id, method: "sol", treasury: c.treasuryPubkey, lamports, reference, mode: env.mode });
  }

  const q = await quote(asset as "USDC" | "HYPE", priceUsd);
  const expires = new Date(Date.now() + QUOTE_TTL_MS);
  const [row] = await db.insert(schema.orders).values({
    companyId: c.id, offerId: o.id, buyerWallet: normalizeEvm(b.buyerWallet), brief: b.brief || o.title, priceLamports: lamports, priceUsd, reference, variantId, shippingEnc,
    payMethod: b.method, payAsset: asset, payAmount: q.amount, quoteExpiresAt: expires,
  }).returning({ id: schema.orders.id });
  const n = evmConfig();
  return ok({
    id: row.id, method: b.method, asset, amount: q.amount, usd: Number(priceUsd.toFixed(2)), to: c.hlAddress, expiresAt: expires.toISOString(), network: env.hlNetwork, mode: env.mode,
    ...(b.method === "hl-core" ? { token: tokenWire(asset as "USDC" | "HYPE") } : {}),
    ...(b.method === "hl-evm" ? { evm: { chainId: n.chainId, rpc: n.rpc, usdc: n.usdc, coreDepositWallet: n.coreDepositWallet, units: String(BigInt(Math.round(Number(q.amount) * 10 ** USDC_DECIMALS))), destinationDex: SPOT_DEX } } : {}),
  });
});
