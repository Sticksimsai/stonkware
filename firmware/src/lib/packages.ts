// Downloadable software the agent builds (browser extensions, apps, templates, scripts):
// it writes the files, Stonkware zips and serves them. Private packages are only reachable
// through signed links, which is how paid downloads are delivered.
import { createHmac, timingSafeEqual } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { zipSync, strToU8 } from "fflate";
import { and, asc, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Company, Package } from "@/db/schema";
import { env } from "./env";
import { emit } from "./feed";
import { mediaDir } from "./media";

const P = schema.packages;
const F = schema.packageFiles;
export const PACKAGE_KINDS = ["extension", "app", "template", "script", "other"] as const;
const TEXT_EXT = new Set(["js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "html", "htm", "css", "md", "txt", "svg", "xml", "yml", "yaml", "py", "sh", "toml", "csv", "env", "gitignore", "license"]);
const BIN_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const LIMITS = { packages: 12, files: 120, fileChars: 400_000 };

export function packageName(n: unknown) {
  const s = String(n ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(s)) throw new Error("package name: 2–41 chars, a-z 0-9 and dashes (e.g. focus-timer-extension)");
  return s;
}
function filePath(p: unknown) {
  const path = String(p ?? "").trim().replace(/^\/+/, "");
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.\-/]{0,150}$/.test(path) || path.includes("..") || path.includes("//")) throw new Error("invalid file path");
  const base = path.split("/").pop()!.toLowerCase();
  const ext = base.includes(".") ? base.split(".").pop()! : base;
  return { path, ext, binary: BIN_EXT.has(ext), ok: TEXT_EXT.has(ext) || BIN_EXT.has(ext) || ["license", "readme", "makefile", "dockerfile"].includes(base) };
}

async function ensurePackage(c: Company, name: string) {
  const existing = await db.query.packages.findFirst({ where: and(eq(P.companyId, c.id), eq(P.name, name)) });
  if (existing) return existing;
  const [{ n }] = await db.select({ n: count() }).from(P).where(eq(P.companyId, c.id));
  if (n >= LIMITS.packages) throw new Error(`package limit (${LIMITS.packages}) reached`);
  const [row] = await db.insert(P).values({ companyId: c.id, name, title: name }).returning();
  return row;
}

export async function writePackageFile(c: Company, name: string, path: string, content?: string, fromMediaId?: string) {
  const pkg = await ensurePackage(c, packageName(name));
  const f = filePath(path);
  if (!f.ok) throw new Error(`unsupported file type for ${f.path}`);
  let mediaId: string | null = null;
  let text = "";
  if (f.binary) {
    if (!fromMediaId) throw new Error(`${f.path} is binary: pass from_media_id (one of your generated images)`);
    const m = await db.query.media.findFirst({ where: and(eq(schema.media.id, fromMediaId), eq(schema.media.companyId, c.id)) });
    if (!m || m.kind !== "image" || m.status !== "completed" || !m.file) throw new Error("from_media_id must be one of your completed images");
    mediaId = m.id;
  } else {
    text = String(content ?? "");
    if (text.length > LIMITS.fileChars) throw new Error(`file too large (max ${LIMITS.fileChars} chars)`);
    if (f.path === "manifest.json") validateManifest(text);
  }
  const [{ n }] = await db.select({ n: count() }).from(F).where(eq(F.packageId, pkg.id));
  const exists = await db.query.packageFiles.findFirst({ where: and(eq(F.packageId, pkg.id), eq(F.path, f.path)), columns: { path: true } });
  if (!exists && n >= LIMITS.files) throw new Error(`file limit (${LIMITS.files}) reached for this package`);
  await db.insert(F).values({ packageId: pkg.id, path: f.path, content: text, mediaId })
    .onConflictDoUpdate({ target: [F.packageId, F.path], set: { content: text, mediaId, updatedAt: new Date() } });
  await db.update(P).set({ updatedAt: new Date() }).where(eq(P.id, pkg.id));
  return { pkg, path: f.path };
}

