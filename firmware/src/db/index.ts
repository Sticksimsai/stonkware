import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

const g = globalThis as unknown as { __fwClient?: Client; __fwDb?: LibSQLDatabase<typeof schema> };

function make() {
  const client = createClient({
    url: process.env.DATABASE_URL || "file:./firmware.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  // local SQLite file: wait up to 5s for a lock instead of failing at once (the app, its scheduler and
  // admin scripts like `vanity grind` share the file), and use WAL so readers never block writers
  if ((process.env.DATABASE_URL || "file:").startsWith("file:")) {
    void client.execute("PRAGMA busy_timeout = 5000").catch(() => {});
    void client.execute("PRAGMA journal_mode = WAL").catch(() => {});
  }
  return { client, db: drizzle(client, { schema }) };
}

if (!g.__fwDb) {
  const { client, db } = make();
  g.__fwClient = client;
  g.__fwDb = db;
}

export const db = g.__fwDb!;
export { schema };
