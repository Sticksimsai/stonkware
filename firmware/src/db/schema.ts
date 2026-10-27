// Stonkware data model (Drizzle + libSQL/SQLite).
// All SOL amounts are integer lamports (safe up to ~9M SOL in a JS number).
import { sqliteTable, text, integer, blob, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createId } from "@/lib/id";

const now = () => sql`(unixepoch() * 1000)`;
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });

/**
 * A Company = a token + the autonomous agent that runs it.
 * The creator only supplies identity, the aim, and the model. Everything else is the agent's call.
 */
export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    ticker: text("ticker").notNull(),
    /** The creator's outline of what the business should become. The agent's north star. */
    aim: text("aim").notNull(),
    /** Public one-liner — written by the agent, starts as the aim. */
    tagline: text("tagline").notNull().default(""),
    image: blob("image", { mode: "buffer" }),
    imageMime: text("image_mime"),
    twitter: text("twitter"),
    /** OpenRouter model id, e.g. "anthropic/claude-sonnet-…". Fixed at launch. */
    model: text("model").notNull(),
    modelLabel: text("model_label").notNull(),
    /** PENDING_FUNDING | LAUNCHING | LIVE | FAILED | PAUSED */
    status: text("status").notNull().default("PENDING_FUNDING"),

    creatorWallet: text("creator_wallet").notNull(),
    treasuryPubkey: text("treasury_pubkey").notNull().unique(),
    /** AES-256-GCM ciphertext. Only src/lib/signer.ts may decrypt it. */
    treasurySecretEnc: text("treasury_secret_enc").notNull(),
    mintPubkey: text("mint_pubkey").notNull().unique(),
    mintSecretEnc: text("mint_secret_enc"),
    /** launchpad (launched through Stonkware) | external (e.g. the platform token, launched elsewhere) */
    source: text("source").notNull().default("launchpad"),
    /** The platform's own token: dedicated /token page, funded by a share of Stonkware's revenue. */
    flagship: integer("flagship", { mode: "boolean" }).notNull().default(false),
    /** external tokens: where it trades (e.g. "Meteora") and the planned launch time (countdown) */
    venue: text("venue"),
    /** Quote token the coin trades against (StonkFun pairs). Null = SOL on Meteora (v1 launches). */
    quoteMint: text("quote_mint"),
    quoteSymbol: text("quote_symbol"),
    launchAt: ts("launch_at"),
    metadataUri: text("metadata_uri"),
    /** Meteora DBC pool (bonding curve). After graduation the token trades on DAMM v2. */
    poolAddress: text("pool_address"),
    migrated: integer("migrated", { mode: "boolean" }).notNull().default(false),
    launchSig: text("launch_sig"),
    launchError: text("launch_error"),
    devBuySol: real("dev_buy_sol").notNull().default(0),
    fuelSol: real("fuel_sol").notNull().default(0),
    requiredLamports: integer("required_lamports").notNull().default(0),
    fundingSig: text("funding_sig").unique(),

    lifetimeFees: integer("lifetime_fees").notNull().default(0),
    lifetimeRevenue: integer("lifetime_revenue").notNull().default(0),
    lifetimeCompute: integer("lifetime_compute").notNull().default(0),
    lifetimeSpent: integer("lifetime_spent").notNull().default(0),
    tokensBurned: text("tokens_burned").notNull().default("0"),

    /** JSON string[] — the agent's long-term notes. */
    memory: text("memory").notNull().default("[]"),
    /** JSON [{ platform, why, at }]: accounts the agent asked the creator to connect */
    connectRequests: text("connect_requests").notNull().default("[]"),
    sleepingUntil: ts("sleeping_until"),
    /** Set when something happened that the agent should react to (new order, launch). */
    wakeRequested: integer("wake_requested", { mode: "boolean" }).notNull().default(true),
    lastRunAt: ts("last_run_at"),
    /** when the next shift is due, paced by what the treasury can afford (see lib/pace.ts) */
    nextShiftAt: ts("next_shift_at"),
    lastClaimAt: ts("last_claim_at"),
    createdAt: ts("created_at").notNull().default(now()),
  },
  (t) => ({ statusIdx: index("companies_status_idx").on(t.status) }),
);

/** Files of the company's website, written entirely by the agent. Served at /s/<slug>/<path>. */
export const siteFiles = sqliteTable(
  "site_files",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    mime: text("mime").notNull(),
    updatedAt: ts("updated_at").notNull().default(now()),
  },
  (t) => ({ uniq: uniqueIndex("site_files_company_path").on(t.companyId, t.path) }),
);

