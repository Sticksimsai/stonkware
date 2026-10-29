// Launches that took a creator's SOL but didn't go live, and what to do about them.
//   npm run launches                      list them (treasury balance, error, creator)
//   npm run launches -- retry <slug>      try the launch again (marks it live if the pool already exists)
//   npm run launches -- refund <slug>     send the whole treasury back to the creator, take it off the site
// The scheduler does this by itself on mainnet: retries LAUNCH_MAX_ATTEMPTS (3) times, then refunds.
import "./_env";

(async () => {
  const [cmd, who] = process.argv.slice(2);
  const { db, schema } = await import("../src/db");
  const { eq, or } = await import("drizzle-orm");
  const { stuckLaunches, retryLaunch, refundLaunch } = await import("../src/lib/recovery");
  const { explorer } = await import("../src/lib/env");
  if (!cmd || cmd === "list") {
    const s = await stuckLaunches();
    if (!s.length) { console.log("✓ no stuck launches: every paid launch is live or refunded"); process.exit(0); }
    for (const { c, balance, reason } of s) {
      console.log(`${c.slug.padEnd(16)} $${c.ticker.padEnd(10)} ${c.status.padEnd(16)} treasury ${(balance / 1e9).toFixed(4)} SOL  creator ${c.creatorWallet}`);
      console.log(`  ${reason.slice(0, 200)}`);
    }
    console.log(`\n${s.length} stuck. retry: npm run launches -- retry <slug> · refund: npm run launches -- refund <slug>`);
    process.exit(0);
  }
  const C = schema.companies;
  const c = who && (await db.query.companies.findFirst({ where: or(eq(C.slug, who.toLowerCase()), eq(C.ticker, who.toUpperCase())) }));
  if (!c) throw new Error(`usage: npm run launches -- retry|refund <slug>  (no company "${who ?? ""}")`);
  if (cmd === "retry") {
    const l = await retryLaunch(c.id);
    console.log(`✓ $${l.ticker} is ${l.status}${l.launchSig ? `: ${explorer("tx", l.launchSig)}` : ""}`);
  } else if (cmd === "refund") {
    const r = await refundLaunch(c.id, "refunded by Hypeware");
    console.log(`✓ refunded ${(r.lamports / 1e9).toFixed(4)} SOL to ${c.creatorWallet}: ${explorer("tx", r.sig)}`);
  } else throw new Error("usage: npm run launches -- list|retry|refund <slug>");
  process.exit(0);
})().catch((e) => { const c = (e as { cause?: Error }).cause; console.error(`✗ ${(e as Error).message.slice(0, 300)}${c ? `\n  cause: ${c.message}` : ""}`); process.exit(1); });