/** Catch the usual browser-extension mistakes early, with a useful message. */
function validateManifest(text: string) {
  let m: Record<string, unknown>;
  try { m = JSON.parse(text); } catch (e) { throw new Error(`manifest.json is not valid JSON: ${(e as Error).message}`); }
  if (m.manifest_version !== undefined && m.manifest_version !== 3) throw new Error("use \"manifest_version\": 3 (Chrome no longer accepts v2)");
  if (m.manifest_version === 3) {
    for (const k of ["name", "version"]) if (!m[k]) throw new Error(`manifest.json needs "${k}"`);
    if (!/^\d+(\.\d+){0,3}$/.test(String(m.version))) throw new Error("manifest version must look like 1.0.0");
    const bg = m.background as { scripts?: unknown } | undefined;
    if (bg?.scripts) throw new Error("MV3 uses \"background\": { \"service_worker\": \"background.js\" }, not scripts");
  }
}

export async function publishPackage(c: Company, name: string, p: { title?: string; description?: string; kind?: string; visibility?: string }) {
  const pkg = await db.query.packages.findFirst({ where: and(eq(P.companyId, c.id), eq(P.name, packageName(name))) });
  if (!pkg) throw new Error("no such package: write files first");
  const files = await db.select({ path: F.path, content: F.content }).from(F).where(eq(F.packageId, pkg.id));
  if (!files.length) throw new Error("the package has no files");
  const kind = (PACKAGE_KINDS as readonly string[]).includes(String(p.kind)) ? String(p.kind) : pkg.kind;
  if (kind === "extension") {
    const man = files.find((f) => f.path === "manifest.json");
    if (!man) throw new Error("an extension needs manifest.json at the package root");
    const m = JSON.parse(man.content) as { action?: { default_popup?: string }; background?: { service_worker?: string }; content_scripts?: { js?: string[] }[] };
    const refs = [m.action?.default_popup, m.background?.service_worker, ...(m.content_scripts ?? []).flatMap((s) => s.js ?? [])].filter(Boolean) as string[];
    const missing = refs.filter((r) => !files.some((f) => f.path === r));
    if (missing.length) throw new Error(`manifest.json references missing files: ${missing.join(", ")}`);
  }
  const visibility = p.visibility === "private" ? "private" : "public";
  const [row] = await db.update(P).set({
    title: String(p.title ?? pkg.title).slice(0, 100), description: String(p.description ?? pkg.description).slice(0, 1500),
    kind, visibility, version: pkg.version + 1, updatedAt: new Date(),
  }).where(eq(P.id, pkg.id)).returning();
  await emit(c.id, "ACTION", `Shipped ${row.title} v${row.version}`, `${kind}${visibility === "private" ? " · paid download" : " · free download"}\n${row.description.slice(0, 280)}`);
  return row;
}

const sign = (id: string) => createHmac("sha256", `pkg:${env.vaultKey}`).update(id).digest("hex").slice(0, 32);
export function verifyToken(id: string, t: string | null) {
  if (!t) return false;
  const a = Buffer.from(sign(id)), b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const downloadUrl = (pkg: Pick<Package, "id" | "name" | "visibility">, signed = false) =>
  `${env.siteUrl}/api/packages/${pkg.id}/${pkg.name}.zip${signed || pkg.visibility !== "public" ? `?t=${sign(pkg.id)}` : ""}`;

export async function buildZip(pkg: Package) {
  const files = await db.select().from(F).where(eq(F.packageId, pkg.id)).orderBy(asc(F.path));
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    if (f.mediaId) {
      const m = await db.query.media.findFirst({ where: eq(schema.media.id, f.mediaId) });
      if (m?.file) entries[f.path] = new Uint8Array(await readFile(join(mediaDir(), m.file)));
    } else entries[f.path] = strToU8(f.content);
  }
  return zipSync(entries, { level: 6 });
}

export async function listPackages(companyId: string, onlyShipped = false) {
  const rows = await db.select().from(P).where(eq(P.companyId, companyId)).orderBy(asc(P.createdAt));
  return onlyShipped ? rows.filter((p) => p.version > 0) : rows;
}
export async function packageFilesList(packageId: string) {
  return db.select({ path: F.path, mediaId: F.mediaId }).from(F).where(eq(F.packageId, packageId)).orderBy(asc(F.path));
}
