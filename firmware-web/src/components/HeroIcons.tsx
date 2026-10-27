"use client";
// The Stonkware banner, rebuilt in code: nine pixel-art icons, each with its own looping animation,
// over a twinkling starfield, drifting dithered clouds and a glowing dot "floor".
import { useEffect, useRef } from "react";
import { HERO_ICONS } from "./heroIconData";
import { Stars } from "./motion";
import { useReducedMotion } from "@/lib/hooks";

const LABELS: Record<string, string> = {
  chat: "talks", bars: "grows", code: "builds", palette: "designs", monitor: "stonkware",
  calendar: "operates", cart: "sells", search: "researches", flow: "automates",
};

function Icon({ name }: { name: string }) {
  const ic = HERO_ICONS.find((i) => i.name === name)!;
  const big = name === "monitor";
  return (
    <div className={`hero-icon group relative flex flex-col items-center ${big ? "hero-icon--big" : ""}`} data-icon={name}>
      <svg viewBox={`-1 -1 ${ic.w + 2} ${ic.h + 2}`} shapeRendering="crispEdges" className="hero-svg" role="img" aria-label={LABELS[name]}>
        {ic.layers.map((l) => (
          <g key={l.n} className={`px-${name}-${l.n}`}>
            {l.p.map(([fill, d], i) => <path key={i} d={d} fill={fill} />)}
          </g>
        ))}
        {big && <rect className="px-monitor-scan" x="3" y="2" width="20" height="1" fill="#e8f1ff" />}
      </svg>
      <div className="hero-floor" aria-hidden />
      <span className="hero-label">{LABELS[name]}</span>
    </div>
  );
}

function Clouds() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="cloud cloud-a" />
      <div className="cloud cloud-b" />
      <div className="cloud cloud-c" />
      <div className="cloud cloud-d" />
    </div>
  );
}

export default function HeroIcons() {
  const row = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const el = row.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        el.style.transform = `translate3d(${(-x * 8).toFixed(1)}px, ${(-y * 5).toFixed(1)}px, 0)`;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => { window.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, [reduced]);

  const order = ["chat", "bars", "code", "palette", "monitor", "calendar", "cart", "search", "flow"];
  return (
    <div className="hero-banner relative mx-auto max-w-[1500px] overflow-hidden">
      <Clouds />
      <Stars count={46} seed={21} />
      <div ref={row} className="relative flex items-end justify-center gap-5 px-4 pb-12 pt-12 transition-transform duration-300 ease-out sm:gap-[2vw] sm:pt-20 lg:gap-8">
        {order.map((n, i) => (
          <div key={n} className={`hero-enter ${["bars","palette","calendar","search"].includes(n) ? "max-sm:hidden" : ""}`} style={{ animationDelay: `${150 + Math.abs(i - 4) * 110}ms` }}>
            <Icon name={n} />
          </div>
        ))}
      </div>
    </div>
  );
}
