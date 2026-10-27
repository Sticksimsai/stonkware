import { db, schema } from "@/db";

export type FeedKind = "POST" | "ACTION" | "TREASURY" | "DELIVERY" | "SYSTEM";

export async function emit(companyId: string, kind: FeedKind, title: string, body = "", sig?: string | null) {
  await db.insert(schema.feedEvents).values({ companyId, kind, title: title.slice(0, 200), body: body.slice(0, 4000), sig: sig ?? null });
}

export async function record(companyId: string, kind: string, lamports: number, memo = "", sig?: string | null, tokens?: string) {
  await db.insert(schema.ledger).values({ companyId, kind, lamports, memo, sig: sig ?? null, tokens: tokens ?? null });
}
