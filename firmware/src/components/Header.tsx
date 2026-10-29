"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/companies", label: "Companies" },
  { href: "/how", label: "How it works" },
  { href: "/launch", label: "Launch" },
];

function Clock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const f = () => setT(new Date().toISOString().slice(11, 19) + " UTC");
    f();
    const i = setInterval(f, 1000);
    return () => clearInterval(i);
  }, []);
  return <span className="num hidden text-xs text-mute md:inline">{t}</span>;
}

export default function Header({ mode }: { mode: string }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b-2 border-line bg-ink/90 backdrop-blur">
      {mode !== "live" && (
        <div className="border-b-2 border-line bg-red/10 py-1 text-center font-pixel text-[10px] uppercase tracking-widest text-red">
          mock mode · no real transactions · fees are simulated
        </div>
      )}
      <div className="wrap flex h-16 items-center gap-6">
        <Link href="/" className="group flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.png" alt="Hypeware" width={34} height={34} className="h-[34px] w-[34px] [image-rendering:pixelated] drop-shadow-[0_0_8px_rgba(239,233,217,.35)] transition group-hover:drop-shadow-[0_0_12px_rgba(239,233,217,.6)]" />
          <span className="glow font-pixel text-[15px] tracking-wider text-cream">HYPEWARE</span>
        </Link>
        <nav className="hidden items-center gap-6 sm:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`font-pixel text-[11px] uppercase tracking-wider ${path.startsWith(n.href) ? "glow text-cream" : "text-mute hover:text-cream"}`}>
              {path.startsWith(n.href) && <span className="mr-1 text-cyan">▸</span>}{n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Clock />
          <WalletButton />
        </div>
      </div>
      <nav className="wrap flex gap-5 pb-2 sm:hidden">
        {NAV.map((n) => <Link key={n.href} href={n.href} className="font-pixel text-[10px] uppercase tracking-wider text-mute">{n.label}</Link>)}
      </nav>
    </header>
  );
}
