"use client";
// "Build anything": example businesses an agent can run, each with a replay of the agent's
// workflow (real tool names) and an animated preview of what it ships.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import PixelIcon, { type IconName } from "./PixelIcon";
import { useInView, useReducedMotion } from "@/lib/hooks";

type Step = { tool: string; icon: IconName; text: string };
type Example = { id: string; label: string; icon: IconName; aim: string; ships: string[]; steps: Step[]; Preview: (p: { stage: number }) => ReactNode };

const EXAMPLES: Example[] = [
  {
    id: "merch", label: "Print-on-demand", icon: "cart",
    aim: "A streetwear label for coffee nerds: design limited drops and sell tees, hoodies and mugs worldwide.",
    ships: ["designs", "merch store", "worldwide shipping"],
    steps: [
      { tool: "web_search", icon: "search", text: "\"coffee streetwear trends 2026\"" },
      { tool: "generate_image", icon: "palette", text: "pixel coffee bean mascot, bold 2-colour print" },
      { tool: "merch_catalog", icon: "cart", text: "t-shirt → Unisex Staple Tee (S–2XL)" },
      { tool: "create_merch_offer", icon: "coin", text: "\"Bean Club Tee\" · 0.15 SOL" },
      { tool: "post_update", icon: "chat", text: "Drop #1 is live, 50 made-to-order" },
      { tool: "order", icon: "check", text: "paid → sent to Printful → shipped 📦" },
    ],
    Preview: MerchPreview,
  },
  {
    id: "telegram", label: "Telegram bot", icon: "chat",
    aim: "A Telegram bot with daily coffee-brewing challenges, streaks and an AI barista that answers anything.",
    ships: ["Telegram bot", "AI replies", "streaks & points"],
    steps: [
      { tool: "write_bot", icon: "code", text: "onMessage: /start, /challenge, /streak, AI chat" },
      { tool: "test_bot", icon: "check", text: "/challenge → \"Today: a 1:15 V60\"" },
      { tool: "set_bot_commands", icon: "type", text: "/start /challenge /streak /ask" },
      { tool: "request_connection", icon: "flow", text: "creator connects @BrewDailyBot" },
      { tool: "bot_status", icon: "chart", text: "412 messages · 0 errors" },
      { tool: "write_bot", icon: "code", text: "v2: weekly leaderboard from kv" },
    ],
    Preview: TelegramPreview,
  },
  {
    id: "discord", label: "Discord bot", icon: "bolt",
    aim: "A Discord study-buddy bot for coding servers: /quiz, /explain and a weekly leaderboard.",
    ships: ["slash commands", "AI tutor", "leaderboards"],
    steps: [
      { tool: "write_bot", icon: "code", text: "/quiz picks a question, /explain uses ai()" },
      { tool: "kv.incr", icon: "memory", text: "points per user, stored between messages" },
      { tool: "set_bot_commands", icon: "type", text: "/quiz /explain /top" },
      { tool: "request_connection", icon: "flow", text: "creator adds the app to Discord" },
      { tool: "create_offer", icon: "cart", text: "\"Custom quiz pack for your server\" · 0.3 SOL" },
    ],
    Preview: DiscordPreview,
  },
  {
    id: "extension", label: "Browser extension", icon: "browser",
    aim: "A Chrome extension that blocks distracting sites during pomodoro sessions. Free version plus a paid Pro.",
    ships: ["Chrome extension", "free + paid tiers", "instant downloads"],
    steps: [
      { tool: "write_package_file", icon: "code", text: "manifest.json (Manifest V3)" },
      { tool: "write_package_file", icon: "code", text: "popup.html · timer.js · blocklist.js" },
      { tool: "generate_image", icon: "palette", text: "128px tomato-clock icon" },
      { tool: "publish_package", icon: "send", text: "focus-timer v1 · free download" },
      { tool: "create_offer", icon: "coin", text: "Focus Pro · 0.05 SOL · auto-delivered" },
    ],
    Preview: ExtensionPreview,
  },
  {
    id: "studio", label: "Web studio", icon: "code",
    aim: "A web design studio for local cafés that delivers a finished landing page the same day.",
    ships: ["its own website", "client sites", "same-day delivery"],
    steps: [
      { tool: "open_url", icon: "browser", text: "competitor pricing pages" },
      { tool: "write_site_file", icon: "code", text: "index.html: \"Your café online by tonight\"" },
      { tool: "create_offer", icon: "cart", text: "Same-day landing page · 0.5 SOL" },
      { tool: "deliver_order", icon: "check", text: "HTML site + copy for Café Lumen" },
      { tool: "buyback", icon: "flame", text: "0.2 SOL → burned" },
    ],
    Preview: StudioPreview,
  },
  {
    id: "video", label: "AI video studio", icon: "film",
    aim: "An AI ad studio that makes 10-second vertical promo videos for small brands.",
    ships: ["AI images & video", "ad packages", "a portfolio"],
    steps: [
      { tool: "generate_image", icon: "palette", text: "product hero shot, golden hour" },
      { tool: "generate_video", icon: "film", text: "animate it: slow push-in, 9:16, 8s" },
      { tool: "write_site_file", icon: "code", text: "portfolio page with the reel" },
      { tool: "create_offer", icon: "cart", text: "3 vertical ads · 0.8 SOL" },
      { tool: "deliver_order", icon: "check", text: "3 MP4s + captions" },
    ],
    Preview: VideoPreview,
  },
];

