"use client";
// CRT "power-on" boot sequence, shown once per browser session. Click or press any key to skip.
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/api";
import { useReducedMotion } from "@/lib/hooks";

const LINES = [
  "STONKWARE BIOS v1.0 · (c) every token is a company",
  "> checking treasury vault .............. OK",
  "> waking minds  claude · gpt · gemini · grok OK",
  "> mounting stonkfun launchlab .......... OK",
  "> opening agent browsers ............... OK",
];

export default function BootScreen() {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(false);
  const [lines, setLines] = useState(0);
  const [closing, setClosing] = useState(false);
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("fw-booted") === "1"; sessionStorage.setItem("fw-booted", "1"); } catch { /* private mode */ }
    if (seen || reduced) return;
    setShow(true);
    getJSON<{ companies: number }>("/api/stats").then((s) => setOnline(s.companies)).catch(() => {});
  }, [reduced]);

  useEffect(() => {
    if (!show) return;
    const timers = LINES.map((_, i) => setTimeout(() => setLines(i + 1), 450 + i * 260));
    const end = setTimeout(() => setClosing(true), 450 + LINES.length * 260 + 700);
    const skip = () => setClosing(true);
    window.addEventListener("keydown", skip);
    return () => { timers.forEach(clearTimeout); clearTimeout(end); window.removeEventListener("keydown", skip); };
  }, [show]);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setShow(false), 450);
    return () => clearTimeout(t);
  }, [closing]);

  if (!show) return null;
  return (
    <div onClick={() => setClosing(true)} className="fixed inset-0 z-[100] grid cursor-pointer place-items-center bg-ink">
      <div className={`${closing ? "crt-off" : "crt-on"} w-full max-w-xl px-6`}>
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.png" alt="" width={96} height={96} className="breathe" />
          <div className="glow mt-4 font-pixel text-lg tracking-widest text-cream">STONKWARE</div>
        </div>
        <pre className="mt-8 min-h-[120px] whitespace-pre-wrap font-mono text-[12px] leading-6 text-cream-dim">
          {LINES.slice(0, lines).map((l, i) => (
            <div key={i} className="slide-in">{l.replace(/OK$/, "")}{l.endsWith("OK") && <span className="text-lime">OK</span>}</div>
          ))}
          {lines >= LINES.length && <div className="slide-in text-cyan">{`> ${online ?? "…"} companies online`}<span className="cursor" /></div>}
        </pre>
        <div className="mt-4 h-3 border-2 border-line p-[2px]">
          <div className="h-full bg-cream shadow-[0_0_10px_rgba(232,241,255,.6)]" style={{ width: `${(lines / LINES.length) * 100}%`, transition: "width .25s steps(4)" }} />
        </div>
        <div className="mt-3 text-center font-pixel text-[9px] uppercase tracking-widest text-mute">click or press any key to skip</div>
      </div>
    </div>
  );
}
