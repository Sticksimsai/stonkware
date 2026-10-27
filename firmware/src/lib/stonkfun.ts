// StonkFun public API (https://www.stonkfun.xyz/developers). Read-only helpers + the post-graduation fee claim.
// The API's response schemas are only partly documented, so every reader here is defensive and normalises
// field names; `npm run stonkfun:probe` prints the raw responses so we can check them on a real server.
import { env } from "./env";

export type Pair = {
  mint: string; symbol: string; name: string; image: string | null; decimals: number | null;
  tokenProgram: string | null; category: string | null; launchable: boolean; launchLabReady: boolean;
};

export type Pricing = {
  programId: string | null;
  configId: string | null;
  platformId: string; // standard mode
  baseDecimals: number;
  supply: string;
  totalSellA: string;
  totalFundRaisingB: string;
  migrateType: "amm" | "cpmm";
  cpmmCreatorFeeOn: number | null;
  allowConfig: string | null;
  allowConfigRequired: boolean;
  curveRule: string | null;
  raw: unknown;
};

const base = () => env.stonkfunApi.replace(/\/+$/, "");

async function get(path: string, ttlMs = 0): Promise<unknown> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const r = await fetch(`${base()}${path}`, { headers: { accept: "application/json", "user-agent": "firmware/1" }, signal: AbortSignal.timeout(12_000) });
  const text = await r.text();
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`stonkfun ${path} → ${r.status}: ${text.slice(0, 200)}`);
  if (ttlMs) cache.set(path, { at: Date.now(), v: j });
  return j;
}
const cache = new Map<string, { at: number; v: unknown }>();

