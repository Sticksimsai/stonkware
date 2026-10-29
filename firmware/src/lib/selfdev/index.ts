// The flagship agent improving Hypeware itself: it proposes code changes as pull requests, CI checks
// them, safe ones merge and deploy automatically, protected ones wait for a human (see policy.ts).
import { and, desc, eq, inArray, lt, or, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company } from "@/db/schema";
import { emit } from "../feed";
import { classify, scanContent } from "./policy";
import * as gh from "./github";

const D = schema.devChanges;
export const selfdevEnabled = () => gh.githubEnabled();
const MAX_OPEN = () => Number(process.env.SELFDEV_MAX_OPEN || 4);

export type Change = { path: string; content?: string; edits?: { find: string; replace: string }[]; delete?: boolean };

function cleanPath(p: unknown) {
  const path = String(p ?? "").trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("//") || !/^[\w.\-/@[\]()+ ]+$/.test(path)) throw new Error(`invalid path "${path}"`);
  return path;
}

/** Turn the agent's change list into full file contents against `ref` (applying find/replace edits). */
async function materialize(changes: Change[], ref: string) {
  if (!Array.isArray(changes) || !changes.length) throw new Error("changes: give at least one { path, content | edits | delete }");
  if (changes.length > 25) throw new Error("at most 25 files per change; split it up");
  const out: { path: string; content: string | null }[] = [];
  const problems: string[] = [];
  for (const ch of changes) {
    const path = cleanPath(ch.path);
    if (ch.delete) { out.push({ path, content: null }); continue; }
    let content: string;
    if (typeof ch.content === "string") content = ch.content;
    else if (Array.isArray(ch.edits) && ch.edits.length) {
      const cur = await gh.readFile(path, ref);
      if (cur === null) throw new Error(`${path} doesn't exist on ${ref}; pass full content to create it`);
      content = cur;
      for (const [i, e] of ch.edits.entries()) {
        const find = String(e.find ?? "");
        if (!find) throw new Error(`${path} edit ${i + 1}: empty find`);
        const n = content.split(find).length - 1;
        if (n !== 1) throw new Error(`${path} edit ${i + 1}: "find" must match exactly once (matched ${n}×). Read the file and copy the exact text.`);
        content = content.replace(find, () => String(e.replace ?? ""));
      }
    } else throw new Error(`${path}: give content, edits or delete`);
    const bad = scanContent(path, content);
    if (bad) problems.push(bad);
    out.push({ path, content });
  }
  if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
  return out;
}

const body = (c: Company, why: string, lane: string, prot: string[]) => `${why}

---
🤖 Proposed by the **$${c.ticker}** agent (Hypeware's self-improvement loop).

**Lane:** ${lane === "auto" ? "auto: merges and deploys by itself once all checks pass." : "review: touches protected code, so a maintainer must approve and merge it."}
${prot.length ? `\n**Protected / out-of-area files:**\n${prot.map((f) => `- \`${f}\``).join("\n")}\n` : ""}`;

async function label(n: number, lane: string) {
  await gh.setLabels(n, ["firmware-agent", lane === "auto" ? "agent:auto" : "agent:review"]).catch(() => null);
}

export async function propose(c: Company, a: { title: string; why: string; changes: Change[] }) {
  const title = String(a.title ?? "").trim().slice(0, 100);
  const why = String(a.why ?? "").trim().slice(0, 4000);
  if (title.length < 6) throw new Error("title: describe the change in a few words");
  if (why.length < 20) throw new Error("why: explain what this improves and how you checked it");
  const open = await db.select({ id: D.id }).from(D).where(and(eq(D.companyId, c.id), eq(D.status, "open")));
  if (open.length >= MAX_OPEN()) throw new Error(`you already have ${open.length} open changes; finish or close some first (code_prs)`);
  const base = await gh.headSha();
  const files = await materialize(a.changes, base);
  const { lane, protectedFiles } = classify(files.map((f) => f.path));
  const branch = `agent/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${Date.now().toString(36)}`;
  await gh.commitFiles(branch, base, files, `${title}\n\n${why}`, true);
  const pr = await gh.openPull(title, body(c, why, lane, protectedFiles), branch);
  await label(pr.number, lane);
  await db.insert(D).values({ companyId: c.id, prNumber: pr.number, branch, title, why, lane, files: JSON.stringify(files.map((f) => f.path)), protectedFiles: JSON.stringify(protectedFiles) });
  await emit(c.id, "ACTION", `Proposed an improvement to Hypeware: ${title}`, `${files.length} file${files.length === 1 ? "" : "s"} · ${lane === "auto" ? "ships automatically if checks pass" : "needs a maintainer's review"}`);
  return { number: pr.number, lane, protectedFiles, files: files.map((f) => f.path) };
}

