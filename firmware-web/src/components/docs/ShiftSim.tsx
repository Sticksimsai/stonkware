"use client";
// A replay of an example agent shift: the step log types itself out while the fake browser follows along.
import { useEffect, useState } from "react";
import PixelIcon, { type IconName } from "@/components/PixelIcon";
import { useInView, useReducedMotion } from "@/lib/hooks";

type Step = { icon: IconName; kind: "THINK" | "TOOL" | "RESULT"; text: string; url?: string; screen?: "search" | "site" | "code" | "shop" | "chain" | "sleep"; cost: number };
const STEPS: Step[] = [
  { icon: "memory", kind: "THINK", text: "Treasury 1.84 SOL, 2 offers live, 1 unpaid order. Aim: web design studio for local cafés.", screen: "sleep", cost: 0.0002 },
  { icon: "search", kind: "TOOL", text: "web_search  \"cafe website trends 2026\"", url: "search?q=cafe+website+trends", screen: "search", cost: 0.0004 },
  { icon: "browser", kind: "TOOL", text: "open_url  competitor pricing page", url: "brewdesign.co/pricing", screen: "site", cost: 0.0006 },
  { icon: "doc", kind: "RESULT", text: "Competitors charge $400–$1,200 for a one-page site. Nobody offers same-day delivery.", screen: "site", cost: 0.0007 },
  { icon: "code", kind: "TOOL", text: "write_site_file  index.html  (new hero + pricing)", url: "brew.stonkware.com", screen: "code", cost: 0.0011 },
  { icon: "cart", kind: "TOOL", text: "create_offer  \"Same-day café landing page\" · 0.5 SOL", url: "brew.stonkware.com/#offers", screen: "shop", cost: 0.0012 },
  { icon: "check", kind: "TOOL", text: "deliver_order  #a91f → HTML site + copy", screen: "shop", cost: 0.0016 },
  { icon: "flame", kind: "TOOL", text: "buyback  0.2 SOL → burn", url: "solscan.io/tx/5Kx…", screen: "chain", cost: 0.0017 },
  { icon: "chat", kind: "TOOL", text: "post_update  \"Shipped same-day pages. 0.2 SOL burned.\"", screen: "chain", cost: 0.0018 },
  { icon: "moon", kind: "TOOL", text: "sleep  2h · end_shift", screen: "sleep", cost: 0.0018 },
];

function Screen({ s }: { s: Step["screen"] }) {
  if (s === "search") return <div className="space-y-2">{[90, 70, 80, 55].map((w, i) => <div key={i} className="crt-on space-y-1" style={{ animationDelay: `${i * 90}ms` }}><div className="h-2 bg-cyan/70" style={{ width: `${w * 0.5}%` }} /><div className="h-1.5 bg-line" style={{ width: `${w}%` }} /></div>)}</div>;
  if (s === "site") return <div className="crt-on grid grid-cols-3 gap-2">{["$400", "$750", "$1.2k"].map((p) => <div key={p} className="border-2 border-line p-2 text-center"><div className="h-1.5 bg-line" /><div className="mt-2 font-pixel text-[11px] text-cream">{p}</div><div className="mt-2 h-1.5 bg-line" /></div>)}</div>;
  if (s === "code") return <pre className="crt-on overflow-hidden font-mono text-[10px] leading-4 text-soft"><span className="text-cyan">&lt;section</span> class=&quot;hero&quot;<span className="text-cyan">&gt;</span>{"\n  "}<span className="text-cyan">&lt;h1&gt;</span><span className="text-cream">Your café, online by tonight.</span><span className="text-cyan">&lt;/h1&gt;</span>{"\n  "}<span className="text-cyan">&lt;a</span> href=&quot;#offers&quot;<span className="text-cyan">&gt;</span>Order · 0.5 SOL<span className="text-cyan">&lt;/a&gt;</span>{"\n"}<span className="text-cyan">&lt;/section&gt;</span><span className="cursor" /></pre>;
  if (s === "shop") return <div className="crt-on flex items-center gap-3 border-2 border-line p-3"><PixelIcon name="cart" size={26} /><div className="flex-1"><div className="font-pixel text-[11px] text-cream">SAME-DAY CAFÉ PAGE</div><div className="mt-1 h-1.5 w-2/3 bg-line" /></div><div className="font-pixel text-[11px] text-lime">0.5 SOL</div></div>;
  if (s === "chain") return <div className="crt-on space-y-1.5 font-mono text-[10px]"><div className="text-lime">✓ confirmed · slot 318,442,091</div><div className="text-soft">buy 0.2 SOL → 412,880 $BREW</div><div className="text-red">burn 412,880 $BREW</div></div>;
  return <div className="crt-on grid h-full place-items-center text-center"><div><div className="bob inline-block"><PixelIcon name="moon" size={30} /></div><div className="mt-2 font-pixel text-[10px] text-mute">AGENT IDLE · zz</div></div></div>;
}

export default function ShiftSim() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reduced) { setI(STEPS.length - 1); return; }
    const t = setInterval(() => setI((x) => (x + 1) % (STEPS.length + 2)), 1500); // +2 = pause on the last step
    return () => clearInterval(t);
  }, [seen, reduced]);
  const cur = Math.min(i, STEPS.length - 1);
  const step = STEPS[cur];
  const lastUrl = [...STEPS.slice(0, cur + 1)].reverse().find((s) => s.url)?.url ?? "about:blank";

  return (
    <div ref={ref} className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <div className="card flex min-h-[260px] flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b-2 border-line bg-raise px-3 py-2">
          <span className="leds"><i className="bg-cream" /><i className="bg-lime" /><i className="bg-cyan" /></span>
          <div className="notch flex-1 truncate bg-ink px-2 py-1 font-mono text-[11px] text-soft">{lastUrl}</div>
          <span className="flex items-center gap-1 font-pixel text-[9px] uppercase text-cyan"><i className="flicker inline-block h-2 w-2 bg-cyan" />live</span>
        </div>
        <div key={cur} className="relative flex-1 p-4"><Screen s={step.screen} /></div>
        <div className="flex justify-between border-t-2 border-line px-3 py-2 font-pixel text-[9px] uppercase text-mute">
          <span>step {cur + 1}/{STEPS.length}</span>
          <span>compute <span className="num text-lime">{step.cost.toFixed(4)} SOL</span></span>
        </div>
      </div>
      <ol className="card max-h-[340px] space-y-2 overflow-hidden p-4">
        {STEPS.slice(0, cur + 1).map((s, k) => k < cur - 6 ? null : (
          <li key={k} className={`slide-in flex gap-2.5 text-[12px] ${k === cur ? "" : "opacity-60"}`}>
            <PixelIcon name={s.icon} size={16} className="mt-0.5" />
            <span className={s.kind === "THINK" ? "border-l-2 border-cream/40 pl-2 italic text-cream-dim" : s.kind === "RESULT" ? "text-mute" : "font-mono text-cream"}>{s.text}{k === cur && <span className="cursor" />}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
