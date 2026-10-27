// Copy network-independent setup from an old database (e.g. devnet) into the current one (e.g. mainnet):
//  · unused vanity mint addresses (still unused on the new network)
//  · the flagship company (identity, aim, model, image, treasury key), with fresh history
//  · the flagship's self-improvement record (its GitHub PRs are real either way)
// Never copies launchpad companies, ledgers, orders or feeds: those belong to the old network.
//
//   npm run carry-over -- --from file:/home/firmware/data/devnet.db
import "./_env";
import { createClient } from "@libsql/client";

const i = process.argv.indexOf("--from");
const from = i > 0 ? process.argv[i + 1] : "";

(async () => {
  if (!from) throw new Error("usage: npm run carry-over -- --from file:/path/to/old.db");
  if (from === process.env.DATABASE_URL) throw new Error("--from is the current database");
  const old = createClient({ url: from });
  const { db, schema } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { isLive } = await import("../src/lib/env");
  const { connection } = await import("../src/lib/solana");
  const { PublicKey } = await import("@solana/web3.js");
  const has = async (table: string) => (await old.execute({ sql: "select name from sqlite_master where type='table' and name=?", args: [table] })).rows.length > 0;

  // 1. vanity addresses that were never used for a real token
  let vanity = 0, skipped = 0;
  if (await has("vanity_mints")) {
    for (const r of (await old.execute("select pubkey, secret_enc, source, created_at from vanity_mints where status in ('available','reserved')")).rows) {
      const pubkey = String(r.pubkey);
      if (isLive() && (await connection().getAccountInfo(new PublicKey(pubkey)))) { skipped++; continue; } // already exists on this network
      const ins = await db.insert(schema.vanityMints).values({ pubkey, secretEnc: String(r.secret_enc), source: String(r.source ?? "import"), createdAt: new Date(Number(r.created_at)) }).onConflictDoNothing().returning({ p: schema.vanityMints.pubkey });
      if (ins.length) vanity++;
    }
  }
  console.log(`vanity addresses: ${vanity} carried over${skipped ? `, ${skipped} skipped (already on-chain)` : ""}`);

  // 2. the flagship, with a clean slate
  const f = (await has("companies")) ? (await old.execute("select * from companies where flagship = 1 limit 1")).rows[0] : undefined;
  if (!f) { console.log("flagship: none in the old database"); }
  else if (await db.query.companies.findFirst({ where: eq(schema.companies.flagship, true) })) { console.log("flagship: already exists here, left as is"); }
  else {
    const mint = String(f.mint_pubkey);
    const [c] = await db.insert(schema.companies).values({
      slug: String(f.slug), name: String(f.name), ticker: String(f.ticker), aim: String(f.aim), tagline: String(f.tagline ?? ""),
      model: String(f.model), modelLabel: String(f.model_label), creatorWallet: String(f.creator_wallet),
      treasuryPubkey: String(f.treasury_pubkey), treasurySecretEnc: String(f.treasury_secret_enc),
      // a CA set while testing on devnet isn't the mainnet token: start pre-launch again
      mintPubkey: mint.startsWith("pending-") ? mint : `pending-${String(f.slug)}`, mintSecretEnc: null,
      image: f.image ? Buffer.from(f.image as ArrayBuffer) : null, imageMime: (f.image_mime as string) ?? null, twitter: (f.twitter as string) ?? null,
      status: "LIVE", source: "external", flagship: true, venue: (f.venue as string) ?? "Meteora", memory: String(f.memory ?? "[]"), wakeRequested: true,
    } as typeof schema.companies.$inferInsert).returning();
    console.log(`flagship: $${c.ticker} carried over (pre-launch, same treasury ${c.treasuryPubkey}). Set the mainnet CA on launch day with: npm run flagship -- set-ca <mint>`);
    if (await has("dev_changes")) {
      let n = 0;
      for (const r of (await old.execute({ sql: "select * from dev_changes where company_id = ?", args: [String(f.id)] })).rows) {
        const ins = await db.insert(schema.devChanges).values({
          companyId: c.id, prNumber: Number(r.pr_number), branch: String(r.branch), title: String(r.title), why: String(r.why ?? ""), lane: String(r.lane), status: String(r.status), ci: String(r.ci),
          files: String(r.files ?? "[]"), protectedFiles: String(r.protected_files ?? "[]"), additions: Number(r.additions ?? 0), deletions: Number(r.deletions ?? 0),
          createdAt: new Date(Number(r.created_at)), mergedAt: r.merged_at ? new Date(Number(r.merged_at)) : null,
        }).onConflictDoNothing().returning({ id: schema.devChanges.id });
        n += ins.length;
      }
      if (n) console.log(`flagship: ${n} self-improvement PRs carried over`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
