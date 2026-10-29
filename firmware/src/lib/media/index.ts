// The agent's media studio: images and videos rendered with Higgsfield, billed to the treasury,
// downloaded and served by Hypeware (Higgsfield only keeps outputs ~7 days).
import { mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company, Media } from "@/db/schema";
import { env } from "../env";
import { FEES } from "../fees";
import { usdToLamports } from "../price";
import { chargeCompute, getCompany, treasuryBalance } from "../treasury";
import { emit } from "../feed";
import { fmtSol } from "../units";
import { higgsfieldEnabled, isTerminal, status, submit } from "./higgsfield";

const M = schema.media;
const PENDING = ["queued", "in_progress"];
const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;
const isSeedance = (endpoint: string) => endpoint.includes("seedance");
const RENDER_TIMEOUT_MS = 30 * 60_000;

export function mediaDir() {
  if (env.mediaDir) return resolve(env.mediaDir);
  const db = process.env.DATABASE_URL || "";
  return db.startsWith("file:") ? join(dirname(resolve(db.slice(5))), "media") : resolve("media");
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
export const mediaUrl = (m: Pick<Media, "id" | "file" | "kind">) => `${env.siteUrl}/api/media/${m.file ?? `${m.id}.${m.kind === "video" ? "mp4" : "png"}`}`;

export function estimateUsd(kind: "image" | "video", durationSec = 5) {
  return kind === "image" ? env.hfImageUsd : env.hfVideoUsdPerSec * durationSec;
}

/** Spendable balance after the reserve, renders still in flight, and enough for another shift. */
async function headroom(c: Company) {
  const [bal, [{ pending }]] = await Promise.all([
    treasuryBalance(c),
    db.select({ pending: sql<number>`coalesce(sum(${M.costLamports}), 0)` }).from(M).where(and(eq(M.companyId, c.id), inArray(M.status, PENDING))),
  ]);
  return bal - FEES.treasuryFloorLamports - FEES.minRunLamports - Number(pending);
}

export type MediaRequest = { kind: "image" | "video"; prompt: string; aspect?: string; durationSec?: number; fromImageId?: string; runId?: string | null };

export async function requestMedia(c: Company, r: MediaRequest): Promise<Media> {
  if (!higgsfieldEnabled()) throw new Error("the media studio isn't enabled on this Hypeware server");
  const prompt = r.prompt.trim().slice(0, 2400);
  if (prompt.length < 8) throw new Error("describe what to generate (at least a sentence)");
  const aspect = (ASPECTS as readonly string[]).includes(r.aspect ?? "") ? r.aspect! : r.kind === "video" ? "16:9" : "1:1";
  // Seedance 2.5: 4–30s · Kling: 3–15s
  const videoEndpoint = r.fromImageId ? env.hfImageToVideoEndpoint : env.hfVideoEndpoint;
  const [minS, maxS] = isSeedance(videoEndpoint) ? [4, 30] : [3, 15];
  const duration = r.kind === "video" ? Math.min(maxS, Math.max(minS, Math.round(r.durationSec ?? 5))) : null;

  let source: Media | undefined;
  if (r.fromImageId) {
    source = await db.query.media.findFirst({ where: and(eq(M.id, r.fromImageId), eq(M.companyId, c.id)) });
    if (!source || source.kind !== "image" || source.status !== "completed") throw new Error("from_image_id must be one of your completed images");
  }

  if (r.kind === "video" && Number.isFinite(env.maxVideoSecPerDay)) {
    const [{ secs }] = await db.select({ secs: sql<number>`coalesce(sum(${M.durationSec}), 0)` }).from(M)
      .where(and(eq(M.companyId, c.id), eq(M.kind, "video"), gte(M.createdAt, new Date(Date.now() - 86_400_000)), inArray(M.status, [...PENDING, "completed"])));
    if (Number(secs) + duration! > env.maxVideoSecPerDay) throw new Error(`daily video limit reached (${env.maxVideoSecPerDay}s per day)`);
  }

  const est = await usdToLamports(estimateUsd(r.kind, duration ?? 5));
  const room = await headroom(c);
  if (room < est) throw new Error(`not enough in the treasury: this costs ~${fmtSol(est, 4)}, you can spend ${fmtSol(Math.max(0, room), 4)} right now`);

  let endpoint: string, body: Record<string, unknown>;
  if (r.kind === "image") {
    endpoint = env.hfImageEndpoint;
    body = { prompt, aspect_ratio: aspect };
  } else if (source) {
    endpoint = env.hfImageToVideoEndpoint;
    body = { prompt, image_url: mediaUrl(source), duration, resolution: "720p" };
  } else {
    endpoint = env.hfVideoEndpoint;
    body = isSeedance(endpoint)
      ? { prompt, duration, resolution: env.hfVideoResolution, aspect_ratio: aspect, generate_audio: true }
      : { prompt, duration, aspect_ratio: aspect, sound: "on" };
  }

  let res;
  try {
    res = await submit(endpoint, body);
  } catch (e) {
    // some image models don't take aspect_ratio: retry with just the prompt
    if (r.kind === "image" && [400, 422].includes((e as { status?: number }).status ?? 0)) res = await submit(endpoint, { prompt });
    else throw e;
  }
  const [row] = await db.insert(M).values({
    companyId: c.id, runId: r.runId ?? null, kind: r.kind, model: endpoint, prompt, aspect, durationSec: duration, sourceId: source?.id ?? null,
    status: res.status && PENDING.includes(res.status) ? res.status : "queued", requestId: res.request_id, costLamports: est,
  }).returning();
  return row;
}

/** Check one render; on completion download it, bill the treasury and announce it. */
export async function refresh(m: Media): Promise<Media> {
  if (!m.requestId || isTerminal(m.status)) return m;
  if (Date.now() - m.createdAt.getTime() > RENDER_TIMEOUT_MS) {
    await db.update(M).set({ status: "failed", error: "timed out", costLamports: 0 }).where(and(eq(M.id, m.id), inArray(M.status, PENDING)));
    return { ...m, status: "failed", error: "timed out", costLamports: 0 };
  }
  const r = await status(m.requestId);
  if (!isTerminal(r.status)) {
    if (r.status !== m.status) await db.update(M).set({ status: r.status }).where(and(eq(M.id, m.id), inArray(M.status, PENDING)));
    return { ...m, status: r.status };
  }
  if (r.status !== "completed") {
    const error = r.status === "nsfw" ? "blocked by the content filter" : r.error ?? r.status;
    await db.update(M).set({ status: r.status, error, costLamports: 0, completedAt: new Date() }).where(and(eq(M.id, m.id), inArray(M.status, PENDING)));
    return { ...m, status: r.status, error, costLamports: 0 };
  }
  const url = m.kind === "video" ? r.video?.url : r.images?.[0]?.url;
  if (!url) throw new Error("completed without an output url");
  const dl = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!dl.ok) throw new Error(`download failed ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const mime = (dl.headers.get("content-type") || "").split(";")[0] || (m.kind === "video" ? "video/mp4" : "image/png");
  const ext = EXT[mime] ?? (url.split("?")[0].split(".").pop() || (m.kind === "video" ? "mp4" : "png")).toLowerCase();
  const file = `${m.id}.${ext}`;
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(join(mediaDir(), file), buf);

  const usd = estimateUsd(m.kind as "image" | "video", m.durationSec ?? 5);
  const cost = await usdToLamports(usd);
  const done = { status: "completed", remoteUrl: url, file, mime, bytes: buf.length, costLamports: cost, completedAt: new Date() } as const;
  // conditional update: if the scheduler and a waiting tool both finished this render, bill it once
  const won = await db.update(M).set(done).where(and(eq(M.id, m.id), inArray(M.status, PENDING))).returning({ id: M.id });
  if (!won.length) return (await db.query.media.findFirst({ where: eq(M.id, m.id) })) ?? m;
  const c = await getCompany(m.companyId);
  await chargeCompute(c, cost, `media ${m.id.slice(-6)}: ${m.kind}${m.durationSec ? ` ${m.durationSec}s` : ""} $${usd.toFixed(3)}`);
  const row = { ...m, ...done };
  await emit(c.id, "ACTION", m.kind === "video" ? `Rendered a ${m.durationSec}s video` : "Generated an image", `${mediaUrl(row)}\n${m.prompt.slice(0, 280)}`);
  return row;
}

/** Wait (bounded) for a render: used for images, which usually finish in seconds. */
export async function waitFor(m: Media, ms: number): Promise<Media> {
  const until = Date.now() + ms;
  let cur = m;
  while (!isTerminal(cur.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    cur = await refresh(cur);
  }
  return cur;
}

/** Scheduler beat: advance every render still in flight. */
export async function pollMedia() {
  if (!higgsfieldEnabled()) return 0;
  const rows = await db.select().from(M).where(inArray(M.status, PENDING)).limit(20);
  for (const m of rows) {
    try { await refresh(m); } catch (e) { console.error("[media]", m.id, (e as Error).message); }
  }
  return rows.length;
}

export async function listMedia(companyId: string, limit = 30, onlyDone = false) {
  return db.select().from(M)
    .where(onlyDone ? and(eq(M.companyId, companyId), eq(M.status, "completed")) : eq(M.companyId, companyId))
    .orderBy(desc(M.createdAt)).limit(limit);
}

export const publicMedia = (m: Media) => ({
  id: m.id, kind: m.kind, prompt: m.prompt, aspect: m.aspect, durationSec: m.durationSec, status: m.status,
  url: m.status === "completed" ? mediaUrl(m) : null, mime: m.mime, costLamports: m.costLamports, createdAt: m.createdAt, error: m.error,
});
