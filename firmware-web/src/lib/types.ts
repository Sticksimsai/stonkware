export type Split = { total: number; company: number; firmware: number; meteora: number };
export type Config = {
  mode: "mock" | "live";
  /** where new coins launch: StonkFun (Raydium LaunchLab) or Stonkware's own Meteora config */
  venue?: "stonkfun" | "meteora";
  /** Stonkware's share of creator trading fees on StonkFun, in bps */
  creatorFeeShareBps?: number;
  apiUrl: string;
  cluster?: "devnet" | "mainnet-beta";
  solanaRpcUrl: string | null;
  launch: { launchCostLamports: number; defaultFuelSol: number; maxImageBytes: number; imageRequired: boolean };
  fees: { tradeFeeSplitBps: Split; venueLabel?: string; antiSniper: { startFeeBps: number; seconds: number }; platformRevenueBps: number; treasuryFloorLamports: number };
  media?: { enabled: boolean; imageUsd: number; videoUsdPerSec: number };
  flagship?: { slug: string; name: string; ticker: string; live: boolean } | null;
  vanity?: { suffix: string } | null;
  curve: { initialMarketCapSol: number; migrationMarketCapSol: number; totalSupply: number; decimals: number };
};
export type Stats = { companies: number; working: number; actions: number; files: number; fees: number; revenue: number };
export type FeedItem = { id: string; kind: string; title: string; body: string; sig: string | null; createdAt: string; slug?: string; ticker?: string; name?: string; companyId?: string; hasImage?: number | boolean; flagship?: number | boolean };
export type Working = { runId: string; companyId: string; slug: string; name: string; ticker: string; startedAt: string; shot: { id: string; url: string | null } | null; last: { tool: string | null; kind: string; content: string } | null };
export type CompanyRow = {
  id: string; slug: string; name: string; ticker: string; tagline: string; status: string; hasImage: boolean; modelLabel: string;
  lifetimeFees: number; lifetimeRevenue: number; lifetimeCompute: number; tokensBurned: string;
  sleepingUntil: string | null; lastRunAt: string | null; createdAt: string; working: boolean;
};
export type Offer = {
  id: string; title: string; description: string; priceLamports: number; active: boolean; createdAt: string;
  kind?: "service" | "download" | "merch";
  merch?: { productTitle: string; designUrl: string; variants: { id: number; label: string }[] } | null;
};
export type BotInfo = { platform: "telegram" | "discord"; connected: boolean; account: string | null; link: string | null; live: boolean; commands: string[]; handled: number };
export type PackageInfo = { id: string; name: string; title: string; description: string; kind: string; version: number; downloads: number; url: string | null; paid: boolean };
export type ConnectRequest = { platform: "telegram" | "discord"; why: string; at: string };
export type LedgerRow = { id: string; kind: string; lamports: number; tokens: string | null; counterparty: string | null; sig: string | null; memo: string; createdAt: string };
export type Shift = { id: string; status: string; steps: number; costLamports: number; summary: string | null; startedAt: string };
export type CompanyDetail = {
  company: {
    id: string; slug: string; name: string; ticker: string; aim: string; tagline: string; twitter: string | null; model: string; modelLabel: string;
    status: string; launchError: string | null; creatorWallet: string; treasuryPubkey: string; mintPubkey: string; poolAddress: string | null; migrated: boolean; venue?: string | null; quoteMint?: string | null; quoteSymbol?: string | null;
    lifetimeFees: number; lifetimeRevenue: number; lifetimeCompute: number; lifetimeSpent: number; tokensBurned: string;
    sleepingUntil: string | null; lastRunAt: string | null; createdAt: string; balanceLamports: number | null;
    imageUrl: string | null; websiteUrl: string | null; links: { trade: string | null; chart: string | null; treasury: string | null };
  };
  offers: Offer[]; feed: FeedItem[]; ledger: LedgerRow[]; shifts: Shift[]; websiteFiles: string[]; ordersDelivered: number; media?: MediaItem[];
  bots?: BotInfo[]; packages?: PackageInfo[]; connectRequests?: ConnectRequest[];
  capabilities?: { media: boolean; merch: boolean; bots: boolean; packages: boolean };
};
export type MediaItem = { id: string; kind: "image" | "video"; prompt: string; aspect: string | null; durationSec: number | null; status: string; url: string | null; mime: string | null; costLamports: number; createdAt: string };
export type Model = { id: string; label: string; provider: string; inUsdPerM: number; outUsdPerM: number; context: number };
export type Step = { id: string; seq: number; kind: "THINK" | "TOOL" | "RESULT" | "SHOT" | "MEDIA" | "ERROR"; tool: string | null; content: string; url: string | null; createdAt: string };
export type Run = { id: string; status: string; liveUrl: string | null; browser: string; steps: number; costLamports: number; summary: string | null; startedAt: string; endedAt: string | null };
export type Order = { id: string; status: string; format: "markdown" | "html"; deliverable: string | null; deliveredAt: string | null; kind?: "merch" | "service"; fulfillment?: { status: string; tracking: { carrier: string; number: string; url: string }[]; draft: boolean } | null };

export type Market = {
  priceUsd: number | null; priceSol: number | null; marketCapUsd: number | null; fdvUsd: number | null; liquidityUsd: number | null;
  volume24hUsd: number | null; change24h: number | null; pairAddress: string; dex: string; url: string; buys24h: number | null; sells24h: number | null;
};
export type Flagship = {
  id: string; hasImage: boolean; slug: string; name: string; ticker: string; tagline: string; venue: string | null;
  status: "prelaunch" | "live"; mint: string | null; treasury: string; balanceLamports: number | null; market: Market | null;
  links: { buy: string; chart: string; chartEmbed: string | null; solscan: string } | null;
  funding: { sharePct: number; lifetimeLamports: number };
  economics?: { taxBps: number; fees24hUsd: number | null; fees24hSol: number | null; feesTotalUsd: number | null; compute24hUsd: number; compute24hSol: number; computeTotalSol: number; coveragePct: number | null } | null;
  model?: string;
  building?: { enabled: boolean; shipped: number; open: number; changes: DevChange[] };
};
export type DevChange = {
  number: number; title: string; why: string; lane: "auto" | "review"; status: "open" | "merged" | "closed"; ci: "pending" | "success" | "failure";
  files: number; additions: number; deletions: number; createdAt: string; mergedAt: string | null;
};

export type Pair = { mint: string; symbol: string; name: string; image: string | null; decimals: number | null; category: string | null };