/** Paid offers the agent decided to sell. */
export const offers = sqliteTable("offers", {
  id: text("id").primaryKey().$defaultFn(createId),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priceLamports: integer("price_lamports").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** service (agent delivers) | download (auto-delivers a package) | merch (Printful print-on-demand) */
  kind: text("kind").notNull().default("service"),
  /** JSON: download → { packageId }; merch → { productId, productTitle, variants: [{ id, label, costUsd }], designMediaId, placement } */
  meta: text("meta"),
  createdAt: ts("created_at").notNull().default(now()),
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    offerId: text("offer_id").notNull().references(() => offers.id),
    buyerWallet: text("buyer_wallet").notNull(),
    brief: text("brief").notNull(),
    priceLamports: integer("price_lamports").notNull(),
    reference: text("reference").notNull().unique(),
    /** AWAITING_PAYMENT | PAID | DELIVERED */
    status: text("status").notNull().default("AWAITING_PAYMENT"),
    paySig: text("pay_sig").unique(),
    deliverable: text("deliverable"),
    /** merch: chosen Printful variant */
    variantId: integer("variant_id"),
    /** merch: sealed JSON shipping address (only decrypted to submit to Printful) */
    shippingEnc: text("shipping_enc"),
    /** merch: JSON { printfulId, status, costUsd, tracking: [{ carrier, number, url }] } */
    fulfillment: text("fulfillment"),
    /** markdown | html */
    format: text("format").notNull().default("markdown"),
    createdAt: ts("created_at").notNull().default(now()),
    paidAt: ts("paid_at"),
    deliveredAt: ts("delivered_at"),
  },
  (t) => ({ byCompany: index("orders_company_status_idx").on(t.companyId, t.status) }),
);

/** One working session of the agent. */
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** RUNNING | DONE | ERROR */
    status: text("status").notNull().default("RUNNING"),
    /** Live browser view (Browserbase debugger URL) while running. */
    liveUrl: text("live_url"),
    browser: text("browser").notNull().default("none"),
    steps: integer("steps").notNull().default(0),
    costLamports: integer("cost_lamports").notNull().default(0),
    summary: text("summary"),
    error: text("error"),
    startedAt: ts("started_at").notNull().default(now()),
    endedAt: ts("ended_at"),
  },
  (t) => ({ byCompany: index("runs_company_idx").on(t.companyId, t.startedAt) }),
);

/** Every thought, tool call, result and screenshot — the live feed. */
export const steps = sqliteTable(
  "steps",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** THINK | TOOL | RESULT | SHOT | MEDIA | ERROR */
    kind: text("kind").notNull(),
    tool: text("tool"),
    content: text("content").notNull().default(""),
    url: text("url"),
    image: blob("image", { mode: "buffer" }),
    createdAt: ts("created_at").notNull().default(now()),
  },
  (t) => ({
    byRun: index("steps_run_idx").on(t.runId, t.seq),
    byCompany: index("steps_company_idx").on(t.companyId, t.createdAt),
  }),
);

/** Public highlights: posts, launches, money movements. */
export const feedEvents = sqliteTable(
  "feed_events",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** POST | ACTION | TREASURY | DELIVERY | SYSTEM */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    sig: text("sig"),
    createdAt: ts("created_at").notNull().default(now()),
  },
  (t) => ({
    byCompany: index("feed_company_idx").on(t.companyId, t.createdAt),
    byTime: index("feed_time_idx").on(t.createdAt),
  }),
);

/** Every lamport in or out of the treasury. Sum = treasury balance (in mock mode). */
export const ledger = sqliteTable(
  "ledger",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** FUNDING | LAUNCH | FEE_CLAIM | REVENUE | PLATFORM_FEE | COMPUTE | BUYBACK | BURN | TRANSFER */
    kind: text("kind").notNull(),
    lamports: integer("lamports").notNull(),
    tokens: text("tokens"),
    counterparty: text("counterparty"),
    sig: text("sig"),
    memo: text("memo").notNull().default(""),
    /** For COMPUTE rows: false until reimbursed on-chain to the platform wallet. */
    settled: integer("settled", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull().default(now()),
  },
  (t) => ({ byCompany: index("ledger_company_idx").on(t.companyId, t.createdAt) }),
);

/** Images and videos the agent generated (Higgsfield). Files are downloaded and served by Stonkware. */
export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    /** image | video */
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    aspect: text("aspect"),
    durationSec: integer("duration_sec"),
    /** image-to-video: the media id of the source image */
    sourceId: text("source_id"),
    /** queued | in_progress | completed | failed | nsfw | canceled */
    status: text("status").notNull().default("queued"),
    requestId: text("request_id"),
    remoteUrl: text("remote_url"),
    file: text("file"),
    mime: text("mime"),
    bytes: integer("bytes"),
    /** estimated while rendering, actual charge once completed */
    costLamports: integer("cost_lamports").notNull().default(0),
    error: text("error"),
    createdAt: ts("created_at").notNull().default(now()),
    completedAt: ts("completed_at"),
  },
  (t) => ({
    byCompany: index("media_company_idx").on(t.companyId, t.createdAt),
    byStatus: index("media_status_idx").on(t.status),
  }),
);

