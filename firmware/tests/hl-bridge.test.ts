// Hyperliquid Phase 2: Unit address verification (real testnet responses), bridge decisions, price/size rounding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";
import "./_hl-env";
import { verifiedGuardians, assertVerified, UnitError, UNIT_MIN_LAMPORTS, type AddressProposal, type UnitOperation } from "../src/lib/hl/unit";
import { sweepAmount, refillAmount, networksMatch, matchOperation, nextState, STUCK_AFTER_MS } from "../src/lib/hl/bridge-plan";
import { formatSpotPrice, roundSize, limitPrice } from "../src/lib/hl/spot";
import { checkConvert, HlRefusal } from "../src/lib/hl/policy";

type Fx = { src: "solana" | "hyperliquid"; dst: "solana" | "hyperliquid"; asset: string; dstAddr: string; response: { address: string; signatures: Record<string, string> } };
const fx = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/unit-testnet-gen.json"), "utf8")) as { deposit: Fx; withdraw: Fx };
const proposal = (f: Fx): AddressProposal => ({ src: f.src, dst: f.dst, asset: f.asset, dstAddr: f.dstAddr, address: f.response.address, signatures: f.response.signatures });
const T = { floatSol: 0.3, sweepMinSol: 0.5, refillBelowSol: 0.1 };
const SOL = 1_000_000_000;

test("unit: real testnet deposit and withdraw addresses verify with all 3 guardians", () => {
  assert.equal(verifiedGuardians(proposal(fx.deposit), "testnet"), 3);
  assert.equal(verifiedGuardians(proposal(fx.withdraw), "testnet"), 3);
  assertVerified(proposal(fx.deposit), "testnet");
});

test("unit: a swapped address, destination or network fails verification", () => {
  const p = proposal(fx.deposit);
  assert.throws(() => assertVerified({ ...p, address: proposal(fx.withdraw).address }, "testnet"), UnitError);
  assert.throws(() => assertVerified({ ...p, dstAddr: "0x" + "1".repeat(40) }, "testnet"), UnitError);
  assert.throws(() => assertVerified(p, "mainnet"), UnitError);
  assert.throws(() => assertVerified({ ...p, src: "hyperliquid", dst: "solana" }, "testnet"), UnitError);
});

test("unit: one guardian isn't enough, and one key under two names counts once", () => {
  const p = proposal(fx.deposit);
  const only = { "field-node": p.signatures["field-node"] };
  assert.throws(() => assertVerified({ ...p, signatures: only }, "testnet"), /1\/2/);
  // node-1 and unit-node are the same testnet key: re-labelling its signature must not count twice
  const dup = { "node-1": p.signatures["node-1"], "unit-node": p.signatures["node-1"] };
  assert.equal(verifiedGuardians({ ...p, signatures: dup }, "testnet"), 1);
});

test("bridge: sweep only what's above the float and worth a Unit deposit", () => {
  assert.equal(sweepAmount(0.5 * SOL, T), 0);
  assert.equal(sweepAmount(0.79 * SOL, T), 0); // 0.49 spare < 0.5 min
  assert.equal(sweepAmount(2 * SOL, T), 2 * SOL - 0.3 * SOL - 10_000);
  assert.ok(sweepAmount(10 * SOL, { ...T, sweepMinSol: 0.01 }) >= UNIT_MIN_LAMPORTS);
  assert.equal(sweepAmount(0.45 * SOL, { ...T, sweepMinSol: 0.01 }), 0); // still under Unit's minimum
});

test("bridge: refill restores the float, covers a spend, and never goes below Unit's minimum", () => {
  assert.equal(refillAmount(0.2 * SOL, 0, T), 0); // above the refill line
  assert.equal(refillAmount(0.05 * SOL, 0, T), 0.25 * SOL); // back up to the 0.3 float
  assert.equal(refillAmount(0.25 * SOL, 1 * SOL, T), 1.05 * SOL);
  assert.equal(refillAmount(2 * SOL, 1 * SOL, T), 0); // already enough
  assert.equal(refillAmount(1.25 * SOL, 1 * SOL, T), UNIT_MIN_LAMPORTS); // short by 0.05 → minimum 0.2
});

test("bridge: refuses to run across mismatched networks", () => {
  assert.ok(networksMatch("testnet", "devnet"));
  assert.ok(networksMatch("mainnet", "mainnet-beta"));
  assert.ok(!networksMatch("testnet", "mainnet-beta"));
  assert.ok(!networksMatch("mainnet", "devnet"));
});

