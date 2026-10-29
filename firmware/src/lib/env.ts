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
  /** Public website (frontend) URL — where storefronts and company pages live, e.g. https://hypeware.fun. */
  appUrl: str("APP_URL", str("NEXT_PUBLIC_SITE_URL", "http://localhost:3000")),
  pinataJwt: str("PINATA_JWT"),
  /** Hypeware's Meteora DBC config key (created once with `npm run meteora:config`). Only for LAUNCH_VENUE=meteora. */
  dbcConfig: str("DBC_CONFIG"),
  /** Where new tokens launch: "stonkfun" (Raydium LaunchLab under StonkFun's platform) or "meteora" (Hypeware's own DBC config). */
  launchVenue: str("LAUNCH_VENUE", "stonkfun") as "stonkfun" | "meteora",
  stonkfunApi: str("STONKFUN_API_URL", "https://www.stonkfun.xyz"),
  /** Hypeware's share of each company's creator trading fees, in bps (StonkFun venue: Hypeware has no partner cut). */
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
  /** What Hypeware bills the treasury (USD), set at or slightly above Higgsfield's price. */
  hfImageUsd: num("HIGGSFIELD_IMAGE_USD", 0.01),
  hfVideoUsdPerSec: num("HIGGSFIELD_VIDEO_USD_PER_SEC", 0.21),
  /** Optional cap on video seconds per company per day. Unset = unlimited (the treasury is the limit). */
  maxVideoSecPerDay: num("MEDIA_MAX_VIDEO_SEC_PER_DAY", Infinity),
  /** Where generated files are stored. Default: a "media" folder next to the SQLite database. */
  mediaDir: str("MEDIA_DIR"),

  // Costs the platform fronts and bills back to each treasury
  solUsdFallback: num("SOL_USD", 150),
  browserUsdPerMin: num("BROWSER_USD_PER_MIN", 0.002),

  // Hyperliquid (the tech chain: USDC treasury, agent trading, payments). Tokens still launch on Solana.
  /** "testnet" or "mainnet". Separate from FIRMWARE_MODE so live Solana launches can run against the Hyperliquid testnet. */
  hlNetwork: (str("HL_NETWORK", "testnet") === "mainnet" ? "mainnet" : "testnet") as "testnet" | "mainnet",
  /** Optional API URL override (e.g. a private node). Default: Hyperliquid's public API for HL_NETWORK. */
  hlApiUrl: str("HL_API_URL"),
  /** Hard cap (USD) on any single transfer out of a company's Hyperliquid account. Unset = no cap. */
  hlMaxTransferUsd: num("HL_MAX_TRANSFER_USD", Infinity),
  /** "on" moves treasury SOL to Hyperliquid through Unit (and back for buybacks). Off by default: no funds move. */
  hlBridge: str("HL_BRIDGE", "off") === "on",
  /** SOL kept on each Solana treasury for gas, rent and small buybacks; the rest is moved to Hyperliquid. */
  solFloatSol: num("SOL_FLOAT_SOL", 0.3),
  /** Only sweep when at least this much SOL is above the float (Unit's network fee is ~0.013 SOL per deposit). */
  solSweepMinSol: num("SOL_SWEEP_MIN_SOL", 0.5),
  /** Refill the Solana treasury from Hyperliquid when it drops below this. */
  solRefillBelowSol: num("SOL_REFILL_BELOW_SOL", 0.1),
  /** Worst price for uSOL ⇄ USDC conversions, vs. Hyperliquid's SOL perp mid. */
  hlMaxSlippageBps: num("HL_MAX_SLIPPAGE_BPS", 300),
  /** Platform's Hyperliquid address: compute is repaid here in USDC when the company has it. */
  platformHlWallet: str("PLATFORM_HL_WALLET"),
  /** "on" gives agents Hyperliquid trading tools (perps + spot) within the limits below. Off by default. */
  hlTrading: str("HL_TRADING", "off") === "on",
  hlMaxLeverage: num("HL_MAX_LEVERAGE", 3),
  /** Capital at risk (perp margin + spot tokens) as % of Hyperliquid equity. */
  hlMaxRiskPct: num("HL_MAX_RISK_PCT", 25),
  /** One order's margin or cost as % of equity. */
  hlMaxOrderPct: num("HL_MAX_ORDER_PCT", 10),
  /** Trading pauses until 00:00 UTC once the day's loss reaches this % of the day's starting equity. */
  hlDailyLossPct: num("HL_DAILY_LOSS_PCT", 10),
  /** Optional comma-separated allow-list, e.g. "BTC,ETH,SOL,HYPE/USDC". Empty = every market. */
  hlAllowedMarkets: str("HL_ALLOWED_MARKETS"),
  /** "on" lets buyers pay for offers in USDC/HYPE on Hyperliquid (from a Hyperliquid account or from HyperEVM). */
  hlPayments: str("HL_PAYMENTS", "off") === "on",
  /** Optional HyperEVM RPC override (default: Hyperliquid's public RPC for HL_NETWORK). */
  hyperEvmRpc: str("HYPEREVM_RPC_URL"),
  /** "off" hides SOL checkout (once Hyperliquid payments are on). */
  solCheckout: str("SOL_CHECKOUT", "on") !== "off",
};

export const isLive = () => env.mode === "live";

/** Hyperliquid explorer link for an address on the configured network. */
export const hlExplorer = (address: string) =>
  `https://app.hyperliquid${env.hlNetwork === "testnet" ? "-testnet" : ""}.xyz/explorer/address/${address}`;

/** Solscan link for a tx or account on the configured cluster. */
export const explorer = (kind: "tx" | "account" | "token", id: string) =>
  `https://solscan.io/${kind}/${id}${env.cluster === "devnet" ? "?cluster=devnet" : ""}`;
