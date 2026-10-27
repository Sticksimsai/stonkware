// Token metadata. Uses Pinata (IPFS) when PINATA_JWT is set; otherwise Stonkware hosts the
// Metaplex JSON itself at /api/meta/<companyId> (keep your domain stable — wallets cache this URI).
import { env, isLive } from "./env";

export type MetaInput = {
  companyId: string; image: Buffer; mime: string; name: string; symbol: string; description: string;
  twitter?: string | null; website?: string | null;
};

export async function uploadMetadata(m: MetaInput): Promise<string> {
  if (!isLive() || !env.pinataJwt) return `${env.siteUrl}/api/meta/${m.companyId}`;
  return viaPinata(m);
}

async function pin(body: Blob, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append("network", "public");
  fd.append("file", body, filename);
  const r = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${env.pinataJwt}` }, body: fd });
  if (!r.ok) throw new Error(`pinata ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { data: { cid: string } };
  return `https://ipfs.io/ipfs/${j.data.cid}`;
}

async function viaPinata(m: MetaInput): Promise<string> {
  const image = m.image.length ? await pin(new Blob([new Uint8Array(m.image)], { type: m.mime }), "image") : `${env.siteUrl}/api/image/${m.companyId}`;
  const meta = { name: m.name, symbol: m.symbol, description: m.description, image, twitter: m.twitter || undefined, website: m.website || undefined, createdOn: env.siteUrl };
  return pin(new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
}
