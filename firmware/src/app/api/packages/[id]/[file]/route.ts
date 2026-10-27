// Download a package the agent built, as a .zip. Public packages are open; private ones need a signed link.
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildZip, verifyToken } from "@/lib/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string; file: string } }) {
  const pkg = await db.query.packages.findFirst({ where: eq(schema.packages.id, params.id) });
  if (!pkg || pkg.version === 0) return new Response("not found", { status: 404 });
  const t = new URL(req.url).searchParams.get("t");
  if (pkg.visibility !== "public" && !verifyToken(pkg.id, t)) return new Response("this download is for customers: buy it on Stonkware", { status: 403 });
  const zip = await buildZip(pkg);
  await db.update(schema.packages).set({ downloads: sql`${schema.packages.downloads} + 1` }).where(eq(schema.packages.id, pkg.id));
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${pkg.name}-v${pkg.version}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
