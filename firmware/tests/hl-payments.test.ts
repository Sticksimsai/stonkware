// Hyperliquid Phase 4: verifying customer payments (HyperEVM depositFor and Hyperliquid transfers), quotes, platform cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import "./_hl-env";
import { checkEvmDeposit, findCoreTransfer, ceilDecimal, depositAbi, HYPEREVM, methodsFor, SPOT_DEX, type LedgerTransfer } from "../src/lib/hl/payments";
import { splitCut } from "../src/lib/hl/revenue";

const buyer = "0x1111111111111111111111111111111111111111";
const company = "0x2222222222222222222222222222222222222223";
const other = "0x3333333333333333333333333333333333333334";
const CDW = HYPEREVM.testnet.coreDepositWallet;
const depositFor = (to: string, units: bigint) => encodeFunctionData({ abi: depositAbi, functionName: "depositFor", args: [to as `0x${string}`, units, SPOT_DEX] });
const evmOk = { status: "success", from: buyer, to: CDW, input: depositFor(company, 25_000_000n), buyer, recipient: company, minUnits: 25_000_000n };

test("hl-evm: a depositFor from the buyer, for the company, of enough USDC passes", () => {
  assert.equal(checkEvmDeposit(evmOk), 25_000_000n);
  assert.equal(checkEvmDeposit({ ...evmOk, to: CDW.toLowerCase(), from: buyer.toUpperCase().replace("0X", "0x") }), 25_000_000n);
  assert.equal(checkEvmDeposit({ ...evmOk, input: depositFor(company, 30_000_000n) }), 30_000_000n); // overpay is fine
});

test("hl-evm: wrong contract, sender, recipient, amount, call or failed tx are refused", () => {
  assert.throws(() => checkEvmDeposit({ ...evmOk, status: "reverted" }), /failed/);
  assert.throws(() => checkEvmDeposit({ ...evmOk, to: HYPEREVM.testnet.usdc }), /isn't a USDC deposit/); // plain USDC transfer
  assert.throws(() => checkEvmDeposit({ ...evmOk, to: null }), /isn't a USDC deposit/);
  assert.throws(() => checkEvmDeposit({ ...evmOk, from: other }), /different wallet/);
  assert.throws(() => checkEvmDeposit({ ...evmOk, input: depositFor(other, 25_000_000n) }), /different Hyperliquid account/);
  assert.throws(() => checkEvmDeposit({ ...evmOk, input: depositFor(company, 24_999_999n) }), /too low/);
  const own = encodeFunctionData({ abi: depositAbi, functionName: "deposit", args: [25_000_000n, SPOT_DEX] });
  assert.throws(() => checkEvmDeposit({ ...evmOk, input: own }), /depositFor/);
  assert.throws(() => checkEvmDeposit({ ...evmOk, input: "0xdeadbeef" }), /unrecognised/);
});

const T0 = 1_800_000_000_000;
const tx = (o: Partial<LedgerTransfer["delta"]> & { time?: number; hash?: string }): LedgerTransfer => ({
  time: o.time ?? T0 + 1000, hash: o.hash ?? "0xaa",
  delta: { type: "spotTransfer", user: buyer, destination: company, token: "USDC", amount: "25", ...o },
});
const find = (ups: LedgerTransfer[], p: Partial<Parameters<typeof findCoreTransfer>[1]> = {}) =>
  findCoreTransfer(ups, { buyer, recipient: company, asset: "USDC", min: 25, since: T0, used: new Set(), ...p });

test("hl-core: finds the buyer's transfer of the right token and amount", () => {
  assert.equal(find([tx({})])?.hash, "0xaa");
  assert.equal(find([tx({ token: "USDC:0xeb62eee3685fc4c43992febcd9e75443" })])?.hash, "0xaa"); // NAME:tokenId form
  assert.equal(find([tx({ token: "HYPE", amount: "0.5" })], { asset: "HYPE", min: 0.5 })?.hash, "0xaa");
  assert.equal(find([tx({ type: "internalTransfer", token: undefined, amount: undefined, usdc: "25" })])?.hash, "0xaa"); // from perps
  assert.equal(find([tx({ type: "send" })])?.hash, "0xaa");
});

test("hl-core: ignores other senders, tokens, short amounts, old or reused transfers", () => {
  assert.equal(find([tx({ user: other })]), null);
  assert.equal(find([tx({ destination: other })]), null);
  assert.equal(find([tx({ token: "PURR" })]), null);
  assert.equal(find([tx({ amount: "24.99" })]), null);
  assert.equal(find([tx({ time: T0 - 1 })]), null);
  assert.equal(find([tx({ hash: "0xAA" })], { used: new Set(["0xaa"]) }), null);
  assert.equal(find([tx({ type: "deposit" })]), null);
});

test("hl-core: prefers the given hash, otherwise the earliest match", () => {
  const ups = [tx({ hash: "0xbb", time: T0 + 5000 }), tx({ hash: "0xaa", time: T0 + 2000 })];
  assert.equal(find(ups)?.hash, "0xaa");
  assert.equal(find(ups, { hash: "0xBB" })?.hash, "0xbb");
  assert.equal(find(ups, { hash: "0xcc" }), null);
});

test("quotes round up so the buyer never pays less than the price", () => {
  assert.equal(ceilDecimal(25, 6), "25");
  assert.equal(ceilDecimal(10.0000001, 6), "10.000001");
  assert.equal(ceilDecimal(0.123401, 4), "0.1235");
  assert.equal(ceilDecimal(1 / 3, 4), "0.3334");
});

test("platform cut: 5%, flagship share carved out of it, dust stays with the company", () => {
  const a = splitCut(100, 100, 50, true, true);
  assert.equal(a.toFlagship + a.toPlatform, 5);
  assert.equal(a.toFlagship, 2.5);
  assert.equal(a.kept, 95);
  const noWallet = splitCut(100, 100, 50, true, false);
  assert.equal(noWallet.toPlatform, 0); // without a platform wallet that part stays with the company
  assert.equal(noWallet.kept, 97.5);
  assert.deepEqual(splitCut(1, 1, 50, true, true), { toFlagship: 0, toPlatform: 0, kept: 1 }); // $0.05 cut → dust
  const hype = splitCut(2, 100, 50, false, true); // 2 HYPE worth $100
  assert.equal(hype.toPlatform, 0.1);
});

test("payment methods: SOL only unless Hyperliquid payments are on", () => {
  assert.deepEqual(methodsFor({ hlAddress: company }), [{ method: "sol", asset: "SOL" }]); // HL_PAYMENTS unset in tests
});
