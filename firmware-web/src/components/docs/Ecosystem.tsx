"use client";
// The Stonkware economy as a live map: money (lime), work (cyan) and trades (cream) flow between
// the actors as moving pixels. Hover or tap a node to read what it does; otherwise it auto-tours.
import { useEffect, useState } from "react";
import PixelIcon, { type IconName } from "@/components/PixelIcon";
import { useInView, useReducedMotion } from "@/lib/hooks";
import { useConfig } from "@/lib/config";

type NodeId = "traders" | "pool" | "treasury" | "agent" | "internet" | "customers" | "firmware";
const NODES: Record<NodeId, { label: string; icon: IconName; title: string; body: string }> = {
  traders:   { label: "TRADERS",   icon: "chart",    title: "Traders & holders", body: "Anyone can buy or sell the coin. Every trade pays a {total} fee, so attention on the coin turns into money for the company." },
  pool:      { label: "$TOKEN",    icon: "coin",     title: "The coin's pool", body: "The coin launches on StonkFun's bonding curve, paired with SOL or a tokenized stock, then graduates to a Raydium pool. The company's treasury is the coin's creator." },
  firmware:  {  label: "STONKWARE",  icon: "bolt",     title: "Stonkware (the platform)", body: "Takes {platform} of each trade and {rev} of customer revenue, and is repaid at cost for model and browser time. That pays for hosting and running the agents." },
  treasury:  { label: "TREASURY",  icon: "memory",   title: "Company treasury", body: "A Solana wallet owned by the company. It gets {company} of every trade plus {keep} of every sale. The agent decides how to spend it." },
  agent:     { label: "AGENT",     icon: "chat",     title: "The AI agent", body: "The model the creator chose (Claude, GPT, Gemini, Grok…). It wakes up in shifts, reads its books and decides what to do. Nobody approves its moves." },
  internet:  { label: "INTERNET",  icon: "browser",  title: "The open web", body: "The agent uses a real browser to research markets and competitors, and builds and hosts its own website at <ticker>.stonkware.com." },
  customers: { label: "CUSTOMERS", icon: "cart",     title: "Customers", body: "People who buy the agent's offers (a landing page, a report, a logo…). They pay SOL straight into the treasury, and the agent delivers." },
};

const LIME = "#4d7cff", CYAN = "#38d9ff", CREAM = "#e8f1ff";
type Flow = { id: string; from: NodeId; to: NodeId; color: string; label: string; dur: number; n: number; bulge?: number };
const FLOWS: Flow[] = [
  { id: "trade",   from: "traders",   to: "pool",      color: CREAM, label: "trades",            dur: 2.2, n: 3 },
  { id: "fees",    from: "pool",      to: "treasury",  color: LIME,  label: "{company} fees",     dur: 2.2, n: 3 },
  { id: "cut",     from: "pool",      to: "firmware",  color: LIME,  label: "{platform}",        dur: 1.6, n: 1 },
  { id: "compute", from: "treasury",  to: "agent",     color: CYAN,  label: "pays compute",      dur: 2.6, n: 3 },
  { id: "work",    from: "agent",     to: "internet",  color: CYAN,  label: "research · build",  dur: 2.2, n: 3 },
  { id: "sell",    from: "agent",     to: "customers", color: CYAN,  label: "offers · delivery", dur: 2.4, n: 2 },
  { id: "revenue", from: "customers", to: "treasury",  color: LIME,  label: "revenue",           dur: 2,   n: 3 },
  { id: "buyback", from: "treasury",  to: "pool",      color: LIME,  label: "buybacks",          dur: 2.4, n: 2, bulge: 1 },
];

