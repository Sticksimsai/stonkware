import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "./env";

// AES-256-GCM envelope for secret keys at rest. In production put VAULT_KEY in a KMS/secret manager
// and run the signer on a separate box; this module is the single seam to swap.

function key(): Buffer {
  const hex = env.vaultKey;
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("VAULT_KEY must be 32 bytes hex (run `npm run keygen`).");
  }
  return Buffer.from(hex, "hex");
}

export function seal(plain: Uint8Array): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function open(sealed: string): Uint8Array {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1") throw new Error("Unknown vault format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]));
}
