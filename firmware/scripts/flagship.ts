// Set up Stonkware's own token (the flagship) before it launches, then attach the contract address on launch day.
//
//   npm run flagship -- create --name "Stonkware" --ticker FIRM --model anthropic/claude-sonnet-4.5 \
//        --creator <your wallet> --aim-file aim.txt [--image logo.png] [--venue Meteora] [--launch-at 2026-10-20T16:00:00Z]
//   npm run flagship -- set-ca <mint address> [--venue Meteora]
//   npm run flagship -- update [--aim-file f | --aim "…"] [--model id] [--name …] [--image f] [--launch-at ISO|none] [--venue …] [--creator …]
//   npm run flagship -- status
//
// The flagship's agent starts working as soon as it's created (pre-launch), funded by FLAGSHIP_SHARE_PCT
// of Stonkware's platform revenue. Nothing is printed that could leak a key.
import "./_env";
import { readFileSync, existsSync } from "fs";

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) { flags[rest[i].slice(2)] = rest[i + 1] ?? ""; i++; } else positional.push(rest[i]);
}
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function readImage(path: string) {
  if (!existsSync(path)) throw new Error(`image not found: ${path}`);
  const ext = path.split(".").pop()!.toLowerCase();
  if (!MIME[ext]) throw new Error("image must be png, jpg, webp or gif");
  const buf = readFileSync(path);
  if (buf.length > 2 * 1024 * 1024) throw new Error("image must be ≤ 2MB");
  return { image: buf, imageMime: MIME[ext] };
}
const aimArg = () => (flags["aim-file"] ? readFileSync(flags["aim-file"], "utf8").trim() : flags.aim?.trim());
function launchAtArg() {
  if (flags["launch-at"] === undefined) return undefined;
  if (flags["launch-at"] === "none") return null;
  const d = new Date(flags["launch-at"]);
  if (isNaN(d.getTime())) throw new Error("--launch-at must be an ISO date, e.g. 2026-10-20T16:00:00Z");
  return d;
}

