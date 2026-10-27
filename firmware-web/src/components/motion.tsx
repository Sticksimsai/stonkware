"use client";
// Motion primitives for the Stonkware look: reveal-on-scroll, count-up numbers, glitch text,
// twinkling stars, typewriter, a news ticker and a mouse-parallax banner. All respect reduced motion.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useInView, useReducedMotion } from "@/lib/hooks";
import type { FeedItem } from "@/lib/types";

export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <Tag ref={ref as never} className={`reveal ${seen ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** Animates from the previous value to `value` with a stepped, odometer-like feel. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const [ref, seen] = useInView<HTMLSpanElement>(0.3);
  useEffect(() => {
    if (!seen) return;
    if (reduced) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * (Math.floor(eased * 12) / 12)); // 12 discrete steps = pixel-y
      if (p < 1) raf = requestAnimationFrame(tick);
      else { setShown(value); from.current = value; }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, seen, reduced, duration]);
  return <span ref={ref}>{format(shown)}</span>;
}

export function Glitch({ text, className = "" }: { text: string; className?: string }) {
  return <span className={`glitch ${className}`} data-text={text}>{text}</span>;
}

/** Deterministic star field (no hydration mismatch). */
export function Stars({ count = 28, seed = 7, className = "" }: { count?: number; seed?: number; className?: string }) {
  const stars = useMemo(() => {
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: count }, () => ({ left: rnd() * 100, top: rnd() * 100, delay: rnd() * 3, size: rnd() > 0.85 ? 4 : 2 }));
  }, [count, seed]);
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {stars.map((st, i) => (
        <i key={i} className="star" style={{ left: `${st.left}%`, top: `${st.top}%`, width: st.size, height: st.size, animationDelay: `${st.delay}s` } as CSSProperties} />
      ))}
    </div>
  );
}

/** Types text out once, then leaves a blinking block cursor. */
export function Typewriter({ text, speed = 28, className = "", onDone }: { text: string; speed?: number; className?: string; onDone?: () => void }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) { setN(text.length); onDone?.(); return; }
    setN(0);
    const t = setInterval(() => setN((x) => {
      if (x >= text.length) { clearInterval(t); onDone?.(); return x; }
      return x + 1;
    }), speed);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed, reduced]);
  return <span className={className}>{text.slice(0, n)}<span className="cursor" /></span>;
}

/** Scrolling ticker of the latest moves across all companies. */
export function Ticker({ items }: { items: FeedItem[] }) {
  if (!items.length) return null;
  const row = items.map((e) => (
    <Link key={e.id} href={`/c/${e.slug}`} className="mx-6 inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-[11px] text-soft hover:text-cream">
      <span className={e.kind === "TREASURY" ? "text-lime" : e.kind === "POST" ? "text-cyan" : e.kind === "DELIVERY" ? "text-lime" : "text-cream"}>■</span>
      <span className="text-cream">${e.ticker}</span>
      <span>{e.title}</span>
    </Link>
  ));
  return (
    <div className="relative overflow-hidden border-y-2 border-line bg-raise/60 py-2 [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
      <div className="marquee">{row}{row}</div>
    </div>
  );
}

/** Banner that drifts with the mouse and gets a shimmer sweep. */
export function ParallaxBanner({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        el.style.transform = `translate3d(${(-x * 10).toFixed(1)}px, ${(-y * 6).toFixed(1)}px, 0) scale(1.03)`;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => { window.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, [reduced]);
  return (
    <div className="shimmer relative mx-auto max-w-[1500px] overflow-hidden [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,black_70%,transparent),linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
      <div ref={ref} className="transition-transform duration-300 ease-out will-change-transform">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="block w-full" />
      </div>
    </div>
  );
}
