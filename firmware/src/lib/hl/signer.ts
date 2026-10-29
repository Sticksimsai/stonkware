// The Hyperliquid signer. With src/lib/signer.ts (Solana), this is the ONLY place that decrypts keys.
// Every master-key action passes checkHlIntent first. Orders will be signed with the API wallet only (Phase 3).
import { randomBytes } from "crypto";
import { ExchangeClient } from "@nktkas/hyperliquid";
import { bytesToHex, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { env, isLive } from "../env";
import { open, seal } from "../vault";
import { transport } from "./client";
import { checkHlIntent, HlRefusal, usdString, type HlIntent } from "./policy";

/** A fresh EVM key; only the address and the sealed secret leave this function. */
export function newSealedEvmKey(): { address: string; sealed: string } {
  const pk = generatePrivateKey();
  return { address: privateKeyToAccount(pk).address, sealed: seal(hexToBytes(pk)) };
}

function unseal(sealed: string, expected: string): PrivateKeyAccount {
  const account = privateKeyToAccount(bytesToHex(open(sealed)));
  if (account.address.toLowerCase() !== expected.toLowerCase()) throw new HlRefusal("sealed key does not match its address");
  return account;
}

export type HlAccount = {
  hlAddress: string | null;
  hlSecretEnc: string | null;
  hlAgentAddress: string | null;
};

const mockId = () => `mockhl_${randomBytes(12).toString("hex")}`;

/**
 * Sign and send one master-key action. Returns a reference for the ledger (Hyperliquid doesn't return a tx hash
 * for these actions, so it's "hl:<kind>:<nonce-ish time>"; mock mode returns a mock id).
 */
export async function hlExecute(c: HlAccount, intent: HlIntent): Promise<string> {
  if (!c.hlAddress || !c.hlSecretEnc) throw new HlRefusal("company has no Hyperliquid account");
  checkHlIntent(intent, { self: c.hlAddress, agent: c.hlAgentAddress, maxTransferUsd: env.hlMaxTransferUsd });
  if (!isLive()) return mockId();

  const exchange = new ExchangeClient({ transport: transport(), wallet: unseal(c.hlSecretEnc, c.hlAddress) });
  const to = (a: string) => a as `0x${string}`;
  switch (intent.kind) {
    case "approve-agent":
      await exchange.approveAgent({ agentAddress: to(intent.agent), agentName: intent.name });
      break;
    case "usd-send":
      await exchange.usdSend({ destination: to(intent.to), amount: usdString(intent.usd) });
      break;
    case "spot-send":
      await exchange.spotSend({ destination: to(intent.to), token: intent.token, amount: intent.amount });
      break;
    case "class-transfer":
      await exchange.usdClassTransfer({ amount: usdString(intent.usd), toPerp: intent.toPerp });
      break;
    case "withdraw":
      await exchange.withdraw3({ destination: to(intent.to), amount: usdString(intent.usd) });
      break;
  }
  return `hl:${intent.kind}:${Date.now()}`;
}
