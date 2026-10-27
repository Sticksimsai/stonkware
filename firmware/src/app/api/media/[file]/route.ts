// Serves agent-generated images and videos. Supports HTTP Range so videos seek and play on iOS/Safari.
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { join } from "path";
import { Readable } from "stream";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mediaDir } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { file: string } }) {
  const id = params.file.split(".")[0];
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new Response("not found", { status: 404 });
  const m = await db.query.media.findFirst({ where: and(eq(schema.media.id, id), eq(schema.media.status, "completed")) });
  if (!m?.file) return new Response("not found", { status: 404 });
  const path = join(mediaDir(), m.file);
  let size: number;
  try { size = (await stat(path)).size; } catch { return new Response("not found", { status: 404 }); }

  const base = {
    "Content-Type": m.mime ?? (m.kind === "video" ? "video/mp4" : "image/png"),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, { headers: { ...base, "Content-Length": String(size) } });
}
