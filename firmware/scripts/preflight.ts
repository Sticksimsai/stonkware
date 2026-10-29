// Pre-launch checklist for the droplet. Prints ✓ / ! / ✗ per item. Never prints secret values.
//   npm run preflight
import "./_env";
import { existsSync, readFileSync, statSync } from "fs";
import { execSync } from "child_process";

type Level = "ok" | "warn" | "fail";
const rows: { level: Level; area: string; msg: string }[] = [];
const add = (level: Level, area: string, msg: string) => rows.push({ level, area, msg });
const sh = (cmd: string) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).toString().trim(); } catch { return ""; } };
const set = (k: string) => !!process.env[k] && process.env[k] !== "";

(async () => {
  const { env, isLive } = await import("../src/lib/env");
  const { connection, isAddress } = await import("../src/lib/solana");
  const { PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");

  // ── mode & network ──
  add(isLive() ? "ok" : "warn", "mode", `FIRMWARE_MODE=${env.mode}${isLive() ? "" : " (switch with deploy/go-live-mainnet.sh)"}`);
  add(env.cluster === "mainnet-beta" ? "ok" : "warn", "network", `cluster ${env.cluster}`);
  if (/api\.mainnet-beta\.solana\.com/.test(env.rpcUrl)) add("fail", "rpc", "using the public mainnet RPC: fee claims will fail. Use Helius/Triton/QuickNode.");
  try {
    const slot = await connection().getSlot();
    const genesis = await connection().getGenesisHash();
    const mainnet = genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    add(mainnet === (env.cluster === "mainnet-beta") ? "ok" : "fail", "rpc", `reachable (slot ${slot}), ${mainnet ? "mainnet" : "not mainnet"}${mainnet === (env.cluster === "mainnet-beta") ? "" : ": doesn't match SOLANA_CLUSTER"}`);
  } catch (e) { add("fail", "rpc", `SOLANA_RPC_URL unreachable: ${(e as Error).message.slice(0, 120)}`); }
  add(set("PUBLIC_SOLANA_RPC_URL") ? "ok" : "warn", "rpc", set("PUBLIC_SOLANA_RPC_URL") ? "website RPC set (make sure its key is restricted to your domain)" : "PUBLIC_SOLANA_RPC_URL not set: the website falls back to the public RPC");

  // ── keys & wallets ──
  add(/^[0-9a-f]{64}$/i.test(env.vaultKey) ? "ok" : "fail", "vault", /^[0-9a-f]{64}$/i.test(env.vaultKey) ? "VAULT_KEY present (is it backed up offline?)" : "VAULT_KEY missing or malformed");
  if (env.platformFeeWallet && isAddress(env.platformFeeWallet)) add("ok", "revenue", `PLATFORM_FEE_WALLET = ${env.platformFeeWallet}`);
  else add("fail", "revenue", "PLATFORM_FEE_WALLET missing or invalid");
  if (env.launchVenue === "stonkfun") {
    add("ok", "venue", "launches go to StonkFun (Raydium LaunchLab) · no Meteora config or partner wallet needed");
    add(env.creatorFeeShareBps > 0 ? "ok" : "warn", "revenue", `Hypeware keeps ${env.creatorFeeShareBps / 100}% of each company's creator fees (CREATOR_FEE_SHARE_BPS)`);
    try {
      const { launchPairs, launchPricing } = await import("../src/lib/stonkfun");
      const pairs = await launchPairs();
      add(pairs.length ? "ok" : "fail", "stonkfun", `API reachable · ${pairs.length} launchable pairs`);
      const pr = await launchPricing("So11111111111111111111111111111111111111112");
      add("ok", "stonkfun", `SOL pricing ok · platform ${pr.platformId.slice(0, 6)}… (run npm run stonkfun:probe for a full simulated launch)`);
    } catch (e) { add("fail", "stonkfun", `StonkFun API: ${(e as Error).message.slice(0, 140)}`); }
  } else {
    const pk = process.env.PARTNER_KEYPAIR ?? "";
    if (!pk) add(isLive() ? "fail" : "warn", "meteora", "PARTNER_KEYPAIR not set");
    else if (existsSync(pk)) {
      const mode = (statSync(pk).mode & 0o777).toString(8);
      add(mode === "600" ? "ok" : "warn", "meteora", `partner keypair file present (permissions ${mode}${mode === "600" ? "" : ": run chmod 600"})`);
      try {
        const { Keypair } = await import("@solana/web3.js");
        const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(pk, "utf8"))));
        const bal = (await connection().getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
        add(bal >= 0.01 ? "ok" : "warn", "meteora", `partner wallet ${kp.publicKey.toBase58()} holds ${bal.toFixed(4)} SOL`);
      } catch (e) { add("warn", "meteora", `couldn't read partner wallet: ${(e as Error).message.slice(0, 80)}`); }
    } else add("fail", "meteora", `PARTNER_KEYPAIR file not found: ${pk}`);
    if (!env.dbcConfig) add(isLive() ? "fail" : "warn", "meteora", "DBC_CONFIG not set (create with npm run meteora:config)");
    else {
      try {
        const acc = await connection().getAccountInfo(new PublicKey(env.dbcConfig));
        add(acc ? "ok" : "fail", "meteora", acc ? `DBC_CONFIG exists on ${env.cluster}` : `DBC_CONFIG not found on ${env.cluster} (devnet config on mainnet?)`);
      } catch { add("fail", "meteora", "DBC_CONFIG is not a valid address"); }
    }
  }

  // ── urls ──
  add(/^https:\/\//.test(env.siteUrl) ? "ok" : "warn", "urls", `API URL ${env.siteUrl}`);
  add(/^https:\/\//.test(env.appUrl) ? "ok" : "warn", "urls", `website URL ${env.appUrl}`);
  add(env.allowedOrigins ? "ok" : "fail", "urls", env.allowedOrigins ? `ALLOWED_ORIGINS ${env.allowedOrigins}` : "ALLOWED_ORIGINS empty: the website can't call the API");
  add(process.env.SITES_DOMAIN ? "ok" : "warn", "urls", process.env.SITES_DOMAIN ? `company sites on *.${process.env.SITES_DOMAIN}` : "SITES_DOMAIN not set: company sites only at /s/<ticker>");

  // ── agents ──
  add(env.openrouterKey ? "ok" : "fail", "agents", env.openrouterKey ? "OPENROUTER_API_KEY set" : "OPENROUTER_API_KEY missing: agents run offline scripts");
  if (env.openrouterKey) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${env.openrouterKey}` }, signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { data?: { limit_remaining?: number | null; is_management_key?: boolean; usage?: number } };
      if (!r.ok) add("fail", "agents", `OpenRouter rejected the key (${r.status})`);
      else if (j.data?.is_management_key) add("fail", "agents", "that's an OpenRouter management key: create a normal API key");
      else add("ok", "agents", `OpenRouter key valid${j.data?.limit_remaining != null ? `, $${j.data.limit_remaining.toFixed(2)} limit remaining` : ""} (turn on auto top-up)`);
    } catch { add("warn", "agents", "couldn't reach OpenRouter to verify the key"); }
  }
  add(env.browserbaseKey && env.browserbaseProject ? "ok" : "warn", "browser", env.browserbaseKey && env.browserbaseProject ? "Browserbase key + project set (run npm run browser:check to test)" : `Browserbase ${env.browserbaseKey ? "PROJECT_ID" : "API_KEY"} missing: no live browser video`);
  add("ok", "agents", `pacing ${process.env.AGENT_MIN_GAP_MIN || 3}–${process.env.AGENT_MAX_GAP_MIN || 360} min · ${env.maxConcurrentShifts} at once`);

  // ── optional abilities ──
  add(env.higgsfieldKeyId ? "ok" : "warn", "media", env.higgsfieldKeyId ? `Higgsfield set (video ${env.hfVideoEndpoint})` : "Higgsfield not set: no AI images/video");
  add(process.env.PRINTFUL_API_KEY ? "ok" : "warn", "merch", process.env.PRINTFUL_API_KEY ? "Printful set (orders print for real on mainnet)" : "Printful not set: no print-on-demand");
  const { githubEnabled } = await import("../src/lib/selfdev/github");
  add(githubEnabled() ? "ok" : "warn", "self-dev", githubEnabled() ? `GitHub set for ${process.env.GITHUB_REPO}` : "GITHUB_TOKEN/GITHUB_REPO not set: flagship can't improve Hypeware");

  // ── database state ──
  const { db, schema } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { poolStats, vanityEnabled } = await import("../src/lib/vanity");
  const pool = await poolStats();
  add(pool.available > 0 ? "ok" : vanityEnabled() ? "warn" : "ok", "vanity", `${pool.available} …${process.env.VANITY_SUFFIX || "stnk"} addresses ready, ${pool.used} used${vanityEnabled() ? "" : " (pool only used on mainnet live)"}`);
  const f = await db.query.companies.findFirst({ where: eq(schema.companies.flagship, true) });
  if (!f) add("warn", "flagship", "no flagship yet (npm run flagship -- create …)");
  else add("ok", "flagship", `$${f.ticker} · ${f.mintPubkey.startsWith("pending-") ? "coming soon" : `live ${f.mintPubkey}`} · ${f.modelLabel} · treasury ${f.treasuryPubkey}`);
  const all = await db.select({ slug: schema.companies.slug, status: schema.companies.status, flagship: schema.companies.flagship }).from(schema.companies);
  const live = all.filter((c) => c.status === "LIVE" && !c.flagship);
  if (live.length) add("warn", "companies", `${live.length} live non-flagship compan${live.length === 1 ? "y" : "ies"} in this database: ${live.map((c) => c.slug).join(", ").slice(0, 120)} (archive test ones: npm run company -- archive <slug>)`);
  else add("ok", "companies", "no leftover test companies");

  const { stuckLaunches } = await import("../src/lib/recovery");
  const stuck = await stuckLaunches().catch(() => []);
  add(stuck.length ? "warn" : "ok", "launches", stuck.length ? `${stuck.length} paid launch${stuck.length === 1 ? "" : "es"} not live: ${stuck.map((x) => x.c.slug).join(", ").slice(0, 100)} (npm run launches)` : "no stuck launches");

  // ── server ──
  const port = process.env.PORT || "3000";
  const health = sh(`curl -fsS http://127.0.0.1:${port}/api/health`);
  add(health.includes('"ok":true') ? "ok" : "fail", "server", health ? `health ${health}` : `app not answering on port ${port} (pm2 logs firmware)`);
  const crons = sh("cat /etc/cron.d/firmware* 2>/dev/null");
  if (env.launchVenue !== "stonkfun") add(/meteora:claim/.test(crons) ? "ok" : "warn", "cron", /meteora:claim/.test(crons) ? "daily partner fee claim scheduled" : "no meteora:claim cron (partner fees won't be collected)");
  add(/backup/.test(crons) ? "ok" : "warn", "cron", /backup/.test(crons) ? "nightly backups scheduled" : "no backup cron");
  add(/auto-update/.test(crons) ? "ok" : "warn", "cron", /auto-update/.test(crons) ? "auto-deploy scheduled" : "auto-deploy not scheduled (flagship's merged changes won't reach the server)");

  const icon = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };
  for (const r of rows) console.log(`${icon[r.level]} ${r.area.padEnd(10)} ${r.msg}`);
  const fails = rows.filter((r) => r.level === "fail").length, warns = rows.filter((r) => r.level === "warn").length;
  console.log(`\n${fails ? `\x1b[31m${fails} must fix\x1b[0m` : "\x1b[32mno blockers\x1b[0m"} · ${warns} to review`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
