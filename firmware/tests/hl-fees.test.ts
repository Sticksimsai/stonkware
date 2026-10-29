// Hyperliquid Phase 5: FeeSplitter plumbing (amount rounding, refs, platform key rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_hl-env";
import { evmUnits, unitsToAmount, refFor, splitterEnabled } from "../src/lib/hl/fee-splitter";
import { isEvmUsdcAmount, sealPlatformKey, USDC_SYSTEM_ADDRESS } from "../src/lib/hl/signer";
import { isSystemAddress, HlRefusal } from "../src/lib/hl/policy";

test("fees: USDC amounts round down to 6 decimals (HyperEVM) so nothing is burned on the way", () => {
  assert.equal(evmUnits(123.4567899), 123_456_789n);
  assert.equal(evmUnits(0.0000009), 0n);
  assert.equal(evmUnits(100), 100_000_000n);
  assert.equal(unitsToAmount(123_456_789n), "123.456789");
  assert.equal(unitsToAmount(100_000_000n), "100");
  assert.equal(unitsToAmount(1n), "0.000001");
  assert.ok(isEvmUsdcAmount("100.123456"));
  assert.ok(!isEvmUsdcAmount("100.1234567"));
  assert.ok(!isEvmUsdcAmount("0"));
  assert.ok(!isEvmUsdcAmount("1e3"));
});

test("fees: distribute refs are stable bytes32 per distribution", () => {
  assert.match(refFor("abc"), /^0x[0-9a-f]{64}$/);
  assert.equal(refFor("abc"), refFor("abc"));
  assert.notEqual(refFor("abc"), refFor("abd"));
});

test("fees: the USDC system address is HyperCore → HyperEVM for token 0", () => {
  assert.ok(isSystemAddress(USDC_SYSTEM_ADDRESS));
  assert.equal(USDC_SYSTEM_ADDRESS, "0x2000000000000000000000000000000000000000");
});

test("fees: platform key sealing checks the key format", () => {
  assert.throws(() => sealPlatformKey("0x1234"), HlRefusal);
  const r = sealPlatformKey("0x" + "11".repeat(32));
  assert.match(r.address, /^0x[0-9a-fA-F]{40}$/);
  assert.match(r.sealed, /^v1\./);
});

test("fees: the splitter is off unless the contract, wallet and key are all configured", () => {
  assert.equal(splitterEnabled(), false);
});
