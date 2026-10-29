// Admin: Hyperliquid accounts for companies.
//   npm run hl -- status                 every company's Hyperliquid address, API wallet state and USD balance
//   npm run hl -- backfill               give every company without one a Hyperliquid account (keys only, no funds move)
//   npm run hl -- approve <slug|ticker>  approve the company's API wallet now (its account must have received funds)
// The scheduler also does backfill + approval automatically; this is for checking and forcing it.
import "./_env";

(async () => {
  const [cmd, who] = process.argv.slice(2);
  const { db, schema } = await import("../src/db");
  const { eq, or, isNull, desc } = await import("drizzle-orm");
  const { env, hlExplorer } = await import("../src/lib/env");
  const { ensureHlKeys, ensureAgentApproved } = await import("../src/lib/hl/accounts");
  const { hlBalance } = await import("../src/lib/hl/client");
  const C = schema.companies;
  console.log(`Hyperliquid ${env.hlNetwork} · FIRMWARE_MODE=${env.mode}`);

  if (cmd === "status") {
    const rows = await db.select().from(C).orderBy(desc(C.createdAt));
    for (const c of rows) {
      const bal = c.hlAddress && c.status === "LIVE" ? await hlBalance(c.hlAddress).catch((e) => (e as Error).message.slice(0, 60)) : null;
      const usd = bal === null ? "-" : typeof bal === "string" ? `error: ${bal}` : `$${bal.usd.toFixed(2)}`;
      const agent = !c.hlAddress ? "no account" : c.hlAgentApprovedAt ? "API wallet ✓" : "API wallet pending";
      console.log(`$${c.ticker.padEnd(10)} ${c.status.padEnd(16)} ${(c.hlAddress ?? "-").padEnd(42)} ${agent.padEnd(18)} ${usd}`);
    }
    process.exit(0);
  }
  if (cmd === "backfill") {
    const rows = await db.select({ id: C.id, ticker: C.ticker, hlAddress: C.hlAddress }).from(C).where(isNull(C.hlAddress));
    for (const c of rows) if (await ensureHlKeys(c)) console.log(`✓ $${c.ticker}: Hyperliquid account created`);
    console.log(rows.length ? `done: ${rows.length} compan${rows.length === 1 ? "y" : "ies"}` : "every company already has a Hyperliquid account");
    process.exit(0);
  }
  if (cmd === "approve" && who) {
    let c = await db.query.companies.findFirst({ where: or(eq(C.slug, who.toLowerCase()), eq(C.ticker, who.toUpperCase())) });
    if (!c) throw new Error(`no company "${who}"`);
    if (await ensureHlKeys(c)) c = (await db.query.companies.findFirst({ where: eq(C.id, c.id) }))!;
    const r = await ensureAgentApproved(c);
    const msg = {
      approved: "API wallet approved",
      already: "API wallet was already approved",
      "waiting-for-funds": "the account doesn't exist on Hyperliquid yet: send it some USDC first",
      "no-keys": "no keys (unexpected)",
    }[r];
    console.log(`$${c.ticker}: ${msg}\n  ${hlExplorer(c.hlAddress!)}`);
    process.exit(r === "approved" || r === "already" ? 0 : 1);
  }
  console.log("usage: npm run hl -- status | backfill | approve <slug|ticker>");
  process.exit(1);
})().catch((e) => { console.error((e as Error).message); process.exit(1); });