const op = (o: Partial<UnitOperation>): UnitOperation => ({
  operationId: "x", protocolAddress: "P", sourceAddress: "s", destinationAddress: "d", sourceChain: "solana", destinationChain: "hyperliquid",
  sourceAmount: "0", destinationFeeAmount: "0", sweepFeeAmount: "0", sourceTxHash: "", asset: "sol", state: "done", opCreatedAt: new Date().toISOString(), ...o,
});

test("bridge: matches deposits by signature and withdrawals by address, time and amount", () => {
  const t0 = new Date();
  const dep = { direction: "to-hl", lamports: SOL, protocolAddress: "P", sourceRef: "SIG1", createdAt: t0 };
  assert.equal(matchOperation([op({ sourceTxHash: "SIG2:abc" }), op({ sourceTxHash: "SIG1:abc", operationId: "hit" })], dep)?.operationId, "hit");
  assert.equal(matchOperation([op({ sourceTxHash: "SIG1:abc", protocolAddress: "OTHER" })], dep), null);
  const wd = { direction: "to-sol", lamports: SOL, protocolAddress: "0xAbC", sourceRef: "hl:spot-send:1", createdAt: t0 };
  const old = new Date(t0.getTime() - 10 * 60_000).toISOString();
  assert.equal(matchOperation([
    op({ protocolAddress: "0xabc", sourceAmount: String(SOL), opCreatedAt: old, operationId: "old" }),
    op({ protocolAddress: "0xabc", sourceAmount: String(2 * SOL), operationId: "wrong-amount" }),
    op({ protocolAddress: "0xabc", sourceAmount: String(SOL), operationId: "hit" }),
  ], wd)?.operationId, "hit");
});

test("bridge: state transitions", () => {
  const b = { direction: "to-hl", lamports: SOL, protocolAddress: "P", sourceRef: "S", createdAt: new Date() };
  assert.equal(nextState(b, null), "wait");
  assert.equal(nextState(b, op({ state: "waitForSrcTxFinalization" })), "wait");
  assert.equal(nextState(b, op({ state: "done" })), "arrived");
  assert.equal(nextState({ ...b, direction: "to-sol" }, op({ state: "done" })), "done");
  assert.equal(nextState(b, op({ state: "failure" })), "failed");
  assert.equal(nextState({ ...b, createdAt: new Date(Date.now() - STUCK_AFTER_MS - 1) }, null), "stuck");
});

test("spot: sizes round down, prices respect 5 significant figures and spot decimals", () => {
  assert.equal(roundSize(1.23456, 3), "1.234");
  assert.equal(roundSize(0.0009, 3), "0");
  assert.equal(roundSize(2, 3), "2");
  assert.equal(roundSize(10, 0), "10");
  assert.equal(roundSize(100.56, 1), "100.5");
  assert.equal(formatSpotPrice(12000, 0, "down"), "12000");
  assert.equal(formatSpotPrice(97.123456, 3, "down"), "97.123");
  assert.equal(formatSpotPrice(97.123456, 3, "up"), "97.124");
  assert.equal(formatSpotPrice(103.009, 3, "up"), "103.01");
  assert.equal(formatSpotPrice(123456.7, 3, "down"), "123456");
  assert.equal(formatSpotPrice(0.000123456, 2, "down"), "0.000123"); // capped at 8 − 2 decimals
});

test("spot: conversion limits move against us by the slippage", () => {
  assert.equal(limitPrice("sell", 100, 300), 97);
  assert.equal(limitPrice("buy", 100, 300), 103);
});

test("policy: conversions are uSOL only, with positive decimal size and price", () => {
  checkConvert({ coin: "USOL", side: "sell", size: "1.5", limitPx: "97.1" });
  assert.throws(() => checkConvert({ coin: "BTC" as "USOL", side: "sell", size: "1", limitPx: "1" }), HlRefusal);
  assert.throws(() => checkConvert({ coin: "USOL", side: "sell", size: "0", limitPx: "1" }), HlRefusal);
  assert.throws(() => checkConvert({ coin: "USOL", side: "sell", size: "1", limitPx: "-1" }), HlRefusal);
  assert.throws(() => checkConvert({ coin: "USOL", side: "short" as "sell", size: "1", limitPx: "1" }), HlRefusal);
});
