// Hyperliquid Phase 1: signing rules, key sealing, and that secrets never reach public output.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_hl-env";
import { checkHlIntent, HlRefusal, AGENT_NAME, usdString, isSystemAddress } from "../src/lib/hl/policy";
import { newSealedEvmKey, hlExecute } from "../src/lib/hl/signer";
import { publicCompany } from "../src/lib/http";

const self = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222223";
const other = "0x3333333333333333333333333333333333333334";
const ctx = { self, agent, maxTransferUsd: Infinity };

test("hl policy: only the company's own API wallet can be approved, under the fixed name", () => {
  checkHlIntent({ kind: "approve-agent", agent, name: AGENT_NAME }, ctx);
  checkHlIntent({ kind: "approve-agent", agent: agent.toUpperCase().replace("0X", "0x"), name: AGENT_NAME }, ctx);
  assert.throws(() => checkHlIntent({ kind: "approve-agent", agent: other, name: AGENT_NAME }, ctx), HlRefusal);
  assert.throws(() => checkHlIntent({ kind: "approve-agent", agent, name: "evil" }, ctx), HlRefusal);
  assert.throws(() => checkHlIntent({ kind: "approve-agent", agent, name: AGENT_NAME }, { ...ctx, agent: null }), HlRefusal);
});

test("hl policy: transfers need a valid outside address and a positive amount", () => {
  checkHlIntent({ kind: "usd-send", to: other, usd: 12.5 }, ctx);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: self, usd: 1 }, ctx), /own account/);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: agent, usd: 1 }, ctx), /API wallet/);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: "0x123", usd: 1 }, ctx), /valid address/);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: other, usd: 0 }, ctx), HlRefusal);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: other, usd: Number.NaN }, ctx), HlRefusal);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: other, usd: -5 }, ctx), HlRefusal);
});

test("hl policy: per-transfer cap applies to sends and withdrawals", () => {
  const capped = { ...ctx, maxTransferUsd: 100 };
  checkHlIntent({ kind: "usd-send", to: other, usd: 100 }, capped);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: other, usd: 100.01 }, capped), /cap/);
  assert.throws(() => checkHlIntent({ kind: "withdraw", to: other, usd: 150 }, capped), /cap/);
  assert.throws(() => checkHlIntent({ kind: "withdraw", to: other, usd: 1 }, ctx), /\$1 fee/);
});

test("hl policy: system addresses only for spot-send (HyperCore → HyperEVM)", () => {
  const usdcSystem = "0x2000000000000000000000000000000000000000";
  const hypeSystem = "0x2222222222222222222222222222222222222222";
  assert.ok(isSystemAddress(usdcSystem) && isSystemAddress(hypeSystem) && !isSystemAddress(other));
  checkHlIntent({ kind: "spot-send", to: hypeSystem, token: "HYPE:0x0d01dc56dcaaca66ad901c959b4011ec", amount: "1.5" }, ctx);
  assert.throws(() => checkHlIntent({ kind: "usd-send", to: usdcSystem, usd: 1 }, ctx), /system/);
  assert.throws(() => checkHlIntent({ kind: "spot-send", to: other, token: "HYPE", amount: "1" }, ctx), /token/);
  assert.throws(() => checkHlIntent({ kind: "spot-send", to: other, token: "HYPE:0x0d01dc56dcaaca66ad901c959b4011ec", amount: "1e3" }, ctx), /amount/);
});

test("hl policy: USD amounts are sent with at most 6 decimals", () => {
  assert.equal(usdString(12.5), "12.5");
  assert.equal(usdString(1), "1");
  assert.equal(usdString(0.1234567), "0.123457");
  assert.throws(() => usdString(0.0000001), /precision/);
});

test("hl signer: sealed EVM keys don't contain the private key and refuse without an account", async () => {
  const k = newSealedEvmKey();
  assert.match(k.address, /^0x[0-9a-fA-F]{40}$/);
  assert.match(k.sealed, /^v1\./);
  await assert.rejects(hlExecute({ hlAddress: null, hlSecretEnc: null, hlAgentAddress: null }, { kind: "class-transfer", usd: 1, toPerp: true }), HlRefusal);
});

test("hl signer: runs the policy before signing, mock mode returns a mock id", async () => {
  const master = newSealedEvmKey(), api = newSealedEvmKey();
  const acct = { hlAddress: master.address, hlSecretEnc: master.sealed, hlAgentAddress: api.address };
  assert.match(await hlExecute(acct, { kind: "approve-agent", agent: api.address, name: AGENT_NAME }), /^mockhl_/);
  await assert.rejects(hlExecute(acct, { kind: "approve-agent", agent: other, name: AGENT_NAME }), HlRefusal);
});

test("publicCompany never exposes Solana or Hyperliquid secrets", () => {
  const out = publicCompany({ id: "x", hlAddress: self, treasurySecretEnc: "s", mintSecretEnc: "m", hlSecretEnc: "h", hlAgentSecretEnc: "a", image: Buffer.alloc(1) });
  assert.deepEqual(Object.keys(out).sort(), ["hlAddress", "id"]);
});

test("hl signing works offline with the installed viem (Hyperliquid's EIP-712 type names contain ':')", async () => {
  // viem 2.57.12+ rejects struct names like "HyperliquidTransaction:ApproveAgent"; this fails if viem is bumped past it.
  const { signUserSignedAction } = await import("@nktkas/hyperliquid/signing");
  const { ApproveAgentTypes } = await import("@nktkas/hyperliquid/api/exchange");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const wallet = privateKeyToAccount(generatePrivateKey());
  const action = { type: "approveAgent", signatureChainId: "0x66eee" as const, hyperliquidChain: "Testnet", agentAddress: agent as `0x${string}`, agentName: AGENT_NAME, nonce: Date.now() };
  const sig = await signUserSignedAction({ wallet, action, types: ApproveAgentTypes });
  assert.match(sig.r, /^0x[0-9a-f]{64}$/i);
  assert.ok(sig.v === 27 || sig.v === 28);
});