export async function update(c: Company, n: number, a: { message: string; changes: Change[] }) {
  const row = await db.query.devChanges.findFirst({ where: and(eq(D.prNumber, n), eq(D.companyId, c.id)) });
  if (!row || row.status !== "open") throw new Error(`#${n} isn't one of your open changes`);
  const pr = await gh.getPull(n);
  const files = await materialize(a.changes, pr.head.sha);
  await gh.commitFiles(row.branch, pr.head.sha, files, String(a.message || "Address review / CI").slice(0, 200), false);
  const all = await gh.pullFiles(n);
  const { lane, protectedFiles } = classify(all);
  if (lane !== row.lane) await label(n, lane);
  await db.update(D).set({ lane, ci: "pending", files: JSON.stringify(all), protectedFiles: JSON.stringify(protectedFiles), checkedAt: null }).where(eq(D.id, row.id));
  return { lane, files: all.length };
}

export async function close(c: Company, n: number, reason: string) {
  const row = await db.query.devChanges.findFirst({ where: and(eq(D.prNumber, n), eq(D.companyId, c.id)) });
  if (!row || row.status !== "open") throw new Error(`#${n} isn't one of your open changes`);
  await gh.comment(n, `Closed by the agent: ${reason.slice(0, 500)}`).catch(() => null);
  await gh.closePull(n);
  await db.update(D).set({ status: "closed" }).where(eq(D.id, row.id));
}

function ciOf(runs: gh.CheckRun[]) {
  if (!runs.length) return "pending";
  if (runs.some((r) => r.status === "completed" && ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(r.conclusion ?? ""))) return "failure";
  if (runs.every((r) => r.status === "completed" && ["success", "neutral", "skipped"].includes(r.conclusion ?? ""))) return "success";
  return "pending";
}

/** Failing check output, trimmed, for the agent to fix. */
export async function failures(n: number) {
  const pr = await gh.getPull(n);
  const runs = await gh.checks(pr.head.sha);
  return runs.filter((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion))
    .map((r) => `${r.name}: ${r.conclusion}\n${[r.output?.title, r.output?.summary, r.output?.text].filter(Boolean).join("\n").slice(0, 2500)}`);
}

/** Scheduler: follow open changes; merge safe ones whose checks passed. */
export async function pollDev() {
  if (!selfdevEnabled()) return 0;
  const rows = await db.select().from(D).where(and(eq(D.status, "open"), or(isNull(D.checkedAt), lt(D.checkedAt, new Date(Date.now() - 90_000))))).limit(10);
  for (const row of rows) {
    try {
      const pr = await gh.getPull(row.prNumber);
      if (pr.merged || pr.state === "closed") {
        await db.update(D).set({ status: pr.merged ? "merged" : "closed", mergedAt: pr.merged ? new Date() : null, additions: pr.additions, deletions: pr.deletions, checkedAt: new Date() }).where(eq(D.id, row.id));
        if (pr.merged) await emit(row.companyId, "ACTION", `Shipped to Hypeware: ${row.title}`, `+${pr.additions} −${pr.deletions} · approved by a maintainer`);
        continue;
      }
      const ci = ciOf(await gh.checks(pr.head.sha));
      await db.update(D).set({ ci, additions: pr.additions, deletions: pr.deletions, checkedAt: new Date() }).where(eq(D.id, row.id));
      if (ci === "failure" && row.ci !== "failure") {
        await db.update(schema.companies).set({ wakeRequested: true }).where(eq(schema.companies.id, row.companyId)); // go fix it
      }
      if (ci !== "success" || row.lane !== "auto" || pr.mergeable === false) continue;
      // re-check what's actually in the PR right before merging (anyone could have pushed to the branch)
      const { lane } = classify(await gh.pullFiles(row.prNumber));
      if (lane !== "auto") {
        await db.update(D).set({ lane }).where(eq(D.id, row.id));
        await label(row.prNumber, lane);
        continue;
      }
      await gh.mergePull(row.prNumber, pr.head.sha, row.title);
      await db.update(D).set({ status: "merged", mergedAt: new Date() }).where(eq(D.id, row.id));
      await emit(row.companyId, "ACTION", `Shipped to Hypeware: ${row.title}`, `+${pr.additions} −${pr.deletions} · merged automatically after all checks passed`);
    } catch (e) {
      console.error("[selfdev]", row.prNumber, (e as Error).message);
      await db.update(D).set({ checkedAt: new Date() }).where(eq(D.id, row.id));
    }
  }
  return rows.length;
}

export async function listChanges(companyId: string, limit = 20) {
  return db.select().from(D).where(eq(D.companyId, companyId)).orderBy(desc(D.createdAt)).limit(limit);
}

export const publicChange = (r: typeof D.$inferSelect) => ({
  number: r.prNumber, title: r.title, why: r.why.slice(0, 400), lane: r.lane, status: r.status, ci: r.ci,
  files: (JSON.parse(r.files) as string[]).length, additions: r.additions, deletions: r.deletions, createdAt: r.createdAt, mergedAt: r.mergedAt,
});

export async function openCount(companyId: string) {
  return (await db.select({ id: D.id }).from(D).where(and(eq(D.companyId, companyId), inArray(D.status, ["open"])))).length;
}
