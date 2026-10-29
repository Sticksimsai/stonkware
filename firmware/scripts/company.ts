// Admin: list companies, archive one (off the site, agent stopped, no more compute), or restore it.
//   npm run company -- list
//   npm run company -- archive <slug|ticker>
//   npm run company -- restore <slug|ticker>
//   npm run company -- wake <slug|ticker>      start a shift now (clears any sleep; needs fuel in the treasury)
// Archiving keeps everything in the database (treasury keys included); it just takes the company offline.
import "./_env";

(async () => {
  const [cmd, who] = process.argv.slice(2);
  const { db, schema } = await import("../src/db");
  const { eq, or, and, desc } = await import("drizzle-orm");
  const C = schema.companies;
  if (cmd === "list") {
    const rows = await db.select({ slug: C.slug, ticker: C.ticker, status: C.status, model: C.modelLabel, flagship: C.flagship, compute: C.lifetimeCompute, lastRunAt: C.lastRunAt }).from(C).orderBy(desc(C.createdAt));
    for (const r of rows) console.log(`${r.slug.padEnd(16)} $${r.ticker.padEnd(10)} ${r.status.padEnd(16)} ${r.model.padEnd(20)} compute ${(r.compute / 1e9).toFixed(4)} SOL${r.flagship ? "  ★ flagship" : ""}`);
    process.exit(0);
  }
  if (!["archive", "restore", "wake"].includes(cmd) || !who) { console.log("usage: npm run company -- list | archive <slug|ticker> | restore <slug|ticker> | wake <slug|ticker>"); process.exit(1); }
  const c = await db.query.companies.findFirst({ where: or(eq(C.slug, who.toLowerCase()), eq(C.ticker, who.toUpperCase())) });
  if (!c) throw new Error(`no company "${who}"`);
  if (cmd === "wake") {
    if (c.status !== "LIVE") throw new Error(`$${c.ticker} is ${c.status}, not LIVE`);
    await db.update(C).set({ wakeRequested: true, sleepingUntil: null, nextShiftAt: null }).where(eq(C.id, c.id));
    console.log(`✓ $${c.ticker} woken: its agent starts within a minute (if the treasury has at least 0.013 SOL).`);
    console.log("  watch: sudo -u firmware pm2 logs firmware --lines 50");
    process.exit(0);
  }
  if (cmd === "archive") {
    if (c.flagship) throw new Error("that's the flagship; use npm run flagship -- update instead");
    await db.update(C).set({ status: "ARCHIVED", wakeRequested: false, sleepingUntil: new Date("2999-01-01") }).where(eq(C.id, c.id));
    // a shift in progress stops at its next step (it checks the status); mark it ended
    await db.update(schema.runs).set({ status: "ERROR", error: "archived by Hypeware", endedAt: new Date(), liveUrl: null }).where(and(eq(schema.runs.companyId, c.id), eq(schema.runs.status, "RUNNING")));
    await db.update(schema.offers).set({ active: false }).where(eq(schema.offers.companyId, c.id));
    console.log(`✓ $${c.ticker} archived: removed from the site, agent stopped, offers closed. (was ${c.status})`);
    console.log(`  treasury ${c.treasuryPubkey} is untouched. Undo with: npm run company -- restore ${c.slug}`);
  } else {
    if (c.status !== "ARCHIVED") throw new Error(`$${c.ticker} isn't archived (status ${c.status})`);
    await db.update(C).set({ status: "LIVE", sleepingUntil: null }).where(eq(C.id, c.id));
    console.log(`✓ $${c.ticker} restored (offers stay closed until its agent reopens them)`);
  }
  process.exit(0);
})().catch((e) => { const c = (e as { cause?: Error }).cause; console.error(`✗ ${(e as Error).message.split("\n")[0].slice(0, 160)}${c ? `\n  cause: ${c.message}` : ""}\n  database: ${process.env.DATABASE_URL || "file:./firmware.db (DATABASE_URL not set: run this from /home/firmware/app)"}`); process.exit(1); });
