import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const ok = (data: unknown, init?: number) =>
  NextResponse.json(data, { status: init ?? 200, headers: { "Cache-Control": "no-store" } });
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Wrap a route handler with consistent error responses. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof ZodError) return fail(400, e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api]", msg.slice(0, 500));
      // never leak DB/internal details (queries can contain sealed keys)
      if (/Failed query|SQLITE|params:|LibsqlError/i.test(msg)) return fail(500, "internal error");
      return fail(400, msg.slice(0, 300));
    }
  };
}

/** JSON-safe company projection (never exposes sealed keys or raw image bytes). */
export function publicCompany<T extends Record<string, unknown>>(c: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { treasurySecretEnc, mintSecretEnc, hlSecretEnc, hlAgentSecretEnc, image, ...rest } = c as Record<string, unknown>;
  return rest;
}
