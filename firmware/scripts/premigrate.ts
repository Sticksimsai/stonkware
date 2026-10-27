// Runs before `drizzle-kit push` in deploy/update.sh. drizzle-kit wrongly treats a new NOT NULL boolean column
// with DEFAULT false as "no default" and offers to TRUNCATE the table. Adding such columns here first avoids that.
import "./_env";
import { createClient } from "@libsql/client";

const COLUMNS: [table: string, column: string, ddl: string][] = [
  ["companies", "flagship", "integer DEFAULT false NOT NULL"],
];

(async () => {
  const url = process.env.DATABASE_URL || "file:./firmware.db";
  const c = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  for (const [table, column, ddl] of COLUMNS) {
    const exists = (await c.execute({ sql: "select name from sqlite_master where type='table' and name=?", args: [table] })).rows.length;
    if (!exists) continue; // fresh database: drizzle-kit creates the table with the column
    const cols = (await c.execute(`pragma table_info(${table})`)).rows.map((r) => String(r.name));
    if (cols.includes(column)) continue;
    await c.execute(`ALTER TABLE ${table} ADD ${column} ${ddl}`);
    console.log(`premigrate: added ${table}.${column}`);
  }
  process.exit(0);
})().catch((e) => { console.error("premigrate:", (e as Error).message); process.exit(1); });
