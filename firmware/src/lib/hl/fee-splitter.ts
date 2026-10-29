// Platform revenue → FeeSplitter on HyperEVM → flagship share (to its HyperCore account) + platform, in public.
// Flow: the platform wallet collects platform cuts on HyperCore; once it holds FEE_DISTRIBUTE_MIN_USD, this moves the
// USDC to the platform's HyperEVM address, hands it to the contract and calls distribute(). Off unless configured.
import { createPublicClient, defineChain, http, keccak256, parseAbi, toHex } from "viem";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { env, isLive } from "../env";
import { createId } from "../id";
import { creditFlagship, flagshipSharePct } from "../flagship";
import { hlBalance } from "./client";
import { solPrice } from "./bridge";
import { evmConfig } from "./payments";
import { platformDistribute, platformUsdcToEvm } from "./signer";

const D = schema.feeDistributions;
const P = schema.platformRevenue;
const abi = parseAbi([
  "function totalDistributed() view returns (uint256)",
  "function totalToFlagship() view returns (uint256)",
  "function flagshipBps() view returns (uint16)",
  "function flagship() view returns (address)",
  "function platform() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
]);

/** The platform can run distributions (contract + platform key configured). Mock mode simulates the chain side. */
export const splitterEnabled = () => !!env.feeSplitter && !!env.platformHlKeySealed && !!env.platformHlWallet;

function evm() {
  const n = evmConfig();
  return createPublicClient({ chain: defineChain({ id: n.chainId, name: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [env.hyperEvmRpc || n.rpc] } } }), transport: http() });
}

/** USDC (6-dec units) the platform can move, rounded down so nothing is burned between 8 and 6 decimals. */
export const evmUnits = (usdc: number) => BigInt(Math.floor(usdc * 1e6 + 1e-6));
export const unitsToAmount = (u: bigint) => (Number(u) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
/** bytes32 ref for distribute(): ties the on-chain event to our row. */
export const refFor = (id: string) => keccak256(toHex(`hypeware:fees:${id}`));

let stats: { at: number; v: Awaited<ReturnType<typeof readStats>> } | null = null;
async function readStats() {
  const c = evm();
  const a = env.feeSplitter as `0x${string}`;
  const [total, toFlagship, bps, flagship, platform] = await Promise.all([
    c.readContract({ address: a, abi, functionName: "totalDistributed" }),
    c.readContract({ address: a, abi, functionName: "totalToFlagship" }),
    c.readContract({ address: a, abi, functionName: "flagshipBps" }),
    c.readContract({ address: a, abi, functionName: "flagship" }),
    c.readContract({ address: a, abi, functionName: "platform" }),
  ]);
  return { address: a, chainId: evmConfig().chainId, totalDistributedUsd: Number(total) / 1e6, totalToFlagshipUsd: Number(toFlagship) / 1e6, flagshipBps: bps, flagship, platform };
}

/** Public on-chain totals for the /token page. null when no contract is configured. Cached 5 min. */
export async function splitterStats() {
  if (!env.feeSplitter || !isLive()) return null;
  if (stats && Date.now() - stats.at < 5 * 60_000) return stats.v;
  const v = await readStats().catch((e) => { console.error("[fees] splitter stats:", (e as Error).message.slice(0, 120)); return null; });
  if (v) stats = { at: Date.now(), v };
  return v;
}

let lastStart = 0;
const STUCK_MS = 60 * 60_000;

/** Scheduler step: finish an in-flight distribution, or start one when enough has built up. */
export async function feeSplitterUpkeep() {
  if (!splitterEnabled()) return;
  const live = isLive();
  const open = await db.query.feeDistributions.findFirst({ where: eq(D.state, "TO_EVM"), orderBy: desc(D.createdAt) });
  const c = evm();
  const n = evmConfig();
  if (open) {
    const units = BigInt(open.units);
    const onEvm = live ? await c.readContract({ address: n.usdc as `0x${string}`, abi, functionName: "balanceOf", args: [env.platformHlWallet as `0x${string}`] }) : units;
    if (onEvm < units) {
      if (Date.now() - open.createdAt.getTime() > STUCK_MS) {
        await db.update(D).set({ state: "STUCK", error: `USDC not on HyperEVM after 60 min (have ${onEvm}, need ${units})` }).where(eq(D.id, open.id));
        console.error(`[fees] distribution ${open.id} STUCK: USDC didn't arrive on HyperEVM`);
      }
      return;
    }
    try {
      const r = await platformDistribute(units, open.ref as `0x${string}`);
      await db.update(D).set({ state: "DISTRIBUTED", transferTx: r.transferTx, distributeTx: r.distributeTx, toFlagship: r.toFlagship.toString(), toPlatform: r.toPlatform.toString(), doneAt: new Date() }).where(eq(D.id, open.id));
      if (r.toFlagship > 0n) {
        const usd = Number(r.toFlagship) / 1e6;
        await creditFlagship(Math.round((usd / (await solPrice())) * 1e9), `$${usd.toFixed(2)} USDC: ${flagshipSharePct()}% of Hypeware's revenue, paid on-chain by the FeeSplitter`, r.distributeTx);
      }
      stats = null;
    } catch (e) {
      await db.update(D).set({ error: (e as Error).message.slice(0, 300) }).where(eq(D.id, open.id));
      console.error(`[fees] distribute ${open.id}:`, (e as Error).message.slice(0, 200));
    }
    return;
  }
  if (live && Date.now() - lastStart < 60 * 60_000) return;
  lastStart = Date.now();
  // only recorded platform-share revenue is split; compute repayments in the same wallet are not
  const pending = await db.select().from(P).where(isNull(P.distributionId));
  const owed = pending.reduce((a, r) => a + BigInt(r.units), 0n);
  if (Number(owed) / 1e6 < env.feeDistributeMinUsd) return;
  if (live) {
    const onCore = evmUnits((await hlBalance(env.platformHlWallet)).spotUsdc);
    if (onCore < owed) { console.error(`[fees] platform wallet holds ${unitsToAmount(onCore)} USDC on HyperCore but ${unitsToAmount(owed)} is owed to the FeeSplitter`); return; }
    const gas = await c.getBalance({ address: env.platformHlWallet as `0x${string}` });
    if (gas < 10n ** 15n) { console.error("[fees] platform wallet needs ≥ 0.001 HYPE on HyperEVM for gas; skipping distribution"); return; }
  }
  const id = createId();
  await db.insert(D).values({ id, units: owed.toString(), ref: refFor(id) });
  await db.update(P).set({ distributionId: id }).where(and(isNull(P.distributionId), inArray(P.id, pending.map((r) => r.id))));
  try {
    const coreRef = await platformUsdcToEvm(unitsToAmount(owed));
    await db.update(D).set({ coreRef }).where(eq(D.id, id));
  } catch (e) {
    // nothing moved: release the revenue rows for the next attempt
    await db.update(D).set({ state: "FAILED", error: (e as Error).message.slice(0, 300), doneAt: new Date() }).where(eq(D.id, id));
    await db.update(P).set({ distributionId: null }).where(eq(P.distributionId, id));
    console.error("[fees] move USDC to HyperEVM:", (e as Error).message.slice(0, 200));
  }
}
