// Step 1 of launch: register the company (identity + aim + model), create sealed treasury & mint keys,
// and tell the creator how much to deposit. Nothing touches the chain yet.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { FEES, launchDeposit } from "@/lib/fees";
import { env, isLive } from "@/lib/env";
import { handle, ok, fail } from "@/lib/http";
import { findModel } from "@/lib/models";
import { isAddress } from "@/lib/solana";
import { newSealedKeypair } from "@/lib/signer";
import { newHlKeys } from "@/lib/hl/accounts";
import { slugify } from "@/lib/slug";
import { lamports } from "@/lib/units";
import { RESERVED_SUBDOMAINS } from "@/lib/sites";
import { attachVanity, mintForLaunch } from "@/lib/vanity";
import { findPair } from "@/lib/stonkfun";
import { WSOL_MINT } from "@/lib/jupiter";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(2).max(32),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "2–10 letters/numbers"),
  aim: z.string().trim().min(20, "describe the aim in at least 20 characters").max(3000),
  model: z.string().min(3).max(120),
  devBuySol: z.number().min(0).max(50),
  fuelSol: z.number().min(0).max(50).default(FEES.defaultFuelSol),
  twitter: z.string().trim().max(120).optional().or(z.literal("")),
  creatorWallet: z.string(),
  /** StonkFun quote token (from /api/pairs). Defaults to SOL. */
  quoteMint: z.string().min(3).max(64).optional(),
});

const MAX_IMAGE = 2 * 1024 * 1024;

export const POST = handle(async (req: Request) => {
  const fd = await req.formData();
  const b = Body.parse(JSON.parse(String(fd.get("payload") ?? "{}")));
  if (!isAddress(b.creatorWallet)) return fail(400, "creatorWallet is not a valid address");
  const model = await findModel(b.model);
  if (!model) return fail(400, "unknown or unavailable model");

  // StonkFun venue: the coin pairs with a quote token from StonkFun's list (SOL by default)
  let quote: { mint: string; symbol: string } | null = null;
  if (env.launchVenue === "stonkfun") {
    const mint = b.quoteMint || WSOL_MINT;
    if (mint === WSOL_MINT) quote = { mint, symbol: "SOL" };
    else if (isLive()) {
      const p = await findPair(mint).catch(() => null);
      if (!p) return fail(400, "that quote token isn't launchable on StonkFun right now");
      quote = { mint: p.mint, symbol: p.symbol };
    } else quote = { mint, symbol: mint.replace(/^mock-/, "").toUpperCase().replace(/X$/, "x") };
  }

  const file = fd.get("image");
  let image: Buffer | null = null;
  let imageMime: string | null = null;
  if (file && typeof file !== "string") {
    if (file.size > MAX_IMAGE) return fail(400, "image must be ≤ 2MB");
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return fail(400, "image must be png, jpg, gif or webp");
    image = Buffer.from(await file.arrayBuffer());
    imageMime = file.type;
  } else if (isLive()) return fail(400, "an image is required");

  const baseSlug = RESERVED_SUBDOMAINS.has(slugify(b.ticker)) ? `${slugify(b.ticker)}-co` : slugify(b.ticker);
  let slug = baseSlug;
  for (let i = 2; await db.query.companies.findFirst({ where: eq(schema.companies.slug, slug) }); i++) slug = `${baseSlug}-${i}`;

  const treasury = newSealedKeypair();
  const mint = await mintForLaunch(); // vanity CA (e.g. …firm) when the pool has one
  const required = launchDeposit(lamports(b.devBuySol), lamports(b.fuelSol));

  const [c] = await db.insert(schema.companies).values({
    slug, name: b.name, ticker: b.ticker, aim: b.aim, tagline: b.aim.slice(0, 140), image, imageMime, twitter: b.twitter || null,
    model: model.id, modelLabel: model.label, creatorWallet: b.creatorWallet,
    treasuryPubkey: treasury.pubkey, treasurySecretEnc: treasury.sealed, mintPubkey: mint.pubkey, mintSecretEnc: mint.sealed, ...newHlKeys(),
    devBuySol: b.devBuySol, fuelSol: b.fuelSol, requiredLamports: required,
    quoteMint: quote?.mint ?? null, quoteSymbol: quote?.symbol ?? null, venue: quote ? "StonkFun" : null,
  }).returning({ id: schema.companies.id });
  if (mint.vanity) await attachVanity(mint.pubkey, c.id);

  return ok({ id: c.id, slug, treasury: treasury.pubkey, mint: mint.pubkey, lamports: required, mode: env.mode, quote });
});
