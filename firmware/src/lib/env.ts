function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] !== undefined ? v : fallback;
};

export const env = {
  mode: str("FIRMWARE_MODE", "mock") as "mock" | "live",
  rpcUrl: str("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
  /** RPC the browser (wallet deposits) should use. Read at runtime, so switching networks needs no rebuild. */
  publicRpcUrl: str("PUBLIC_SOLANA_RPC_URL", process.env["NEXT_" + "PUBLIC_SOLANA_RPC_URL"] || ""),
  /** "devnet" or "mainnet-beta". Inferred from the RPC URL when unset. */
  cluster: (str("SOLANA_CLUSTER") || (str("SOLANA_RPC_URL").includes("devnet") ? "devnet" : "mainnet-beta")) as "devnet" | "mainnet-beta",
  /** How often each company's trading fees are claimed into its treasury (live mode). */
  claimEveryMin: num("CLAIM_EVERY_MIN", 120),
  vaultKey: str("VAULT_KEY"),
  platformFeeWallet: str("PLATFORM_FEE_WALLET"),
  siteUrl: str("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
  /** Public website (frontend) URL — where storefronts and company pages live, e.g. https://stonkware.com. */
  appUrl: str("APP_URL", str("NEXT_PUBLIC_SITE_URL", "http://localhost:3000")),
  pinataJwt: str("PINATA_JWT"),
  /** Stonkware's Meteora DBC config key (created once with `npm run meteora:config`). Only for LAUNCH_VENUE=meteora. */
  dbcConfig: str("DBC_CONFIG"),
  /** Where new tokens launch: "stonkfun" (Raydium LaunchLab under StonkFun's platform) or "meteora" (Stonkware's own DBC config). */
  launchVenue: str("LAUNCH_VENUE", "stonkfun") as "stonkfun" | "meteora",
  stonkfunApi: str("STONKFUN_API_URL", "https://www.stonkfun.xyz"),
  /** Stonkware's share of each company's creator trading fees, in bps (StonkFun venue: Stonkware has no partner cut). */
  creatorFeeShareBps: num("CREATOR_FEE_SHARE_BPS", 2000),
  cronSecret: str("CRON_SECRET"),
  /** Comma-separated origins allowed to call /api (the Lovable frontend). */
  allowedOrigins: str("ALLOWED_ORIGINS"),

  // Models (OpenRouter: one key → Claude, OpenAI, Gemini, Grok, DeepSeek, Qwen…)
  openrouterKey: str("OPENROUTER_API_KEY"),
  // Browser for the agent: Browserbase (live view) → local Chromium (screenshots) → plain fetch.
  browserbaseKey: str("BROWSERBASE_API_KEY"),
  browserbaseProject: str("BROWSERBASE_PROJECT_ID"),
  chromiumPath: str("CHROMIUM_PATH"),

  // Agent pacing
  maxStepsPerShift: num("AGENT_MAX_STEPS", 40),
  shiftEveryMin: num("AGENT_SHIFT_EVERY_MIN", 30),
  maxConcurrentShifts: num("AGENT_MAX_CONCURRENT", 3),
  /** Optional safety caps. Unset = unlimited (agent has full control of the treasury). */
  maxTransferSol: num("AGENT_MAX_TRANSFER_SOL", Infinity),
  maxDailySpendSol: num("AGENT_MAX_DAILY_SPEND_SOL", Infinity),

  // Media studio (Higgsfield API: images + video). Off when the key is unset.
  // HF_CREDENTIALS="key-id:key-secret" (Higgsfield's official format), or the two separate variables
  higgsfieldKeyId: str("HIGGSFIELD_API_KEY_ID", str("HF_CREDENTIALS").split(":")[0] ?? ""),
  higgsfieldKeySecret: str("HIGGSFIELD_API_KEY_SECRET", str("HF_CREDENTIALS").includes(":") ? str("HF_CREDENTIALS").slice(str("HF_CREDENTIALS").indexOf(":") + 1) : ""),
  hfImageEndpoint: str("HIGGSFIELD_IMAGE_ENDPOINT", "higgsfield-ai/soul/v2/standard"),
  hfVideoEndpoint: str("HIGGSFIELD_VIDEO_ENDPOINT", "bytedance/seedance-2.5/text-to-video"),
  /** 480p | 720p | 1080p (Seedance) */
  hfVideoResolution: str("HIGGSFIELD_VIDEO_RESOLUTION", "720p"),
  hfImageToVideoEndpoint: str("HIGGSFIELD_I2V_ENDPOINT", "kling-video/v3.0-turbo/image-to-video"),
  /** What Stonkware bills the treasury (USD), set at or slightly above Higgsfield's price. */
  hfImageUsd: num("HIGGSFIELD_IMAGE_USD", 0.01),
  hfVideoUsdPerSec: num("HIGGSFIELD_VIDEO_USD_PER_SEC", 0.21),
  /** Optional cap on video seconds per company per day. Unset = unlimited (the treasury is the limit). */
  maxVideoSecPerDay: num("MEDIA_MAX_VIDEO_SEC_PER_DAY", Infinity),
  /** Where generated files are stored. Default: a "media" folder next to the SQLite database. */
  mediaDir: str("MEDIA_DIR"),

  // Costs the platform fronts and bills back to each treasury
  solUsdFallback: num("SOL_USD", 150),
  browserUsdPerMin: num("BROWSER_USD_PER_MIN", 0.002),
};

export const isLive = () => env.mode === "live";

/** Solscan link for a tx or account on the configured cluster. */
export const explorer = (kind: "tx" | "account" | "token", id: string) =>
  `https://solscan.io/${kind}/${id}${env.cluster === "devnet" ? "?cluster=devnet" : ""}`;
