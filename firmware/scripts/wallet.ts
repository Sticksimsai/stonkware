// Small wallet helper for setting up Stonkware's own wallets (no Solana CLI needed).
//   npm run wallet -- new partner.json        create a keypair file (never overwrites)
//   npm run wallet -- address partner.json    print its address
//   npm run wallet -- balance <file|address>  print its SOL balance on SOLANA_RPC_URL
//   npm run wallet -- airdrop partner.json 2  request devnet SOL (often rate-limited: use faucet.solana.com)
import "./_env";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const [cmd, target, amount] = process.argv.slice(2);
const rpc = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, "utf8"))));
const pubkey = (t: string) => (existsSync(t) ? load(t).publicKey : new PublicKey(t));

(async () => {
  if (!cmd || !target) throw new Error("usage: npm run wallet -- <new|address|balance|airdrop> <file|address> [sol]");
  if (cmd === "new") {
    if (existsSync(target)) throw new Error(`${target} already exists, refusing to overwrite it`);
    const kp = Keypair.generate();
    writeFileSync(target, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
    console.log(kp.publicKey.toBase58());
  } else if (cmd === "address") {
    console.log(pubkey(target).toBase58());
  } else if (cmd === "balance") {
    const lamports = await new Connection(rpc, "confirmed").getBalance(pubkey(target));
    console.log((lamports / LAMPORTS_PER_SOL).toFixed(4));
  } else if (cmd === "airdrop") {
    if (!rpc.includes("devnet")) throw new Error("airdrop only works on devnet");
    const conn = new Connection(rpc, "confirmed");
    const sig = await conn.requestAirdrop(pubkey(target), Math.round(Number(amount || 2) * LAMPORTS_PER_SOL));
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`airdropped ${amount || 2} SOL  ${sig}`);
  } else throw new Error(`unknown command ${cmd}`);
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
