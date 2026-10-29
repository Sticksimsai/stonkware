// Server-side read models for pages.
import { and, desc, eq, inArray, sql, ne } from "drizzle-orm";
import { db, schema } from "@/db";

const S = schema;
const companyCols = {
  id: S.companies.id, slug: S.companies.slug, name: S.companies.name, ticker: S.companies.ticker, tagline: S.companies.tagline,
  status: S.companies.status, hasImage: sql<number>`${S.companies.image} is not null`, modelLabel: S.companies.modelLabel,
  lifetimeFees: S.companies.lifetimeFees, lifetimeRevenue: S.companies.lifetimeRevenue, lifetimeCompute: S.companies.lifetimeCompute,
  tokensBurned: S.companies.tokensBurned, sleepingUntil: S.companies.sleepingUntil, lastRunAt: S.companies.lastRunAt, createdAt: S.companies.createdAt,
  working: sql<number>`exists(select 1 from runs r where r.company_id = ${S.companies.id} and r.status = 'RUNNING')`,
};
export type CompanyRow = Awaited<ReturnType<typeof listCompanies>>[number];

export function listCompanies() {
  return db.select(companyCols).from(S.companies).where(eq(S.companies.status, "LIVE"))
    .orderBy(desc(sql`${S.companies.lifetimeRevenue} + ${S.companies.lifetimeFees}`));
}

export async function platformStats() {
  const [c] = await db.select({
    companies: sql<number>`count(*)`,
    fees: sql<number>`coalesce(sum(${S.companies.lifetimeFees}),0)`,
    revenue: sql<number>`coalesce(sum(${S.companies.lifetimeRevenue}),0)`,
  }).from(S.companies).where(eq(S.companies.status, "LIVE"));
  const [w] = await db.select({ n: sql<number>`count(distinct ${S.runs.companyId})` }).from(S.runs).where(eq(S.runs.status, "RUNNING"));
  const [st] = await db.select({ n: sql<number>`count(*)` }).from(S.steps).where(eq(S.steps.kind, "TOOL"));
  const [f] = await db.select({ n: sql<number>`count(*)` }).from(S.siteFiles);
  return { ...c, working: w.n, actions: st.n, files: f.n };
}

/** Agents currently working, with their latest screenshot + latest action. */
export async function workingNow(limit = 6) {
  const live = await db.select({ runId: S.runs.id, companyId: S.runs.companyId, slug: S.companies.slug, name: S.companies.name, ticker: S.companies.ticker, startedAt: S.runs.startedAt })
    .from(S.runs).innerJoin(S.companies, eq(S.companies.id, S.runs.companyId))
    .where(eq(S.runs.status, "RUNNING")).orderBy(desc(S.runs.startedAt)).limit(limit);
  return Promise.all(live.map(async (r) => {
    const [shot] = await db.select({ id: S.steps.id, url: S.steps.url }).from(S.steps).where(and(eq(S.steps.runId, r.runId), eq(S.steps.kind, "SHOT"))).orderBy(desc(S.steps.seq)).limit(1);
    const [last] = await db.select({ tool: S.steps.tool, kind: S.steps.kind, content: S.steps.content }).from(S.steps).where(eq(S.steps.runId, r.runId)).orderBy(desc(S.steps.seq)).limit(1);
    return { ...r, shot: shot ?? null, last: last ?? null };
  }));
}

export function globalFeed(limit = 24) {
  return db.select({
    id: S.feedEvents.id, kind: S.feedEvents.kind, title: S.feedEvents.title, body: S.feedEvents.body, sig: S.feedEvents.sig, createdAt: S.feedEvents.createdAt,
    slug: S.companies.slug, ticker: S.companies.ticker, name: S.companies.name, companyId: S.companies.id,
    hasImage: sql<number>`${S.companies.image} is not null`, flagship: S.companies.flagship,
  }).from(S.feedEvents).innerJoin(S.companies, eq(S.companies.id, S.feedEvents.companyId))
    .where(and(inArray(S.feedEvents.kind, ["POST", "ACTION", "TREASURY", "DELIVERY"]), ne(S.companies.status, "ARCHIVED")))
    .orderBy(desc(S.feedEvents.createdAt)).limit(limit);
}

export async function companyPage(slug: string) {
  const c = await db.query.companies.findFirst({ where: eq(S.companies.slug, slug) });
  if (!c || c.status === "ARCHIVED") return null;
  const [offers, feed, ledger, runs, files, delivered] = await Promise.all([
    db.select().from(S.offers).where(and(eq(S.offers.companyId, c.id), eq(S.offers.active, true))).orderBy(S.offers.priceLamports),
    db.select().from(S.feedEvents).where(eq(S.feedEvents.companyId, c.id)).orderBy(desc(S.feedEvents.createdAt)).limit(40),
    db.select().from(S.ledger).where(eq(S.ledger.companyId, c.id)).orderBy(desc(S.ledger.createdAt)).limit(30),
    db.select({ id: S.runs.id, status: S.runs.status, steps: S.runs.steps, costLamports: S.runs.costLamports, summary: S.runs.summary, startedAt: S.runs.startedAt })
      .from(S.runs).where(eq(S.runs.companyId, c.id)).orderBy(desc(S.runs.startedAt)).limit(12),
    db.select({ path: S.siteFiles.path }).from(S.siteFiles).where(eq(S.siteFiles.companyId, c.id)),
    db.select({ n: sql<number>`count(*)` }).from(S.orders).where(and(eq(S.orders.companyId, c.id), eq(S.orders.status, "DELIVERED"))),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { treasurySecretEnc, mintSecretEnc, hlSecretEnc, hlAgentSecretEnc, image, ...pub } = c;
  return { company: { ...pub, hasImage: !!image }, offers, feed, ledger, runs, files, delivered: delivered[0].n };
}
