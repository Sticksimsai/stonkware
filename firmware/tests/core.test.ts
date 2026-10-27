// Run: npm test   (node:test via tsx — no extra deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, TransactionInstruction, PublicKey } from "@solana/web3.js";
import { inspect, PROGRAMS, SignerRefusal } from "../src/lib/signer";
import { platformCut, launchDeposit, FEES } from "../src/lib/fees";
import { checkSpend } from "../src/lib/policy";
import { assertPublicUrl } from "../src/lib/agent/browser";
import { normPath } from "../src/lib/agent/tools";

const treasury = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey;
const xfer = (to: PublicKey, lamports: number, from = treasury) => SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });

test("signer: rejects non-treasury fee payer", () => {
  assert.throws(() => inspect(stranger, [], treasury, { kind: "burn" }), SignerRefusal);
});

test("signer: rejects programs outside allow-list", () => {
  const evil = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) });
  assert.throws(() => inspect(treasury, [evil], treasury, { kind: "trade", maxTopLevelSolOut: 1e9 }), /not allow-listed/);
});

test("signer: transfer intent must match exactly", () => {
  inspect(treasury, [xfer(stranger, 5)], treasury, { kind: "transfer", to: stranger.toBase58(), lamports: 5 });
  assert.throws(() => inspect(treasury, [xfer(stranger, 6)], treasury, { kind: "transfer", to: stranger.toBase58(), lamports: 5 }));
  assert.throws(() => inspect(treasury, [xfer(stranger, 5), xfer(stranger, 5)], treasury, { kind: "transfer", to: stranger.toBase58(), lamports: 5 }));
});

test("signer: caps top-level SOL out for trades, incl. account creation", () => {
  inspect(treasury, [xfer(stranger, 1000)], treasury, { kind: "trade", maxTopLevelSolOut: 1000 });
  assert.throws(() => inspect(treasury, [xfer(stranger, 1001)], treasury, { kind: "trade", maxTopLevelSolOut: 1000 }), /exceeds intent cap/);
  const create = SystemProgram.createAccount({ fromPubkey: treasury, newAccountPubkey: stranger, lamports: 5000, space: 0, programId: new PublicKey(PROGRAMS.system) });
  assert.throws(() => inspect(treasury, [create], treasury, { kind: "trade", maxTopLevelSolOut: 1000 }), /exceeds intent cap/);
});

test("signer: burn intent cannot move SOL", () => {
  assert.throws(() => inspect(treasury, [xfer(stranger, 1)], treasury, { kind: "burn" }), /must not move SOL/);
});

test("fees: platform cut and deposit math", () => {
  assert.deepEqual(platformCut(100_000_000, "fees"), { platform: 0, company: 100_000_000 }); // Firmware is paid as DBC partner instead
  assert.deepEqual(platformCut(1_000_000_001, "revenue"), { platform: 50_000_000, company: 950_000_001 });
  assert.equal(launchDeposit(100_000_000, 50_000_000), FEES.launchCostLamports + 150_000_000);
});

test("spend: agent can spend everything above the rent floor, nothing more", () => {
  const base = { status: "LIVE", balance: 1_000_000_000, spentLast24h: 0 };
  assert.ok(checkSpend({ ...base, amount: 990_000_000 }).ok);
  assert.ok(!checkSpend({ ...base, amount: 990_000_001 }).ok);
  assert.ok(!checkSpend({ ...base, amount: 0 }).ok);
  assert.ok(!checkSpend({ ...base, status: "PAUSED", amount: 1 }).ok);
});

test("browser: SSRF guard blocks private and non-http targets", async () => {
  for (const u of ["http://127.0.0.1/", "http://localhost:3000/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://[::1]/", "file:///etc/passwd", "ftp://example.com"]) {
    await assert.rejects(assertPublicUrl(u), u);
  }
  await assertPublicUrl("https://93.184.215.14/");
});

test("site: file paths are validated", () => {
  assert.equal(normPath("/index.html").path, "index.html");
  assert.equal(normPath("blog/post-1.html").mime, "text/html; charset=utf-8");
  for (const bad of ["../x.html", "a//b.html", "x.php", "", ".env"]) assert.throws(() => normPath(bad), bad);
});

test("signer: Meteora DBC, DAMM v2 and Jupiter are allow-listed; random programs aren't", () => {
  for (const pid of [PROGRAMS.meteoraDbc, PROGRAMS.meteoraDammV2, PROGRAMS.jupiter]) {
    const ix = new TransactionInstruction({ programId: new PublicKey(pid), keys: [], data: Buffer.alloc(0) });
    inspect(treasury, [ix], treasury, { kind: "trade", maxTopLevelSolOut: 0 });
  }
  // wrapping the buy amount to wSOL is a top-level transfer and must fit the trade cap
  assert.throws(() => inspect(treasury, [xfer(stranger, 2_000)], treasury, { kind: "trade", maxTopLevelSolOut: 1_000 }));
});

test("meteora: launch config is valid and splits fees as advertised", async () => {
  const { buildFirmwareConfig, feeSplitBps } = await import("../src/lib/meteora");
  const { validateConfigParameters } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  validateConfigParameters({ ...buildFirmwareConfig(), leftoverReceiver: Keypair.generate().publicKey } as never);
  const s = feeSplitBps();
  assert.equal(s.meteora + s.company + s.firmware, s.total);
  assert.equal(s.company, 120); // 1.2% of volume to the company at defaults
});