/** Read a value by trying several dotted paths. */
export function pick(o: unknown, paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = o;
    for (const k of p.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}
const s = (v: unknown) => (v === undefined || v === null ? null : typeof v === "object" ? (pick(v, ["address", "id", "pubkey"]) as string | undefined) ?? null : String(v));
const unwrap = (j: unknown): unknown => (j && typeof j === "object" && "data" in (j as object) && !Array.isArray(j) ? (j as { data: unknown }).data : j);
const list = (j: unknown): unknown[] => {
  const u = unwrap(j);
  if (Array.isArray(u)) return u;
  const inner = pick(u, ["items", "pairs", "results", "data"]);
  return Array.isArray(inner) ? inner : [];
};
const truthy = (v: unknown) => v === true || v === "true" || v === 1;

function normPair(p: unknown): Pair | null {
  const mint = s(pick(p, ["mint", "quoteMint", "address", "token.mint", "token.address", "id"]));
  if (!mint) return null;
  return {
    mint,
    symbol: String(pick(p, ["symbol", "ticker", "token.symbol"]) ?? "?"),
    name: String(pick(p, ["name", "token.name", "symbol"]) ?? ""),
    image: s(pick(p, ["image", "logo", "logoURI", "logoUri", "icon", "token.image", "token.logo"])),
    decimals: Number(pick(p, ["decimals", "token.decimals", "quoteDecimals"])) || null,
    tokenProgram: s(pick(p, ["tokenProgram", "programId", "token.tokenProgram", "quoteTokenProgram"])),
    category: s(pick(p, ["category", "type", "kind"])),
    launchable: truthy(pick(p, ["launchable"])) || pick(p, ["launchable"]) === undefined,
    launchLabReady: truthy(pick(p, ["launchLabReady"])),
  };
}

/** Quote tokens a new LaunchLab coin can pair with (cached 5 min). */
export async function launchPairs(): Promise<Pair[]> {
  const out: Pair[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const q: string = `/api/v2/pairs?launchable=true&launchLabReady=true&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const j = await get(q, 5 * 60_000);
    for (const p of list(j)) { const n = normPair(p); if (n) out.push(n); }
    cursor = (pick(j, ["page.nextCursor", "nextCursor", "meta.nextCursor"]) as string | undefined) ?? null;
    if (!cursor) break;
  }
  return out.filter((p) => p.launchLabReady || p.launchable);
}

export async function findPair(mint: string): Promise<Pair | null> {
  return (await launchPairs()).find((p) => p.mint === mint) ?? null;
}

/** LaunchLab parameters for a quote token: curve, raise, platform + allow/curve-rule accounts. Read on every launch. */
export async function launchPricing(quoteMint: string): Promise<Pricing> {
  const raw = unwrap(await get(`/api/v2/launchlab/pricing?quoteMint=${encodeURIComponent(quoteMint)}`));
  const platformId = s(pick(raw, ["platform.standard", "pricing.platform.standard", "platforms.standard"]));
  if (!platformId) throw new Error("StonkFun pricing has no standard platform id for this quote");
  const supply = pick(raw, ["curve.supply", "pricing.curve.supply", "supply"]);
  const totalSellA = pick(raw, ["curve.totalSellA", "pricing.curve.totalSellA", "totalSellA"]);
  const raise = pick(raw, ["raise.raw", "pricing.raise.raw", "totalFundRaisingB", "curve.totalFundRaisingB"]);
  if (supply == null || totalSellA == null || raise == null) throw new Error("StonkFun pricing is missing supply / totalSellA / raise");
  const allowAvail = pick(raw, ["allowConfig.available.standard"]);
  const mt = String(pick(raw, ["curve.migrateType", "migrateType"]) ?? "cpmm").toLowerCase();
  const feeOn = pick(raw, ["curve.cpmmCreatorFeeOn", "cpmmCreatorFeeOn"]);
  return {
    programId: s(pick(raw, ["curve.programId", "pricing.curve.programId", "programId"])),
    configId: s(pick(raw, ["curve.configId", "pricing.curve.configId", "configId", "globalConfig"])),
    platformId,
    baseDecimals: Number(pick(raw, ["curve.baseDecimals", "baseDecimals"]) ?? 6),
    supply: String(supply), totalSellA: String(totalSellA), totalFundRaisingB: String(raise),
    migrateType: mt === "amm" || mt === "0" ? "amm" : "cpmm",
    cpmmCreatorFeeOn: feeOn == null ? null : Number(feeOn === "BothToken" ? 1 : feeOn === "OnlyTokenB" ? 0 : feeOn),
    allowConfig: typeof allowAvail === "string" ? allowAvail : s(allowAvail),
    allowConfigRequired: truthy(pick(raw, ["allowConfig.required"])),
    curveRule: s(pick(raw, ["curveRule.standard", "curveRule.address", "curveRule"])),
    raw,
  };
}

/** Token snapshot from StonkFun (adoption, graduation, price). Null when it isn't adopted (yet). */
export async function stonkToken(mint: string): Promise<Record<string, unknown> | null> {
  try { return unwrap(await get(`/api/v2/tokens/${mint}`, 30_000)) as Record<string, unknown>; } catch { return null; }
}

export const stonkfunTokenUrl = (mint: string) => `${base()}/token/${mint}`;

/** Post-graduation creator-fee claim (the locked Raydium position's Fee Key is held by the treasury). */
export async function prepareFeeClaim(mint: string, creatorWallet: string): Promise<{ intentId: string; tx: string; amounts: unknown } | null> {
  const r = await fetch(`${base()}/api/public/v1/tokens/${mint}/fees/claim/prepare`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorWallet }), signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) {
    if (r.status === 404 || r.status === 409) return null; // nothing to claim / not graduated
    throw new Error(`stonkfun claim prepare ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }
  const d = unwrap(j);
  const intentId = s(pick(d, ["intentId", "intent.id", "id"]));
  const tx = s(pick(d, ["transaction", "tx", "unsignedTransaction", "serializedTransaction"]));
  if (!intentId || !tx) return null;
  return { intentId, tx, amounts: pick(d, ["amounts", "collect", "estimated"]) };
}

export async function submitFeeClaim(mint: string, creatorWallet: string, intentId: string, signedTransaction: string): Promise<string | null> {
  const r = await fetch(`${base()}/api/public/v1/tokens/${mint}/fees/claim/submit`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorWallet, intentId, signedTransaction }), signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw new Error(`stonkfun claim submit ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return s(pick(unwrap(j), ["signature", "sig", "txid"]));
}
