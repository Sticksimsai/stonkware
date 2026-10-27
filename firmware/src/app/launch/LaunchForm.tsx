"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { FEES, launchDeposit } from "@/lib/fees";
import { lamports } from "@/lib/units";
import { MOCK_WALLET, postJSON, sendSol } from "@/lib/client/tx";
import PixelIcon, { type IconName } from "@/components/PixelIcon";

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

export default function LaunchForm({ mode, split }: { mode: string; split: { total: number; company: number; firmware: number; meteora: number } }) {
  const mock = mode !== "live";
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();
  const router = useRouter();

  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("anthropic");
  const [q, setQ] = useState("");
  const [f, setF] = useState({ name: "", ticker: "", aim: "", model: "", devBuySol: 0.1, fuelSol: FEES.defaultFuelSol as number, twitter: "" });
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((j: { models: Model[]; providers: Record<string, string> }) => {
      setModels(j.models);
      setProviders(j.providers);
      const first = j.models.find((m) => m.provider === "anthropic") ?? j.models[0];
      if (first) { setProvider(first.provider); setF((x) => ({ ...x, model: first.id })); }
    }).catch(() => setErr("Couldn't load models"));
  }, []);

  const provs = useMemo(() => PROVIDER_ORDER.filter((p) => models.some((m) => m.provider === p)), [models]);
  const list = useMemo(
    () => models.filter((m) => m.provider === provider && (!q || m.label.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.outUsdPerM - a.outUsdPerM),
    [models, provider, q],
  );
  const chosen = models.find((m) => m.id === f.model);
  const deposit = launchDeposit(lamports(f.devBuySol || 0), lamports(f.fuelSol || 0));
  const valid = f.name.length >= 2 && f.ticker.length >= 2 && f.aim.trim().length >= 20 && !!f.model && (mock || !!image);

  async function submit() {
    setErr("");
    const creator = wallet.publicKey?.toBase58() ?? (mock ? MOCK_WALLET : null);
    if (!creator) return modal.setVisible(true);
    setBusy(true);
    try {
      setStatus("Registering…");
      const fd = new FormData();
      fd.append("payload", JSON.stringify({ ...f, creatorWallet: creator }));
      if (image) fd.append("image", image);
      const r = await fetch("/api/launch/prepare", { method: "POST", body: fd });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setStatus(mock ? "Simulating deposit…" : `Approve the ${(p.lamports / 1e9).toFixed(3)} SOL deposit in your wallet…`);
      const sig = mock ? "mock" : await sendSol(connection, wallet, p.treasury, p.lamports);
      setStatus("Creating the Meteora pool and waking the agent…");
      const done = await postJSON<{ slug: string }>("/api/launch/confirm", { id: p.id, signature: sig });
      router.push(`/c/${done.slug}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
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
                <span className={`h-2.5 w-2.5 shrink-0 ${f.model === m.id ? "bg-cyan shadow-[0_0_8px_#00e8e5]" : "bg-line"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-cream">{m.label}</span>
                  <span className="block truncate font-mono text-[10px] text-mute">{m.id}</span>
                </span>
                <span className="shrink-0 text-right font-mono text-[10px] text-mute">${m.inUsdPerM.toFixed(2)} / ${m.outUsdPerM.toFixed(2)}<br />per M tok</span>
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
            <span className="text-xs text-soft">Dev buy (SOL) — tokens owned by the company</span>
            <input className="input num mt-1" type="number" step="0.05" min={0} max={50} value={f.devBuySol} onChange={(e) => setF({ ...f, devBuySol: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="text-xs text-soft">Starter fuel (SOL) — lets the agent work before fees land</span>
            <input className="input num mt-1" type="number" step="0.01" min={0} max={50} value={f.fuelSol} onChange={(e) => setF({ ...f, fuelSol: Number(e.target.value) })} />
          </label>
          <dl className="num space-y-1.5 text-xs">
            <div className="flex justify-between"><dt className="text-mute">Meteora pool + rent</dt><dd>{(FEES.launchCostLamports / 1e9).toFixed(3)} SOL</dd></div>
            <div className="flex justify-between"><dt className="text-mute">dev buy</dt><dd>{(f.devBuySol || 0).toFixed(3)} SOL</dd></div>
            <div className="flex justify-between"><dt className="text-mute">starter fuel</dt><dd>{(f.fuelSol || 0).toFixed(3)} SOL</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-sm text-cream"><dt>Deposit</dt><dd>{(deposit / 1e9).toFixed(3)} SOL</dd></div>
          </dl>
          <ul className="space-y-1 text-xs text-soft">
            <li>· Launches on Meteora with the company treasury as pool creator, so it earns from the first trade.</li>
            <li>· The agent has full control of the treasury, website and business. You can&apos;t override it.</li>
            <li>· Each trade pays a {split.total / 100}% fee: <span className="text-lime">{split.company / 100}% to the company</span>, {split.firmware / 100}% Stonkware, {split.meteora / 100}% Meteora.</li>
          </ul>
          <button className="btn-acid w-full" disabled={!valid || busy} onClick={submit}>{busy ? "Working…" : wallet.publicKey || mock ? "▸ Fund & launch" : "Connect wallet"}</button>
          {busy && status && <p className="cursor font-mono text-[11px] text-cream-dim">{status}</p>}
          {err && <p className="text-sm text-red">{err}</p>}
        </div>
      </aside>
    </div>
  );
}
