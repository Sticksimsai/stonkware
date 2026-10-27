// Creator-only: connect / disconnect a Telegram or Discord bot account for the agent to run.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { fail, handle, ok } from "@/lib/http";
import { verifyCreator } from "@/lib/creator-auth";
import { connect, disconnect, isPlatform } from "@/lib/bots";

export const runtime = "nodejs";

const Body = z.object({
  platform: z.string(),
  action: z.enum(["connect", "disconnect"]).default("connect"),
  wallet: z.string().optional(),
  signature: z.string(),
  ts: z.number().optional(),
  secrets: z.record(z.string()).default({}),
});

export const POST = handle(async (req: Request, { params }: { params: { slug: string } }) => {
  const b = Body.parse(await req.json());
  if (!isPlatform(b.platform)) return fail(400, "platform must be telegram or discord");
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.slug, params.slug) });
  if (!c || c.status === "ARCHIVED") return fail(404, "not found");
  try {
    verifyCreator(c, { wallet: b.wallet, signature: b.signature, ts: b.ts, action: `${b.action} ${b.platform}` });
  } catch (e) {
    return fail((e as { status?: number }).status ?? 401, (e as Error).message);
  }
  if (b.action === "disconnect") {
    await disconnect(c, b.platform);
    return ok({ ok: true });
  }
  try {
    const meta = await connect(c, b.platform, b.secrets);
    return ok({ ok: true, meta });
  } catch (e) {
    return fail(400, (e as Error).message);
  }
});