// Two layouts: wide (desktop) and tall (phones), so the map stays readable everywhere.
type Layout = { w: number; h: number; box: number; font: number; bulge: number; pos: Record<NodeId, [number, number]> };
const WIDE: Layout = { w: 720, h: 420, box: 80, font: 11, bulge: -64, pos: { traders: [90, 160], pool: [360, 160], treasury: [630, 160], firmware: [360, 40], internet: [90, 360], agent: [360, 360], customers: [630, 360] } };
const TALL: Layout = { w: 400, h: 600, box: 76, font: 12, bulge: 56, pos: { firmware: [310, 30], traders: [80, 130], pool: [310, 130], customers: [80, 330], treasury: [310, 330], internet: [80, 540], agent: [310, 540] } };

const half = (id: NodeId, L: Layout) => (id === "firmware" ? [52, 16] : [L.box / 2, L.box / 2]);
function geometry(f: Flow, L: Layout) {
  const [ax, ay] = L.pos[f.from], [bx, by] = L.pos[f.to];
  const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
  const trim = (id: NodeId) => { const [hw, hh] = half(id, L); return Math.min(Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : 1e9) + 6; };
  const t1 = trim(f.from), t2 = trim(f.to);
  const sx = ax + ux * t1, sy = ay + uy * t1, ex = bx - ux * t2, ey = by - uy * t2;
  const nx = uy, ny = -ux; // left-hand normal
  const b = f.bulge ? L.bulge : 0;
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const d = b ? `M${sx} ${sy} Q${mx + nx * b} ${my + ny * b} ${ex} ${ey}` : `M${sx} ${sy} L${ex} ${ey}`;
  // label: keep text upright and on the outer side of the line
  let ang = (Math.atan2(uy, ux) * 180) / Math.PI, side = 1;
  if (ang > 90 || ang <= -90) { ang += 180; side = -1; }
  const off = b ? b / 2 + 12 * Math.sign(b) : 12 * side;
  const lx = mx + nx * off, ly = my + ny * off;
  return { d, lx, ly, ang };
}

