// Worker thread for `npm run vanity -- grind`: finds ed25519 keys whose base58 address ends with workerData.suffix.
// Plain JS with only Node built-ins so it runs in a worker without a TypeScript loader.
import { generateKeyPairSync } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// the last k base58 characters are (address as a big number) mod 58^k, so no full encoding is needed
let mod = 1n, target = 0n;
for (const ch of workerData.suffix) { target = target * 58n + BigInt(ALPHABET.indexOf(ch)); mod *= 58n; }
const M = Number(mod), T = Number(target);
let tries = 0;
for (;;) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  let r = 0;
  for (const byte of pub) r = (r * 256 + byte) % M; // r*256+byte < 2^53 for M ≤ 58^5
  tries++;
  if (r === T) {
    const seed = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");
    parentPort.postMessage({ secret: Array.from(Buffer.concat([seed, pub])), tries });
    tries = 0;
  } else if (tries % 200000 === 0) parentPort.postMessage({ tries: 200000 });
}