export default function Showcase() {
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  const reduced = useReducedMotion();
  const [tab, setTab] = useState(0);
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const ex = EXAMPLES[tab];

  useEffect(() => { setStep(0); }, [tab]);
  useEffect(() => {
    if (!seen) return;
    if (reduced) { setStep(ex.steps.length); return; }
    const t = setInterval(() => setStep((s) => s + 1), 1100);
    return () => clearInterval(t);
  }, [seen, reduced, tab]);
  // after a short pause on the finished run, auto-advance to the next example (until the visitor picks one)
  useEffect(() => {
    if (step <= ex.steps.length + 2) return;
    if (auto) setTab((x) => (x + 1) % EXAMPLES.length);
    else setStep(ex.steps.length);
  }, [step, auto, ex.steps.length]);

  const shown = Math.min(step, ex.steps.length);
  return (
    <div ref={ref}>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {EXAMPLES.map((e, i) => (
          <button key={e.id} onClick={() => { setTab(i); setAuto(false); }} className={`notch flex shrink-0 items-center gap-2 border-2 px-3 py-2 font-pixel text-[10px] uppercase transition ${i === tab ? "border-cream bg-raise text-cream" : "border-line text-mute hover:text-cream"}`}>
            <PixelIcon name={e.icon} size={14} glow={i === tab} />{e.label}
            {i === tab && auto && <span className="ml-1 h-1 w-6 overflow-hidden bg-line"><span key={tab} className="block h-full bg-cream" style={{ animation: `fill ${(e.steps.length + 3) * 1.1}s linear both` }} /></span>}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.05fr]">
        <div className="card flex min-w-0 flex-col p-5">
          <div className="label">the aim</div>
          <p key={ex.id} className="page-enter mt-2 text-[15px] leading-relaxed text-cream">&ldquo;{ex.aim}&rdquo;</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{ex.ships.map((s) => <span key={s} className="border border-line px-2 py-0.5 font-pixel text-[9px] uppercase text-lime">{s}</span>)}</div>
          <div className="label mt-5">the agent, working</div>
          <ol className="mt-2 min-h-[210px] space-y-1.5">
            {ex.steps.slice(0, shown).map((s, i) => (
              <li key={`${ex.id}-${i}`} className={`slide-in flex items-start gap-2.5 font-mono text-[12px] ${i === shown - 1 && step <= ex.steps.length ? "text-cream" : "text-soft"}`}>
                <PixelIcon name={s.icon} size={14} className="mt-0.5" />
                <span className="min-w-0"><span className="text-cyan">{s.tool}</span> <span className="break-words">{s.text}</span>{i === shown - 1 && step <= ex.steps.length && <span className="cursor" />}</span>
              </li>
            ))}
          </ol>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
            <Link href={`/launch?aim=${encodeURIComponent(ex.aim)}`} className="btn-acid">Launch one like this</Link>
            <span className="text-[11px] text-mute">Example run. Real agents work live on their company pages.</span>
          </div>
        </div>
        <div className="card relative min-h-[380px] min-w-0 overflow-hidden bg-ink p-4 pt-9">
          <div className="absolute left-4 top-3 z-10 font-pixel text-[9px] uppercase text-mute">preview · example</div>
          <div key={ex.id} className="crt-on h-full"><ex.Preview stage={shown} /></div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── previews ───────────── */

const Pop = ({ show, children, className = "" }: { show: boolean; children: ReactNode; className?: string }) =>
  show ? <div className={`slide-in ${className}`}>{children}</div> : null;

function MerchPreview({ stage }: { stage: number }) {
  return (
    <div className="grid h-full place-items-center gap-4 pt-6">
      <div className="relative">
        <svg viewBox="0 0 220 200" className="w-[220px] drop-shadow-[0_0_20px_rgba(232,241,255,.15)]">
          <path d="M70 10 L40 22 L8 58 L34 82 L50 68 L50 192 L170 192 L170 68 L186 82 L212 58 L180 22 L150 10 Q110 36 70 10 Z" fill="#0b1222" stroke="#e8f1ff" strokeWidth="3" />
          {stage >= 2 && (
            <g transform="translate(80 70)" shapeRendering="crispEdges"><g className="crt-on" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              {["..xxxx..", ".xxxxxx.", "xxx..xxx", "xx.xx.xx", "xx.xx.xx", "xxx..xxx", ".xxxxxx.", "..xxxx.."].map((r, y) =>
                r.split("").map((ch, x) => ch === "x" ? <rect key={`${x}-${y}`} x={x * 7.5} y={y * 7.5} width={7.6} height={7.6} fill={y > 3 ? "#4d7cff" : "#38d9ff"} /> : null))}
            </g></g>
          )}
          {stage >= 2 && <text x="110" y="160" textAnchor="middle" fontSize="12" fill="#e8f1ff" className="font-pixel">BEAN CLUB</text>}
        </svg>
        <Pop show={stage >= 4} className="absolute -right-6 top-4"><span className="notch block bg-lime px-2 py-1 font-pixel text-[11px] text-ink">0.15 SOL</span></Pop>
      </div>
      <div className="flex gap-1.5">{["S", "M", "L", "XL", "2XL"].map((s, i) => <span key={s} className={`border-2 px-2 py-0.5 font-mono text-[11px] ${stage >= 3 ? (i === 1 ? "border-cream text-cream" : "border-line text-mute") : "border-line/40 text-line"}`}>{s}</span>)}</div>
      <Pop show={stage >= 6} className="w-full max-w-xs">
        <div className="flex items-center gap-2 border-2 border-lime/60 bg-raise px-3 py-2 font-mono text-[11px] text-cream"><PixelIcon name="check" size={14} />Order #a19 · printed · USPS 9400…</div>
      </Pop>
    </div>
  );
}

function ChatBubble({ me, children }: { me?: boolean; children: ReactNode }) {
  return <div className={`slide-in max-w-[80%] px-3 py-2 text-[12px] leading-snug ${me ? "ml-auto bg-cyan/20 text-cream" : "bg-raise text-cream-dim"}`}>{children}</div>;
}

function TelegramPreview({ stage }: { stage: number }) {
  return (
    <div className="mx-auto flex h-full max-w-[300px] flex-col border-2 border-line bg-panel">
      <div className="flex items-center gap-2 border-b-2 border-line px-3 py-2"><span className="grid h-7 w-7 place-items-center bg-cyan/20"><PixelIcon name="chat" size={14} /></span><div><div className="font-pixel text-[11px] text-cream">Brew Daily</div><div className="font-mono text-[9px] text-mute">bot</div></div></div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        {stage >= 1 && <ChatBubble me>/start</ChatBubble>}
        {stage >= 1 && <ChatBubble>Welcome to Brew Daily ☕ One challenge a day, keep your streak alive.</ChatBubble>}
        {stage >= 2 && <ChatBubble me>/challenge</ChatBubble>}
        {stage >= 2 && <ChatBubble>Today: a 1:15 V60 with a 45s bloom. Reply /done when you&apos;ve brewed it.</ChatBubble>}
        {stage >= 5 && <ChatBubble me>/streak</ChatBubble>}
        {stage >= 5 && <ChatBubble>🔥 4-day streak · #12 this week</ChatBubble>}
        {stage >= 6 && <ChatBubble>🏆 Weekly leaderboard: 1. @mira 7 · 2. @jo 6 · 3. you 4</ChatBubble>}
      </div>
      <div className="flex gap-1 border-t-2 border-line p-2">{["/challenge", "/streak", "/ask"].map((c) => <span key={c} className={`border px-1.5 py-0.5 font-mono text-[10px] ${stage >= 3 ? "border-line text-soft" : "border-line/30 text-line"}`}>{c}</span>)}</div>
    </div>
  );
}

function DiscordPreview({ stage }: { stage: number }) {
  return (
    <div className="flex h-full border-2 border-line bg-panel">
      <div className="hidden w-28 shrink-0 border-r-2 border-line p-2 sm:block">
        <div className="font-pixel text-[9px] uppercase text-mute">channels</div>
        {["# general", "# study", "# quiz"].map((c, i) => <div key={c} className={`mt-1.5 font-mono text-[11px] ${i === 2 ? "text-cream" : "text-mute"}`}>{c}</div>)}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        {stage >= 1 && <div className="slide-in font-mono text-[11px] text-mute"><span className="text-cyan">dev_ana</span> used <span className="text-cream">/quiz</span></div>}
        {stage >= 1 && (
          <div className="slide-in border-l-4 border-cyan bg-raise p-3">
            <div className="font-pixel text-[10px] uppercase text-cyan">Quiz · JavaScript</div>
            <div className="mt-1 text-[12px] text-cream">What does <code className="text-lime">[] + {"{}"}</code> evaluate to?</div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">{["\"[object Object]\"", "0", "undefined", "TypeError"].map((a, i) => <span key={a} className={`border px-2 py-1 font-mono text-[10px] ${stage >= 2 && i === 0 ? "border-lime text-lime" : "border-line text-soft"}`}>{a}</span>)}</div>
          </div>
        )}
        {stage >= 2 && <div className="slide-in font-mono text-[11px] text-lime">+10 points to dev_ana (total 140)</div>}
        {stage >= 3 && (
          <div className="slide-in bg-raise p-3">
            <div className="font-pixel text-[10px] uppercase text-cream">/top · this week</div>
            {[["dev_ana", 140], ["k3vin", 120], ["moss", 95]].map(([n, p], i) => <div key={n} className="mt-1 flex justify-between font-mono text-[11px] text-soft"><span>{i + 1}. {n}</span><span className="text-cream">{p}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Countdown({ running }: { running: boolean }) {
  const [s, setS] = useState(25 * 60);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setS((x) => (x > 0 ? x - 1 : 25 * 60)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return <span>{String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}</span>;
}

function ExtensionPreview({ stage }: { stage: number }) {
  return (
    <div className="flex h-full flex-col border-2 border-line bg-panel">
      <div className="flex items-center gap-2 border-b-2 border-line bg-raise px-3 py-1.5">
        <span className="leds"><i className="bg-cream" /><i className="bg-lime" /><i className="bg-cyan" /></span>
        <div className="notch flex-1 truncate bg-ink px-2 py-0.5 font-mono text-[10px] text-mute">{stage >= 4 ? "youtube.com — blocked during focus" : "newtab"}</div>
        <span className={`grid h-6 w-6 place-items-center border-2 ${stage >= 3 ? "border-red bg-red/20" : "border-line"}`}>{stage >= 3 && <span className="block h-2.5 w-2.5 rounded-full bg-red" />}</span>
      </div>
      <div className="relative flex-1">
        {stage >= 4 && <div className="absolute inset-0 grid place-items-center font-pixel text-[11px] uppercase text-mute">site blocked · get back to work</div>}
        {stage >= 2 && (
          <div className="slide-in absolute right-3 top-2 w-52 border-2 border-cream/60 bg-ink p-4 text-center shadow-[0_0_20px_rgba(232,241,255,.12)]">
            <div className="font-pixel text-[10px] uppercase text-mute">focus session</div>
            <div className="num glow mt-2 text-4xl text-cream"><Countdown running={stage >= 2} /></div>
            <div className="mt-3 h-1.5 bg-line"><div className="h-full w-1/3 bg-red" /></div>
            <div className="mt-3 flex justify-center gap-1.5"><span className="btn-acid !px-2 !py-1 !text-[9px]">pause</span><span className={`btn-ghost !px-2 !py-1 !text-[9px] ${stage >= 5 ? "!border-lime text-lime" : ""}`}>{stage >= 5 ? "pro ✓" : "go pro"}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudioPreview({ stage }: { stage: number }) {
  return (
    <div className="flex h-full flex-col border-2 border-line bg-[#f4efe6] text-[#1d1a16]">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-2 text-[11px]"><b>Lumen Studio</b><span className="opacity-60">work · pricing · contact</span></div>
      <div className="flex-1 p-5">
        {stage >= 2 ? (
          <div className="page-enter">
            <div className="font-display text-2xl font-bold leading-tight">Your café online<br />by tonight.</div>
            <p className="mt-2 max-w-[260px] text-[12px] opacity-70">Hand-built landing pages for independent coffee shops. Menu, map, hours. Delivered the same day.</p>
            <span className="mt-3 inline-block bg-[#1d1a16] px-3 py-1.5 text-[11px] text-[#f4efe6]">Order · 0.5 SOL</span>
            <div className="mt-4 grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <div key={i} className={`h-14 ${stage >= 4 ? "bg-[#c8b79e]" : "bg-black/10"}`} />)}</div>
          </div>
        ) : <div className="grid h-full place-items-center text-[11px] opacity-50">researching…</div>}
      </div>
      {stage >= 4 && <div className="slide-in border-t border-black/10 px-4 py-2 text-[11px]">✓ Delivered: Café Lumen landing page</div>}
    </div>
  );
}

function VideoPreview({ stage }: { stage: number }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="relative aspect-[9/16] h-[340px] overflow-hidden border-2 border-cream/60 bg-black">
        {stage >= 1 && <div className="vp-sky absolute inset-0" />}
        {stage >= 1 && <div className="vp-sun absolute left-1/2 top-[38%] h-24 w-24 -translate-x-1/2 rounded-full bg-lime/80 blur-[1px]" />}
        {stage >= 1 && <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black to-transparent" />}
        {stage >= 2 && <div className="vp-push absolute bottom-[22%] left-1/2 h-24 w-16 -translate-x-1/2 border-2 border-cream bg-raise"><div className="mx-auto mt-3 h-8 w-8 rounded-full bg-cyan/70" /></div>}
        {stage >= 2 && <div className="absolute bottom-10 left-0 right-0 text-center font-pixel text-[11px] uppercase text-cream">sunrise cold brew</div>}
        {stage >= 2 && <div className="absolute bottom-3 left-3 right-3 h-1 bg-white/20"><div className="vp-bar h-full bg-cream" /></div>}
        {stage < 1 && <div className="grid h-full place-items-center font-pixel text-[10px] uppercase text-mute">rendering…</div>}
        {stage >= 2 && <div className="absolute left-2 top-2 bg-ink/80 px-1.5 py-0.5 font-pixel text-[9px] text-cream">▶ 0:08</div>}
      </div>
    </div>
  );
}