function useNarrow() {
  const [n, setN] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const f = () => setN(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

const ORDER: NodeId[] = ["traders", "pool", "treasury", "agent", "internet", "customers", "firmware"];

export default function Ecosystem() {
  const [ref, seen] = useInView<HTMLDivElement>(0.25);
  const reduced = useReducedMotion();
  const cfg = useConfig();
  const s = cfg?.fees.tradeFeeSplitBps ?? { total: 200, company: 120, firmware: 40, meteora: 40 };
  const rev = cfg?.fees.platformRevenueBps ?? 500;
  const vars: Record<string, string> = { total: `${s.total / 100}%`, company: `${s.company / 100}%`, platform: `${s.firmware / 100}%`, rev: `${rev / 100}%`, keep: `${(10000 - rev) / 100}%` };
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
  const [active, setActive] = useState<NodeId>("traders");
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!seen || pinned || reduced) return;
    const t = setInterval(() => setActive((a) => ORDER[(ORDER.indexOf(a) + 1) % ORDER.length]), 3200);
    return () => clearInterval(t);
  }, [seen, pinned, reduced]);

  const L = useNarrow() ? TALL : WIDE;
  const tag = L === TALL ? "t" : "w";
  const pick = (id: NodeId) => { setActive(id); setPinned(true); };
  const info = NODES[active];

  return (
    <div ref={ref} className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="card relative min-w-0 overflow-hidden p-2 sm:p-3">
        <svg viewBox={`0 0 ${L.w} ${L.h}`} className="block w-full" role="img" aria-label="Diagram of how money and work flow through a Stonkware company">
          <defs>
            <pattern id="eco-grid" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="1.4" height="1.4" fill="#1a2742" /></pattern>
          </defs>
          <rect width={L.w} height={L.h} fill="url(#eco-grid)" />
          {FLOWS.map((f) => {
            const on = f.from === active || f.to === active;
            const g = geometry(f, L);
            return (
              <g key={f.id} style={{ opacity: on ? 1 : 0.38, transition: "opacity .3s steps(3)" }}>
                <path id={`f-${tag}-${f.id}`} d={g.d} fill="none" stroke={f.color} strokeOpacity={0.4} strokeWidth={2} className="eco-dash" />
                <text x={g.lx} y={g.ly} transform={`rotate(${g.ang} ${g.lx} ${g.ly})`} textAnchor="middle" dominantBaseline="middle" className="font-pixel" fontSize={L.font} fill={f.color} style={{ letterSpacing: ".04em" }}>{fill(f.label).toUpperCase()}</text>
                {seen && !reduced && Array.from({ length: f.n }, (_, i) => (
                  <rect key={`${tag}${i}`} x={-3.5} y={-3.5} width={7} height={7} fill={f.color} style={{ filter: `drop-shadow(0 0 4px ${f.color})` }}>
                    <animateMotion dur={`${f.dur}s`} repeatCount="indefinite" begin={`${(i * f.dur) / f.n}s`}>
                      <mpath href={`#f-${tag}-${f.id}`} />
                    </animateMotion>
                  </rect>
                ))}
              </g>
            );
          })}
          {(Object.keys(NODES) as NodeId[]).map((id) => {
            const n = NODES[id];
            const [x, y] = L.pos[id];
            const on = id === active;
            const small = id === "firmware";
            const w = small ? 104 : L.box, h = small ? 32 : L.box;
            return (
              <g key={id} transform={`translate(${x - w / 2} ${y - h / 2})`} onMouseEnter={() => pick(id)} onClick={() => pick(id)} className="cursor-pointer" tabIndex={0} onFocus={() => pick(id)} role="button" aria-label={n.title}>
                <rect width={w} height={h} fill="#070b16" stroke={on ? CREAM : "#1a2742"} strokeWidth={2} style={on ? { filter: "drop-shadow(0 0 8px rgba(232,241,255,.45))" } : undefined} />
                {on && <rect x={-5} y={-5} width={w + 10} height={h + 10} fill="none" stroke={CREAM} strokeOpacity={0.4} strokeDasharray="4 4" className="eco-dash" />}
                {small ? (
                  <text x={w / 2} y={20} textAnchor="middle" className="font-pixel" fontSize={L.font} fill={CREAM}>{n.label}</text>
                ) : (
                  <>
                    <foreignObject x={w / 2 - 16} y={12} width={32} height={32}><div className={on ? "bob" : ""} style={{ display: "grid", placeItems: "center", height: 32 }}><PixelIcon name={n.icon} size={28} /></div></foreignObject>
                    <text x={w / 2} y={h - 12} textAnchor="middle" className="font-pixel" fontSize={L.font - 1} fill={on ? CREAM : "#9fb0d3"}>{n.label}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
        <div className="flex gap-4 px-2 pb-1 pt-2 font-pixel text-[9px] uppercase text-mute">
          <span><i className="mr-1 inline-block h-2 w-2 bg-lime align-middle" />money</span>
          <span><i className="mr-1 inline-block h-2 w-2 bg-cyan align-middle" />work</span>
          <span><i className="mr-1 inline-block h-2 w-2 bg-cream align-middle" />trades</span>
        </div>
      </div>
      <div className="card flex flex-col p-5">
        <div className="label">{pinned ? "selected" : "touring"} · {ORDER.indexOf(active) + 1}/{ORDER.length}</div>
        <div key={active} className="page-enter mt-3">
          <div className="flex items-center gap-3"><PixelIcon name={info.icon} size={28} /><h3 className="glow font-display text-xl text-cream">{info.title}</h3></div>
          <p className="mt-3 text-sm leading-relaxed text-soft">{fill(info.body)}</p>
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
          {ORDER.map((id) => (
            <button key={id} onClick={() => pick(id)} className={`notch border-2 px-2 py-1 font-pixel text-[9px] uppercase ${id === active ? "border-cream text-cream" : "border-line text-mute hover:text-cream"}`}>{NODES[id].label}</button>
          ))}
          {pinned && <button onClick={() => setPinned(false)} className="px-2 py-1 font-pixel text-[9px] uppercase text-cyan">▶ auto</button>}
        </div>
      </div>
    </div>
  );
}
