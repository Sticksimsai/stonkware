import type { Config } from "drizzle-kit";
import { readFileSync, existsSync } from "fs";

// Minimal .env loader so `npm run db:push` works without extra deps.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:./firmware.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  },
} satisfies Config;
