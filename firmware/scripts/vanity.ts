// Vanity mint pool for launches (contract addresses ending in e.g. "firm").
//
//   npm run vanity -- import ~/vanity/*.json          add solana-keygen style keypair files to the pool
//   npm run vanity -- grind --suffix firm --count 10  generate more on this machine (background-friendly)
//   npm run vanity -- grind --if-below 10 --count 3    only refill when the pool runs low (for cron)
//   npm run vanity -- status                           pool size
//
// Keys are sealed with VAULT_KEY as they enter the pool. Secrets are never printed.
// After importing, delete the JSON files (shred -u *.json).
import "./_env";
import { readFileSync, existsSync } from "fs";
import { cpus } from "os";
import { join } from "path";
import { Worker } from "worker_threads";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const files: string[] = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith("--")) { flags[rest[i].slice(2)] = rest[i + 1] ?? ""; i++; } else files.push(rest[i]); }

async function main() {
  const { Keypair, PublicKey } = await import("@solana/web3.js");
  const { db, schema } = await import("../src/db");
  const { seal } = await import("../src/lib/vault");
  const { poolStats } = await import("../src/lib/vanity");
  const { isLive } = await import("../src/lib/env");
  const { connection } = await import("../src/lib/solana");
  const V = schema.vanityMints;

  async function add(secret: Uint8Array, source: string) {
    const kp = Keypair.fromSecretKey(secret); // throws if the pubkey doesn't match the secret
    const pubkey = kp.publicKey.toBase58();
    const taken = await db.query.companies.findFirst({ where: (c, { eq }) => eq(c.mintPubkey, pubkey), columns: { id: true } });
    if (taken) return `${pubkey} already used by a company, skipped`;
    if (isLive() && (await connection().getAccountInfo(new PublicKey(pubkey)))) return `${pubkey} already exists on-chain, skipped`;
    const r = await db.insert(V).values({ pubkey, secretEnc: seal(kp.secretKey), source }).onConflictDoNothing().returning({ p: V.pubkey });
    return r.length ? `${pubkey} ✓ added` : `${pubkey} already in the pool`;
  }

  if (cmd === "import") {
    if (!files.length) throw new Error("usage: npm run vanity -- import <keypair.json …>");
    for (const f of files) {
      if (!existsSync(f)) { console.log(`${f}: not found`); continue; }
      try {
        const arr = JSON.parse(readFileSync(f, "utf8"));
        if (!Array.isArray(arr) || arr.length !== 64) throw new Error("not a 64-byte keypair array");
        console.log(await add(Uint8Array.from(arr), "import"));
      } catch (e) { console.log(`${f}: ${(e as Error).message}`); }
    }
    console.log("pool:", await poolStats(), "\nNow delete the files: shred -u <files>");
  } else if (cmd === "grind") {
    const suffix = flags.suffix || process.env.VANITY_SUFFIX || "stnk";
    if (![...suffix].every((ch) => ALPHABET.includes(ch))) throw new Error(`"${suffix}" has characters base58 can't contain (no 0, O, I, l)`);
    if (suffix.length > 5) throw new Error("suffixes longer than 5 characters take days per key");
    let count = Number(flags.count || 5);
    if (flags["if-below"]) {
      const { available } = await poolStats();
      const want = Number(flags["if-below"]);
      if (available >= want) { console.log(`pool has ${available} available (≥ ${want}), nothing to do`); process.exit(0); }
      count = Math.min(count, want - available);
    }
    const threads = Math.max(1, Math.min(Number(flags.threads || Math.max(1, cpus().length - 1)), cpus().length));
    console.log(`grinding ${count} × …${suffix} on ${threads} thread(s); expect ~${Math.round(58 ** suffix.length / 20_000 / 60 / threads)} min per key`);
    let found = 0, tries = 0;
    const started = Date.now();
    const workerFile = join(process.cwd(), "scripts", "vanity-worker.mjs");
    const workers = Array.from({ length: threads }, () => new Worker(workerFile, { workerData: { suffix } }));
    await new Promise<void>((resolve) => {
      for (const w of workers) {
        w.on("message", async (m: { secret?: number[]; tries: number }) => {
          tries += m.tries;
          if (!m.secret || found >= count) return;
          found++;
          console.log(`[${Math.round((Date.now() - started) / 1000)}s, ${(tries / 1e6).toFixed(1)}M tries] ${await add(Uint8Array.from(m.secret), "grind")}`);
          if (found >= count) resolve();
        });
        w.on("error", (e) => console.error("worker:", e.message));
      }
    });
    await Promise.all(workers.map((w) => w.terminate()));
    console.log("pool:", await poolStats());
  } else if (cmd === "status") {
    console.log("pool:", await poolStats());
    const next = await db.select({ p: V.pubkey }).from(V).where((await import("drizzle-orm")).eq(V.status, "available")).limit(3);
    if (next.length) console.log("next up:", next.map((n) => n.p).join(", "));
  } else {
    console.log("usage: npm run vanity -- import <files…> | grind --suffix firm --count 10 [--threads 2] | status");
  }
  process.exit(0);
}
main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
