// Unit (hyperunit.xyz): moves native SOL between Solana and Hyperliquid (where it's the spot token uSOL).
// Every address Unit hands us is checked against its guardians' signatures before any funds go to it.
import { createPublicKey, verify, type KeyObject } from "crypto";
import { getAddress } from "viem";
import { env } from "../env";

export type Network = "testnet" | "mainnet";
export type Chain = "solana" | "hyperliquid";

const BASE: Record<Network, string> = { testnet: "https://api.hyperunit-testnet.xyz", mainnet: "https://api.hyperunit.xyz" };

/** Guardian P-256 public keys (docs.hyperunit.xyz → Key Addresses). Testnet's unit node signs as "node-1". */
const GUARDIANS: Record<Network, Record<string, string>> = {
  mainnet: {
    "unit-node": "04dc6f89f921dc816aa69b687be1fcc3cc1d48912629abc2c9964e807422e1047e0435cb5ba0fa53cb9a57a9c610b4e872a0a2caedda78c4f85ebafcca93524061",
    "hl-node": "048633ea6ab7e40cdacf37d1340057e84bb9810de0687af78d031e9b07b65ad4ab379180ab55075f5c2ebb96dab30d2c2fab49d5635845327b6a3c27d20ba4755b",
    "field-node": "04ae2ab20787f816ea5d13f36c4c4f7e196e29e867086f3ce818abb73077a237f841b33ada5be71b83f4af29f333dedc5411ca4016bd52ab657db2896ef374ce99",
  },
  testnet: {
    "node-1": "04bab844e8620c4a1ec304df6284cd6fdffcde79b3330a7bffb1e4cecfee72d02a7c1f3a4415b253dc8d6ca2146db170e1617605cc8a4160f539890b8a24712152",
    "unit-node": "04bab844e8620c4a1ec304df6284cd6fdffcde79b3330a7bffb1e4cecfee72d02a7c1f3a4415b253dc8d6ca2146db170e1617605cc8a4160f539890b8a24712152",
    "hl-node-testnet": "04502d20a0d8d8aaea9395eb46d50ad2d8278c1b3a3bcdc200d531253612be23f5f2e9709bf3a3a50d1447281fa81aca0bf2ac2a6a3cb8a12978381d73c24bb2d9",
    "field-node": "04e674a796ff01d6b74f4ee4079640729797538cdb4926ec333ce1bd18414ef7f22c1a142fd76dca120614045273f30338cd07d79bc99872c76151756aaec0f8e8",
  },
};
/** Distinct guardian keys that must sign an address. */
export const GUARDIAN_THRESHOLD = 2;

/** Unit's minimum SOL deposit/withdrawal. Its docs list 0.12 and 0.2 in different places; we use the higher one. */
export const UNIT_MIN_LAMPORTS = 200_000_000;

export class UnitError extends Error {}

const keyCache = new Map<string, KeyObject>();
function p256(hex: string): KeyObject {
  let k = keyCache.get(hex);
  if (!k) {
    if (!/^04[0-9a-f]{128}$/i.test(hex)) throw new UnitError("bad guardian key");
    const b64 = (h: string) => Buffer.from(h, "hex").toString("base64url");
    k = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64(hex.slice(2, 66)), y: b64(hex.slice(66)) }, format: "jwk" });
    keyCache.set(hex, k);
  }
  return k;
}

/** SLIP-44 coin type of the chain the generated (protocol) address lives on. Hyperliquid addresses are EVM ones. */
const coinTypeOf = (chain: Chain) => (chain === "hyperliquid" ? "ethereum" : "solana");

/** Unit signs EVM (Hyperliquid) addresses in checksummed form. */
const canon = (a: string) => (/^0x[0-9a-f]{40}$/i.test(a) ? getAddress(a) : a);

export type AddressProposal = { src: Chain; dst: Chain; asset: string; dstAddr: string; address: string; signatures: Record<string, string> };

/**
 * Count distinct guardian keys that signed `<node>:user-<coinType>-<dstChain>-<dstAddr>-<address>` (P-256, SHA-256,
 * raw r||s base64; EVM addresses checksummed). This is the format Unit signs today; it was checked against live testnet responses.
 */
export function verifiedGuardians(p: AddressProposal, network: Network): number {
  const signedBy = new Set<string>();
  for (const [node, sig] of Object.entries(p.signatures ?? {})) {
    const pub = GUARDIANS[network][node];
    if (!pub || typeof sig !== "string") continue;
    const raw = Buffer.from(sig, "base64");
    if (raw.length !== 64) continue;
    const msg = `${node}:${["user", coinTypeOf(p.src), p.dst, canon(p.dstAddr), canon(p.address)].join("-")}`;
    if (verify("sha256", Buffer.from(msg), { key: p256(pub), dsaEncoding: "ieee-p1363" }, raw)) signedBy.add(pub);
  }
  return signedBy.size;
}

export function assertVerified(p: AddressProposal, network: Network) {
  const n = verifiedGuardians(p, network);
  if (n < GUARDIAN_THRESHOLD) throw new UnitError(`Unit address ${p.address} has ${n}/${GUARDIAN_THRESHOLD} valid guardian signatures`);
}

const base = () => BASE[env.hlNetwork];

async function getJson(path: string): Promise<unknown> {
  const r = await fetch(base() + path, { signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  if (!r.ok || !j || j.error) throw new UnitError(`Unit ${path.split("/")[1]}: ${j?.error ?? `HTTP ${r.status}`}`);
  return j;
}

/**
 * Get (and verify) the Unit address for moving `asset` from `src` to `dstAddr` on `dst`.
 *  • solana → hyperliquid: a Solana address; SOL sent there arrives as uSOL on dstAddr's Hyperliquid account
 *  • hyperliquid → solana: a Hyperliquid address; uSOL sent there arrives as SOL at dstAddr on Solana
 * Unit ties each generated address permanently to its destination, so it's safe to store and reuse.
 */
export async function unitAddress(src: Chain, dst: Chain, asset: string, dstAddr: string): Promise<AddressProposal> {
  const j = (await getJson(`/gen/${src}/${dst}/${asset}/${dstAddr}`)) as { address?: string; signatures?: Record<string, string> };
  if (!j.address || !j.signatures) throw new UnitError("Unit returned no address");
  const p: AddressProposal = { src, dst, asset, dstAddr, address: j.address, signatures: j.signatures };
  assertVerified(p, env.hlNetwork);
  return p;
}

export type UnitOperation = {
  operationId: string;
  protocolAddress: string;
  sourceAddress: string;
  destinationAddress: string;
  sourceChain: string;
  destinationChain: string;
  /** smallest units of the asset (lamports for SOL) */
  sourceAmount: string;
  destinationFeeAmount: string;
  sweepFeeAmount: string;
  sourceTxHash: string;
  destinationTxHash?: string;
  asset: string;
  state: string;
  opCreatedAt: string;
};

export const UNIT_DONE = "done";
export const UNIT_FAILED = "failure";

/** All Unit operations touching `address` (a Hyperliquid or Solana address), newest first. */
export async function unitOperations(address: string): Promise<UnitOperation[]> {
  const j = (await getJson(`/operations/${address}`)) as { operations?: UnitOperation[] };
  return j.operations ?? [];
}
