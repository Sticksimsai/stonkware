// Agents mid-shift right now, with latest screenshot id + latest action.
import { workingNow } from "@/lib/queries";
import { handle, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => ok(await workingNow(12)));