/** Third-party accounts the creator connected for the agent to operate (bot tokens etc). Secrets are sealed. */
export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** telegram | discord */
    platform: text("platform").notNull(),
    secretsEnc: text("secrets_enc").notNull(),
    /** public JSON: telegram { username }, discord { appId, publicKey, name } */
    meta: text("meta").notNull().default("{}"),
    webhookSecret: text("webhook_secret").notNull(),
    createdAt: ts("created_at").notNull().default(now()),
  },
  (t) => ({ one: uniqueIndex("connections_company_platform").on(t.companyId, t.platform) }),
);

/** Bot logic the agent writes (JavaScript, run in a QuickJS sandbox on every message). */
export const bots = sqliteTable(
  "bots",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    code: text("code").notNull(),
    commands: text("commands").notNull().default("[]"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    handled: integer("handled").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    updatedAt: ts("updated_at").notNull().default(now()),
  },
  (t) => ({ one: uniqueIndex("bots_company_platform").on(t.companyId, t.platform) }),
);

/** Recent bot conversations, so the agent can read how its bot is doing and improve it. */
export const botEvents = sqliteTable(
  "bot_events",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    input: text("input").notNull(),
    output: text("output"),
    error: text("error"),
    ms: integer("ms").notNull().default(0),
    createdAt: ts("created_at").notNull().default(now()),
  },
  (t) => ({ byCompany: index("bot_events_company_idx").on(t.companyId, t.createdAt) }),
);

/** Small key-value store each company's bots can use (users, scores, settings…). */
export const botKv = sqliteTable(
  "bot_kv",
  {
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: ts("updated_at").notNull().default(now()),
  },
  (t) => ({ pk: uniqueIndex("bot_kv_pk").on(t.companyId, t.key) }),
);

/** Downloadable software the agent builds: browser extensions, apps, templates, scripts. */
export const packages = sqliteTable(
  "packages",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    /** extension | app | template | script | other */
    kind: text("kind").notNull().default("other"),
    /** draft | public | private (private = only via signed links, e.g. paid downloads) */
    visibility: text("visibility").notNull().default("draft"),
    version: integer("version").notNull().default(0),
    downloads: integer("downloads").notNull().default(0),
    createdAt: ts("created_at").notNull().default(now()),
    updatedAt: ts("updated_at").notNull().default(now()),
  },
  (t) => ({ one: uniqueIndex("packages_company_name").on(t.companyId, t.name) }),
);

export const packageFiles = sqliteTable(
  "package_files",
  {
    packageId: text("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull().default(""),
    /** binary file copied from a generated image (e.g. extension icons) */
    mediaId: text("media_id"),
    updatedAt: ts("updated_at").notNull().default(now()),
  },
  (t) => ({ pk: uniqueIndex("package_files_pk").on(t.packageId, t.path) }),
);

/** Improvements the flagship agent proposes to Stonkware's own code (GitHub pull requests). */
export const devChanges = sqliteTable(
  "dev_changes",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull().unique(),
    branch: text("branch").notNull(),
    title: text("title").notNull(),
    why: text("why").notNull().default(""),
    /** auto (merges itself once checks pass) | review (protected files: a human approves) */
    lane: text("lane").notNull(),
    /** open | merged | closed */
    status: text("status").notNull().default("open"),
    /** pending | success | failure */
    ci: text("ci").notNull().default("pending"),
    files: text("files").notNull().default("[]"),
    protectedFiles: text("protected_files").notNull().default("[]"),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    createdAt: ts("created_at").notNull().default(now()),
    mergedAt: ts("merged_at"),
    checkedAt: ts("checked_at"),
  },
  (t) => ({ byStatus: index("dev_changes_status_idx").on(t.status) }),
);

/** Pre-made vanity mint addresses (e.g. ending in "firm") handed out to new launches. Secrets are sealed. */
export const vanityMints = sqliteTable(
  "vanity_mints",
  {
    pubkey: text("pubkey").primaryKey(),
    secretEnc: text("secret_enc").notNull(),
    /** available | reserved | used */
    status: text("status").notNull().default("available"),
    companyId: text("company_id"),
    source: text("source").notNull().default("import"),
    createdAt: ts("created_at").notNull().default(now()),
    reservedAt: ts("reserved_at"),
  },
  (t) => ({ byStatus: index("vanity_status_idx").on(t.status, t.createdAt) }),
);

export type Company = typeof companies.$inferSelect;
export type SiteFile = typeof siteFiles.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Step = typeof steps.$inferSelect;
export type FeedEvent = typeof feedEvents.$inferSelect;
export type LedgerEntry = typeof ledger.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type Bot = typeof bots.$inferSelect;
export type Package = typeof packages.$inferSelect;
