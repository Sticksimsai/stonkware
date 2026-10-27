import { listModels, PROVIDERS } from "@/lib/models";
import { ok, handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const { models, live } = await listModels();
  return ok({ live, providers: PROVIDERS, models });
});
