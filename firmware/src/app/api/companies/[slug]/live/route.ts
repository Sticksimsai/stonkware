// Live view feed: the current (or last) run and its steps after `after`.
import { and, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { handle, ok, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, { params }: { params: { slug: string } }) => {
  const u = new URL(req.url);
  const after = Number(u.searchParams.get("after") ?? 0);
  const runId = u.searchParams.get("run");
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.slug, params.slug), columns: { id: true, sleepingUntil: true, status: true, nextShiftAt: true } });
  if (!c || c.status === "ARCHIVED") return fail(404, "not found");
  const run = runId
    ? await db.query.runs.findFirst({ where: and(eq(schema.runs.id, runId), eq(schema.runs.companyId, c.id)) })
    : await db.query.runs.findFirst({ where: eq(schema.runs.companyId, c.id), orderBy: desc(schema.runs.startedAt) });
  if (!run) return ok({ run: null, steps: [], sleepingUntil: c.sleepingUntil, nextShiftAt: c.nextShiftAt });
  const steps = await db.select({
    id: schema.steps.id, seq: schema.steps.seq, kind: schema.steps.kind, tool: schema.steps.tool, content: schema.steps.content,
    url: schema.steps.url, createdAt: schema.steps.createdAt,
  }).from(schema.steps).where(and(eq(schema.steps.runId, run.id), gt(schema.steps.seq, after))).orderBy(schema.steps.seq).limit(200);
  return ok({
    run: { id: run.id, status: run.status, liveUrl: run.liveUrl, browser: run.browser, steps: run.steps, costLamports: run.costLamports, summary: run.summary, startedAt: run.startedAt, endedAt: run.endedAt },
    steps,
    sleepingUntil: c.sleepingUntil,
    nextShiftAt: c.nextShiftAt,
  });
});
