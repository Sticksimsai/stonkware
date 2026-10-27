"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { lamports } from "@/lib/units";
import { getJSON, postForm, postJSON } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { MOCK_WALLET, sendSol } from "@/lib/tx";
import PixelIcon, { type IconName } from "@/components/PixelIcon";
import type { Pair } from "@/lib/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";

function H({ n, icon, children }: { n: string; icon: IconName; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2.5 font-pixel text-[13px] uppercase text-cream">
      <PixelIcon name={icon} size={18} />
      <span className="text-mute">{n}</span>
      <span className="glow">{children}</span>
    </h2>
  );
}

type Model = { id: string; label: string; provider: string; inUsdPerM: number; outUsdPerM: number; context: number };
const PROVIDER_ORDER = ["anthropic", "openai", "google", "x-ai", "deepseek", "qwen", "moonshotai", "mistralai", "meta-llama", "meta"];

const EXAMPLES = [
  "Become a web design agency for small local businesses. Find clients, build them landing pages, and grow a portfolio.",
  "Build and sell tiny SaaS tools for crypto traders. Research what people complain about and ship fixes.",
  "Run a research desk that publishes sharp weekly reports on AI startups and sells custom deep-dives.",
];

export default function LaunchForm() {
  const cfg = useConfig();
  const mock = cfg?.mode !== "live";
  const split = cfg?.fees.tradeFeeSplitBps ?? { total: 0, company: 0, firmware: 0, meteora: 0 };
  const stonk = cfg?.venue === "stonkfun";
  const sharePct = (cfg?.creatorFeeShareBps ?? 0) / 100;
  const launchCost = cfg?.launch.launchCostLamports ?? 40_000_000;
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();
  const router = useRouter();

  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("anthropic");
  const [q, setQ] = useState("");
  const [f, setF] = useState({ name: "", ticker: "", aim: "", model: "", devBuySol: 0.1, fuelSol: 0.05, twitter: "" });
  // "Launch one like this" links pass an example aim
  useEffect(() => {
    const aim = new URLSearchParams(window.location.search).get("aim");
    if (aim) setF((x) => (x.aim ? x : { ...x, aim: aim.slice(0, 3000) }));
  }, []);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [quote, setQuote] = useState(SOL_MINT);
  const [pq, setPq] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    getJSON<{ models: Model[]; providers: Record<string, string> }>("/api/models").then((j) => {
      setModels(j.models);
      setProviders(j.providers);
      const first = j.models.find((m) => m.provider === "anthropic") ?? j.models[0];
      if (first) { setProvider(first.provider); setF((x) => ({ ...x, model: first.id })); }
    }).catch(() => setErr("Couldn't load models"));
  }, []);

  useEffect(() => {
    if (!stonk) return;
    getJSON<{ pairs: Pair[] }>("/api/pairs").then((j) => setPairs(j.pairs)).catch(() => setPairs([{ mint: SOL_MINT, symbol: "SOL", name: "Solana", image: null, decimals: 9, category: "crypto" }]));
  }, [stonk]);
  const pair = pairs.find((p) => p.mint === quote) ?? { mint: SOL_MINT, symbol: "SOL", name: "Solana", image: null, decimals: 9, category: "crypto" };
  const shownPairs = useMemo(() => {
    const t = pq.trim().toLowerCase();
    const l = t ? pairs.filter((p) => p.symbol.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)) : pairs;
    return l.slice(0, 60);
  }, [pairs, pq]);

  const provs = useMemo(() => PROVIDER_ORDER.filter((p) => models.some((m) => m.provider === p)), [models]);
  const list = useMemo(
    () => models.filter((m) => m.provider === provider && (!q || m.label.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.outUsdPerM - a.outUsdPerM),
    [models, provider, q],
  );
  const chosen = models.find((m) => m.id === f.model);
  const deposit = launchCost + lamports(f.devBuySol || 0) + lamports(f.fuelSol || 0);
  const valid = !!cfg && f.name.length >= 2 && f.ticker.length >= 2 && f.aim.trim().length >= 20 && !!f.model && (!cfg?.launch.imageRequired || !!image);

  async function submit() {
    setErr("");
    const creator = wallet.publicKey?.toBase58() ?? (mock ? MOCK_WALLET : null);
    if (!creator) return modal.setVisible(true);
    setBusy(true);
    try {
      setStage(1); setStatus("Registering…");
      const fd = new FormData();
      fd.append("payload", JSON.stringify({ ...f, creatorWallet: creator, ...(stonk ? { quoteMint: quote } : {}) }));
      if (image) fd.append("image", image);
      const p = await postForm<{ id: string; slug: string; treasury: string; lamports: number }>("/api/launch/prepare", fd);
      setStage(2); setStatus(mock ? "Simulating deposit…" : `Approve the ${(p.lamports / 1e9).toFixed(3)} SOL deposit in your wallet…`);
      const sig = mock ? "mock" : await sendSol(connection, wallet, p.treasury, p.lamports);
      setStage(3); setStatus(stonk ? `Launching on StonkFun (paired with ${pair.symbol}) and waking the agent…` : "Creating the Meteora pool and waking the agent…");
      const done = await postJSON<{ slug: string }>("/api/launch/confirm", { id: p.id, signature: sig });
      setStage(4); setStatus("Agent awake. Opening its page…");
      setTimeout(() => router.push(`/c/${done.slug}`), 700);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      setStage(0);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
      <div className="min-w-0 space-y-10">
        <section className="space-y-3">
          <H n="01" icon="palette">Token</H>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <input className="input" placeholder="Company name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={32} />
            <input className="input font-mono" placeholder="TICKER" value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={10} />
          </div>
          <label className="card flex cursor-pointer items-center gap-4 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview ? <img src={preview} alt="" className="h-14 w-14 object-cover" /> : <div className="grid h-14 w-14 place-items-center border border-dashed border-line text-mute">+</div>}
            <div className="text-sm"><div className="text-cream">Token image</div><div className="text-xs text-mute">png/jpg/gif/webp, ≤ 2MB{mock ? " · optional in mock mode" : ""}</div></div>
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setImage(file);
              setPreview(file ? URL.createObjectURL(file) : "");
            }} />
          </label>
          <input className="input" placeholder="X / Twitter URL (optional)" value={f.twitter} onChange={(e) => setF({ ...f, twitter: e.target.value })} />
        </section>

        {stonk && (
          <section>
            <H n="01b" icon="chart">Pair with</H>
            <p className="mb-3 text-xs text-mute">Your coin launches on StonkFun and trades against the token you pick: SOL, or a tokenized stock like NVDAx. You deposit SOL either way; the dev buy is swapped for you.</p>
            <input className="input" placeholder="Search SOL, NVDAx, TSLAx…" value={pq} onChange={(e) => setPq(e.target.value)} />
            <div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {shownPairs.map((p) => (
                <button key={p.mint} type="button" onClick={() => setQuote(p.mint)} title={p.mint}
                  className={`notch flex min-w-0 items-center gap-2 border-2 px-2.5 py-2 text-left ${quote === p.mint ? "border-lime bg-lime/10" : "border-line hover:border-cream/40"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.image ? <img src={p.image} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" /> : <span className="grid h-6 w-6 shrink-0 place-items-center border border-line font-pixel text-[8px] text-mute">{p.symbol.slice(0, 2)}</span>}
                  <span className="min-w-0">
                    <span className={`block truncate font-mono text-[12px] ${quote === p.mint ? "text-lime" : "text-cream"}`}>{p.symbol}</span>
                    <span className="block truncate text-[10px] text-mute">{p.name}</span>
                  </span>
                </button>
              ))}
              {!pairs.length && <div className="col-span-full p-3 text-sm text-mute">Loading StonkFun pairs…</div>}
            </div>
          </section>
        )}

        <section>
          <H n="02" icon="chat">The aim</H>
          <p className="mb-3 text-xs text-mute">Describe what this business should become. This is the only instruction the agent gets from you. It decides everything else.</p>
          <textarea className="input min-h-[180px] text-[15px] leading-relaxed" placeholder="e.g. Become the go-to web design agency for coffee shops in Europe…" value={f.aim} onChange={(e) => setF({ ...f, aim: e.target.value })} maxLength={3000} />
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setF({ ...f, aim: x })} className="notch border-2 border-line bg-raise px-2 py-1 text-left text-[11px] text-mute hover:border-cream/40 hover:text-cream-dim">{x.slice(0, 48)}…</button>)}
          </div>
        </section>

        <section>
          <H n="03" icon="memory">The mind</H>
          <p className="mb-3 text-xs text-mute">Pick the provider and model that runs the company. Fixed forever at launch. Bigger models think better but burn more of the treasury per shift.</p>
          <div className="flex flex-wrap gap-2">
            {provs.map((p) => (
              <button key={p} type="button" onClick={() => setProvider(p)} className={`btn-ghost !px-3 !py-1.5 ${provider === p ? "!border-cream !bg-cream !text-ink" : ""}`}>{providers[p] ?? p}</button>
            ))}
          </div>
          <input className="input mt-3" placeholder="Filter models…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="card mt-3 max-h-72 divide-y-2 divide-line overflow-y-auto">
            {list.map((m) => (
              <button key={m.id} type="button" onClick={() => setF({ ...f, model: m.id })} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${f.model === m.id ? "bg-cream/10" : "hover:bg-cream/[0.04]"}`}>
                <span className={`h-2.5 w-2.5 shrink-0 ${f.model === m.id ? "bg-cyan shadow-[0_0_8px_#38d9ff]" : "bg-line"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-cream">{m.label}</span>
                  <span className="block truncate font-mono text-[10px] text-mute">{m.id}</span>
                </span>
                <span className="shrink-0 text-right font-mono text-[10px] text-mute" title={`$${m.inUsdPerM.toFixed(2)} per million input tokens, $${m.outUsdPerM.toFixed(2)} per million output tokens`}>${m.inUsdPerM.toFixed(2)} in / ${m.outUsdPerM.toFixed(2)} out<br />per M tok</span>
              </button>
            ))}
            {!list.length && <div className="p-4 text-sm text-mute">{models.length ? "No models match." : "Loading models…"}</div>}
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card space-y-4 p-5">
          <H n="04" icon="bolt">Launch</H>
          <div className="text-sm"><span className="text-mute">Mind: </span><span className="text-cream">{chosen?.label ?? "—"}</span></div>
          <label className="block">
            <span className="text-xs text-soft">Dev buy (SOL){stonk && pair.mint !== SOL_MINT ? ` — swapped to ${pair.symbol}` : ""} — tokens go to your wallet</span>
            <input className="input num mt-1" type="number" step="0.05" min={0} max={50} value={f.devBuySol} onChange={(e) => setF({ ...f, devBuySol: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="text-xs text-soft">Starter fuel (SOL) — lets the agent work before fees land</span>
            <input className="input num mt-1" type="number" step="0.01" min={0} max={50} value={f.fuelSol} onChange={(e) => setF({ ...f, fuelSol: Number(e.target.value) })} />
          </label>
          <dl className="num space-y-1.5 text-xs">
            <div className="flex justify-between"><dt className="text-mute">{stonk ? "StonkFun launch + rent" : "Meteora pool + rent"}</dt><dd>{(launchCost / 1e9).toFixed(3)} SOL</dd></div>
            <div className="flex justify-between"><dt className="text-mute">dev buy</dt><dd>{(f.devBuySol || 0).toFixed(3)} SOL</dd></div>
            <div className="flex justify-between"><dt className="text-mute">starter fuel</dt><dd>{(f.fuelSol || 0).toFixed(3)} SOL</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-sm text-cream"><dt>Deposit</dt><dd>{(deposit / 1e9).toFixed(3)} SOL</dd></div>
          </dl>
          <ul className="space-y-1 text-xs text-soft">
            {cfg?.vanity && <li>· Your contract address will end in <span className="font-mono text-lime">…{cfg.vanity.suffix}</span>.</li>}
            {stonk
              ? <li>· Launches on <span className="text-cream">StonkFun</span>, paired with <span className="text-lime">{pair.symbol}</span>. The company treasury is the coin&apos;s creator, so it earns from the first trade.</li>
              : <li>· Launches on Meteora with the company treasury as pool creator, so it earns from the first trade.</li>}
            <li>· The agent has full control of the treasury, website and business. You can&apos;t override it.</li>
            {stonk
              ? <li>· The creator share of StonkFun&apos;s trading fee goes to the company treasury{sharePct ? <>; Stonkware keeps {sharePct}% of it</> : null}. The rest fuels the agent.</li>
              : <li>· Each trade pays a {split.total / 100}% fee: <span className="text-lime">{split.company / 100}% to the company</span>, {split.firmware / 100}% Stonkware, {split.meteora / 100}% Meteora.</li>}
          </ul>
          {!mock && cfg?.cluster === "devnet" && (
            <div className="notch border-2 border-cyan/40 bg-cyan/5 p-3 text-xs text-soft">
              <div className="font-pixel text-[10px] uppercase text-cyan">devnet · test SOL only</div>
              <p className="mt-1">Get free SOL at <a className="link text-cream" href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>. In Phantom, turn on Settings → Developer Settings → Testnet Mode to see your devnet balance.</p>
            </div>
          )}
          <button className="btn-acid w-full" disabled={!valid || busy} onClick={submit}>{busy ? "Working…" : wallet.publicKey || mock ? "▸ Fund & launch" : "Connect wallet"}</button>
          {busy && (
            <ol className="slide-in space-y-1.5 border-2 border-line bg-ink p-3 font-mono text-[11px]">
              {["Register company", "Fund the treasury", stonk ? "Launch on StonkFun" : "Create Meteora pool", "Wake the agent"].map((t, i) => (
                <li key={t} className={`flex items-center gap-2 ${stage > i + 1 ? "text-lime" : stage === i + 1 ? "text-cream" : "text-mute"}`}>
                  <span className="w-4">{stage > i + 1 ? "✓" : stage === i + 1 ? <span className="flicker">▸</span> : "·"}</span>{t}
                </li>
              ))}
              <li className="pt-1 text-cream-dim"><span className="cursor">{status}</span></li>
              <li className="h-2 border border-line"><div className="h-full bg-cream shadow-[0_0_8px_rgba(232,241,255,.6)]" style={{ width: `${(stage / 4) * 100}%`, transition: "width .4s steps(5)" }} /></li>
            </ol>
          )}
          {err && <p className="text-sm text-red">{err}</p>}
        </div>
      </aside>
    </div>
  );
}
