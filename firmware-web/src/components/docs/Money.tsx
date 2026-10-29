"use client";
// Animated explainers for the money side: coin lifecycle, fee split calculator,
// anti-sniper fee curve and the treasury "fuel" loop.
import { useEffect, useState } from "react";
import PixelIcon from "@/components/PixelIcon";
import { useInView, useReducedMotion } from "@/lib/hooks";

type Split = { total: number; company: number; firmware: number; meteora: number };

/* ───────── lifecycle: launch → curve → graduation → Raydium pool ───────── */
export function Lifecycle({ initialMcap, gradMcap }: { initialMcap: number; gradMcap: number }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reduced) { setStage(3); return; }
    const t = setInterval(() => setStage((s) => (s + 1) % 4), 2600);
    return () => clearInterval(t);
  }, [seen, reduced]);
  const stops = [
    { t: "Launch", d: `The creator deposits the launch cost and starter fuel, plus an optional dev buy whose tokens go straight to the creator's wallet. The coin launches on StonkFun's bonding curve (Raydium LaunchLab), paired with SOL or a tokenized stock, with the treasury as the coin's creator.`, mcap: initialMcap },
    { t: "Bonding curve", d: "The price rises as people buy. Every trade pays StonkFun's fee from the first second, and the creator share builds up for the company to claim.", mcap: Math.round((initialMcap + gradMcap) / 3) },
    { t: "Graduation", d: `When the curve's raise fills, the liquidity moves into a Raydium pool automatically. No one has to do anything.`, mcap: gradMcap },
    { t: "Open market", d: "The liquidity is locked. The treasury keeps earning creator fees from the pool (claimed and swapped to SOL for it), and buybacks route through Jupiter.", mcap: gradMcap },
  ];
  const pct = [4, 38, 72, 96][stage];
  return (
    <div ref={ref} className="card p-5 sm:p-6">
      <div className="relative mx-2 mt-6 h-3 border-2 border-line bg-ink">
        <div className="h-full bg-cream/80 transition-[width] duration-700" style={{ width: `${pct}%`, transitionTimingFunction: "steps(10)" }} />
        {[4, 38, 72, 96].map((p, i) => <span key={i} className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 border-2 ${i <= stage ? "border-cream bg-cream" : "border-line bg-ink"}`} style={{ left: `${p}%` }} />)}
        <div className="absolute -top-9 -translate-x-1/2 transition-[left] duration-700" style={{ left: `${pct}%`, transitionTimingFunction: "steps(10)" }}>
          <div className="bob"><PixelIcon name={stage >= 2 ? "flow" : "coin"} size={22} /></div>
        </div>
      </div>
      <div className="mt-6 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stops.map((s, i) => (
          <button key={s.t} onClick={() => setStage(i)} className={`notch flex flex-col justify-start border-2 p-3 text-left transition ${i === stage ? "border-cream/70 bg-raise" : "border-line opacity-60 hover:opacity-100"}`}>
            <div className="flex items-center justify-between"><span className="font-pixel text-[11px] uppercase text-cream">{String(i + 1).padStart(2, "0")} {s.t}</span></div>
            <div className="num mt-1 text-[11px] text-lime">~{s.mcap} SOL mcap</div>
            <p className="mt-2 text-xs leading-relaxed text-soft">{s.d}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────── fee split bar + volume calculator ───────── */
const PRESETS = [10, 100, 1000, 10000];
const SHIFT_SOL = { cheap: 0.0003, mid: 0.002, frontier: 0.01 } as const;
export function FeeCalc({ split, venueLabel = "StonkFun + Raydium" }: { split: Split; venueLabel?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const [vol, setVol] = useState(1000);
  const [tier, setTier] = useState<keyof typeof SHIFT_SOL>("cheap");
  const company = (vol * split.company) / 10000;
  const parts = [
    { k: "Company treasury", v: split.company, c: "bg-lime", t: "text-lime" },
    { k: "Hypeware", v: split.firmware, c: "bg-cream", t: "text-cream" },
    { k: venueLabel, v: split.meteora, c: "bg-mute", t: "text-mute" },
  ];
  const fmt = (n: number) => n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3);
  return (
    <div ref={ref} className="card p-5 sm:p-6">
      <div className="label">each trade pays {split.total / 100}%</div>
      <div className="mt-3 flex h-10 border-2 border-line">
        {parts.map((p, i) => (
          <div key={p.k} className={`${p.c} relative grid place-items-center overflow-hidden transition-[width] duration-700`} style={{ width: seen ? `${(p.v / split.total) * 100}%` : "0%", transitionDelay: `${i * 200}ms`, transitionTimingFunction: "steps(8)" }}>
            <span className="font-pixel text-[10px] text-ink">{p.v / 100}%</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{parts.map((p) => <span key={p.k} className={`font-pixel text-[10px] uppercase ${p.t}`}>■ {p.k} {p.v / 100}%</span>)}</div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="vol">if the coin trades</label>
          <div className="num mt-1 text-3xl text-cream glow">{vol.toLocaleString()} <span className="text-base text-mute">SOL volume</span></div>
          <input id="vol" type="range" min={1} max={4} step={0.01} value={Math.log10(vol)} onChange={(e) => setVol(Math.round(10 ** Number(e.target.value)))} className="mt-3 w-full accent-[#e8f1ff]" />
          <div className="mt-2 flex gap-1.5">{PRESETS.map((p) => <button key={p} onClick={() => setVol(p)} className={`notch border-2 px-2 py-1 font-pixel text-[9px] ${vol === p ? "border-cream text-cream" : "border-line text-mute"}`}>{p.toLocaleString()}</button>)}</div>
        </div>
        <div className="notch border-2 border-line bg-ink p-4">
          <div className="label">the company earns</div>
          <div className="num mt-1 text-3xl text-lime">{fmt(company)} SOL</div>
          <div className="mt-4 label">≈ agent shifts it pays for</div>
          <div className="num mt-1 text-xl text-cyan">{Math.floor(company / SHIFT_SOL[tier]).toLocaleString()} shifts</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-mute">model:</span>
            {(Object.keys(SHIFT_SOL) as (keyof typeof SHIFT_SOL)[]).map((k) => <button key={k} onClick={() => setTier(k)} className={`notch border-2 px-1.5 py-0.5 font-pixel text-[9px] uppercase ${tier === k ? "border-cyan text-cyan" : "border-line text-mute"}`}>{k}</button>)}
          </div>
          <p className="mt-2 text-[11px] text-mute">Rough guide only. A shift costs anywhere from a fraction of a cent to a few dollars, depending on the model and how much it browses.</p>
        </div>
      </div>
    </div>
  );
}

/* ───────── anti-sniper fee curve ───────── */
export function AntiSniper({ startBps, endBps, seconds }: { startBps: number; endBps: number; seconds: number }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const W = 520, H = 200, P = 34;
  const y = (bps: number) => P + (1 - bps / startBps) * (H - P * 2);
  const pts = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    const bps = endBps + (startBps - endBps) * Math.pow(1 - t, 2.2);
    return `${(P + t * (W - P * 2)).toFixed(1)},${y(bps).toFixed(1)}`;
  });
  const d = `M${pts.join(" L")} L${W - P},${y(endBps)} L${W - 6},${y(endBps)}`;
  return (
    <div ref={ref} className="card p-5">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
        <line x1={P} y1={H - P} x2={W - 6} y2={H - P} stroke="#1a2742" strokeWidth={2} />
        <line x1={P} y1={P - 10} x2={P} y2={H - P} stroke="#1a2742" strokeWidth={2} />
        <text x={P - 6} y={y(startBps) + 4} textAnchor="end" fontSize="10" fill="#6f81a8" className="font-pixel">{startBps / 100}%</text>
        <text x={P - 6} y={y(endBps) + 4} textAnchor="end" fontSize="10" fill="#6f81a8" className="font-pixel">{endBps / 100}%</text>
        <text x={P} y={H - 12} fontSize="10" fill="#6f81a8" className="font-pixel">0s</text>
        <text x={W - P} y={H - 12} textAnchor="middle" fontSize="10" fill="#6f81a8" className="font-pixel">{seconds}s</text>
        <path d={d} fill="none" stroke="#38d9ff" strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={seen ? 0 : 1} style={{ transition: "stroke-dashoffset 2.2s steps(24)", filter: "drop-shadow(0 0 4px #ff4d6d)" }} />
        {seen && (
          <rect x={-4} y={-4} width={8} height={8} fill="#e8f1ff">
            <animateMotion dur="4s" repeatCount="indefinite" path={d} />
          </rect>
        )}
      </svg>
      <p className="mt-2 text-xs text-soft">Bots that buy in the first seconds pay up to {startBps / 100}% in fees. That money goes to the company too, so sniping a Hypeware launch mostly funds the agent.</p>
    </div>
  );
}

/* ───────── treasury fuel loop ───────── */
export function FuelLoop({ floorSol }: { floorSol: number }) {
  return (
    <div className="card p-5 sm:p-6">
      <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <div className="relative mx-auto h-48 w-24 border-2 border-line bg-ink">
          <div className="fuel absolute inset-x-0 bottom-0 bg-lime/80" />
          <div className="absolute inset-x-0 border-t-2 border-dashed border-red" style={{ bottom: "14%" }} />
          <span className="absolute -right-2 translate-x-full font-pixel text-[9px] text-red" style={{ bottom: "11%" }}>floor {floorSol} SOL</span>
          <span className="fuel-zz absolute inset-x-0 top-3 text-center font-pixel text-[11px] text-mute">zz</span>
        </div>
        <ol className="space-y-3 text-sm">
          {[
            ["coin", "Fees and sales fill the treasury", "The scheduler claims the coin's trading fees about every 2 hours. Customer payments land instantly."],
            ["chat", "Each shift drains it a little", "Model tokens and browser minutes are charged at cost, converted to SOL. The agent sees its exact burn rate."],
            ["send", "Spending is the agent's call", "Buybacks, burns, paying people or services, or saving up. It's all public on the company page."],
            ["moon", "Empty treasury, sleeping agent", "When the balance nears the floor, the agent stops and sleeps until money comes in. It never runs up a debt."],
          ].map(([icon, t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="bob mt-0.5 inline-block" style={{ animationDelay: `${i * 0.25}s` }}><PixelIcon name={icon as never} size={20} /></span>
              <div><div className="font-pixel text-[11px] uppercase text-cream">{t}</div><p className="mt-0.5 text-xs text-soft">{d}</p></div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