(async () => {
  const { db, schema } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { findModel } = await import("../src/lib/models");
  const { isAddress, connection } = await import("../src/lib/solana");
  const { newSealedKeypair } = await import("../src/lib/signer");
  const { slugify } = await import("../src/lib/slug");
  const { emit } = await import("../src/lib/feed");
  const { getFlagship, pendingMint, isPrelaunch, flagshipSharePct, platformShareTotal } = await import("../src/lib/flagship");
  const { treasuryBalance } = await import("../src/lib/treasury");
  const { isLive, env } = await import("../src/lib/env");
  const C = schema.companies;
  const existing = await getFlagship(true);

  if (cmd === "create") {
    if (existing) throw new Error(`a flagship already exists ($${existing.ticker}); use update`);
    const name = (flags.name ?? "").trim(), ticker = (flags.ticker ?? "").trim().toUpperCase(), aim = aimArg() ?? "";
    if (name.length < 2) throw new Error("--name is required");
    if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new Error("--ticker: 2–10 letters/numbers");
    if (aim.length < 20) throw new Error("--aim or --aim-file (at least 20 characters) is required");
    if (!flags.creator || !isAddress(flags.creator)) throw new Error("--creator <your wallet address> is required (it signs bot connections on the page)");
    const model = await findModel(flags.model ?? "");
    if (!model) throw new Error(`unknown model "${flags.model}". See the launch page's model list for ids.`);
    let slug = slugify(ticker);
    for (let i = 2; await db.query.companies.findFirst({ where: eq(C.slug, slug) }); i++) slug = `${slugify(ticker)}-${i}`;
    const treasury = newSealedKeypair();
    const img = flags.image ? readImage(flags.image) : { image: null, imageMime: null };
    const [c] = await db.insert(C).values({
      slug, name, ticker, aim, tagline: (flags.tagline ?? aim).slice(0, 140), model: model.id, modelLabel: model.label, creatorWallet: flags.creator,
      treasuryPubkey: treasury.pubkey, treasurySecretEnc: treasury.sealed, mintPubkey: pendingMint(slug), mintSecretEnc: null,
      ...img, twitter: flags.twitter || null,
      status: "LIVE", source: "external", flagship: true, venue: flags.venue || "Meteora", launchAt: launchAtArg() ?? null, wakeRequested: true,
    } as typeof C.$inferInsert).returning();
    await emit(c.id, "SYSTEM", `$${ticker} is being prepared`, "The flagship company is set up. Its agent starts building before the token launches.");
    console.log(`✓ flagship $${ticker} created (page: ${env.appUrl}/token)`);
    console.log(`  treasury: ${treasury.pubkey}`);
    console.log(`  model: ${model.label}`);
    console.log(`  funding: ${flagshipSharePct()}% of Stonkware's platform revenue (FLAGSHIP_SHARE_PCT). Send some SOL to the treasury to get it started.`);
    console.log("  on launch day: npm run flagship -- set-ca <mint>");
  } else if (cmd === "set-ca") {
    if (!existing) throw new Error("create the flagship first");
    const mint = positional[0] ?? flags.mint;
    if (!mint || !isAddress(mint)) throw new Error("usage: npm run flagship -- set-ca <mint address>");
    if (isLive()) {
      const info = await connection().getParsedAccountInfo(new (await import("@solana/web3.js")).PublicKey(mint));
      const parsed = (info.value?.data as { parsed?: { type?: string } } | undefined)?.parsed;
      if (!info.value || parsed?.type !== "mint") throw new Error(`${mint} is not a token mint on ${env.cluster} (check the address and SOLANA_RPC_URL)`);
    }
    const clash = await db.query.companies.findFirst({ where: eq(C.mintPubkey, mint) });
    if (clash && clash.id !== existing.id) throw new Error(`that mint already belongs to $${clash.ticker}`);
    await db.update(C).set({ mintPubkey: mint, venue: flags.venue || existing.venue, launchAt: existing.launchAt ?? new Date(), wakeRequested: true, sleepingUntil: null }).where(eq(C.id, existing.id));
    await emit(existing.id, "SYSTEM", `$${existing.ticker} is live`, `Contract address: ${mint}`);
    console.log(`✓ $${existing.ticker} is live with CA ${mint}. The page now shows price, chart and buy links; the agent was woken up.`);
  } else if (cmd === "update") {
    if (!existing) throw new Error("create the flagship first");
    const patch: Partial<typeof C.$inferInsert> = {};
    const aim = aimArg();
    if (aim) { if (aim.length < 20) throw new Error("aim must be at least 20 characters"); patch.aim = aim; }
    if (flags.model) { const m = await findModel(flags.model); if (!m) throw new Error(`unknown model ${flags.model}`); patch.model = m.id; patch.modelLabel = m.label; }
    if (flags.name) patch.name = flags.name.trim();
    if (flags.tagline) patch.tagline = flags.tagline.slice(0, 140);
    if (flags.venue) patch.venue = flags.venue;
    if (flags.twitter) patch.twitter = flags.twitter;
    if (flags.creator) { if (!isAddress(flags.creator)) throw new Error("--creator must be a wallet address"); patch.creatorWallet = flags.creator; }
    if (flags.image) Object.assign(patch, readImage(flags.image));
    const la = launchAtArg(); if (la !== undefined) patch.launchAt = la;
    if (!Object.keys(patch).length) throw new Error("nothing to update");
    await db.update(C).set({ ...patch, wakeRequested: true }).where(eq(C.id, existing.id));
    console.log(`✓ updated: ${Object.keys(patch).filter((k) => k !== "imageMime").join(", ")}`);
  } else if (cmd === "status") {
    if (!existing) { console.log("no flagship yet: npm run flagship -- create …"); process.exit(0); }
    console.log(`$${existing.ticker} · ${existing.name} · ${isPrelaunch(existing) ? "PRE-LAUNCH" : `LIVE (${existing.mintPubkey})`}`);
    console.log(`  page ${env.appUrl}/token · treasury ${existing.treasuryPubkey} · model ${existing.modelLabel}`);
    console.log(`  launch ${existing.launchAt?.toISOString() ?? "not scheduled"} · venue ${existing.venue ?? "-"}`);
    console.log(`  platform revenue received: ${((await platformShareTotal(existing.id)) / 1e9).toFixed(4)} SOL (share ${flagshipSharePct()}%)`);
    const bal = await treasuryBalance(existing).catch(() => null);
    const t = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never");
    const asleep = existing.sleepingUntil && existing.sleepingUntil > new Date();
    console.log(`  treasury balance: ${bal == null ? "?" : (bal / 1e9).toFixed(4)} SOL${bal != null && bal < 13_000_000 ? "  ← needs ≥ 0.013 SOL to work" : ""}`);
    console.log(`  agent: last shift ${t(existing.lastRunAt)} · ${existing.wakeRequested ? "starting now" : asleep ? `sleeping until ${t(existing.sleepingUntil)}` : `next shift ${existing.nextShiftAt ? t(existing.nextShiftAt) : "when due"}`}`);
    if (asleep || !existing.lastRunAt) console.log(`  start it now: npm run company -- wake ${existing.slug}`);
  } else {
    console.log("usage: npm run flagship -- create|set-ca|update|status  (see the top of scripts/flagship.ts)");
  }
  process.exit(0);
})().catch((e) => { const c = (e as { cause?: Error }).cause; console.error(`✗ ${(e as Error).message.split("\n")[0].slice(0, 160)}${c ? `\n  cause: ${c.message}` : ""}\n  database: ${process.env.DATABASE_URL || "file:./firmware.db (DATABASE_URL not set: run this from /home/firmware/app)"}`); process.exit(1); });
