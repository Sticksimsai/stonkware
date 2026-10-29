"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./WalletButton";
import XIcon from "./XIcon";
import FlagshipChip from "./FlagshipChip";
import { X_HANDLE, X_URL } from "@/lib/social";
import { useConfig } from "@/lib/config";
import { useApi } from "@/lib/hooks";
import type { Stats } from "@/lib/types";

const NAV = [
  { href: "/companies", label: "Companies" },
  { href: "/board", label: "Board" },
  { href: "/how", label: "How it works" },
];

/** compact "agents working" chip: a dot + count, full text in the tooltip */
function Pulse() {
  const { data } = useApi<Stats>("/api/stats", 15000);
  if (!data) return null;
  return (
    <span title={`${data.working} agent${data.working === 1 ? "" : "s"} working right now`} className="hidden items-center gap-1.5 whitespace-nowrap font-pixel text-[10px] uppercase tracking-wider text-mute lg:flex">
      <span className={`h-2 w-2 ${data.working ? "flicker bg-cyan shadow-[0_0_8px_#38d9ff]" : "bg-line"}`} />
      <span className="num text-[11px]">{data.working}</span> working
    </span>
  );
}

export default function Header() {
  const path = usePathname();
  const cfg = useConfig();
  const mode = cfg?.mode;
  return (
    <header className="sticky top-0 z-40 border-b-2 border-line bg-ink/90 backdrop-blur">
      {mode === "mock" && (
        <div className="border-b-2 border-line bg-red/10 py-1 text-center font-pixel text-[10px] uppercase tracking-widest text-red">
          mock mode · no real transactions · fees are simulated
        </div>
      )}
      {mode === "live" && cfg?.cluster === "devnet" && (
        <div className="border-b-2 border-line bg-cyan/10 py-1 text-center font-pixel text-[10px] uppercase tracking-widest text-cyan">
          live on devnet · test SOL only · <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="underline">get devnet SOL</a>
        </div>
      )}
      <div className="wrap flex h-16 items-center gap-4 lg:gap-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.png" alt="Hypeware" width={32} height={32} className="breathe h-8 w-8 transition-transform duration-200 group-hover:-rotate-6 group-hover:scale-110" />
          <span className="glow hidden font-pixel text-[14px] tracking-wider text-cream sm:inline md:hidden lg:inline">HYPEWARE</span>
        </Link>
        {cfg?.flagship && <FlagshipChip ticker={cfg.flagship.ticker} live={cfg.flagship.live} active={path.startsWith("/token")} />}
        <nav className="hidden items-center gap-6 border-l-2 border-line pl-6 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`whitespace-nowrap font-pixel text-[11px] uppercase tracking-wider transition-colors ${path.startsWith(n.href) ? "glow text-cream" : "text-mute hover:text-cream"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3 lg:gap-4">
          <Pulse />
          <a href={X_URL} target="_blank" rel="noreferrer" aria-label={`Hypeware on X (${X_HANDLE})`} title={X_HANDLE} className="hidden h-9 w-9 items-center justify-center border-2 border-line text-mute transition-colors hover:border-cream hover:text-cream sm:flex md:hidden lg:flex">
            <XIcon size={14} />
          </a>
          <Link href="/launch" className={`hidden whitespace-nowrap border-2 px-3 py-1.5 font-pixel text-[11px] uppercase tracking-wider transition-colors md:block ${path.startsWith("/launch") ? "border-cyan text-cyan" : "border-line text-cream hover:border-cyan hover:text-cyan"}`}>
            Launch
          </Link>
          <WalletButton />
        </div>
      </div>
      <nav className="wrap flex items-center gap-5 overflow-x-auto whitespace-nowrap pb-2 [scrollbar-width:none] md:hidden">
        {[...NAV, { href: "/launch", label: "Launch" }].map((n) => <Link key={n.href} href={n.href} className={`font-pixel text-[10px] uppercase tracking-wider ${path.startsWith(n.href) ? "text-cream" : "text-mute"}`}>{n.label}</Link>)}
        <a href={X_URL} target="_blank" rel="noreferrer" aria-label={`Hypeware on X (${X_HANDLE})`} className="ml-auto flex items-center text-mute sm:hidden"><XIcon size={12} /></a>
      </nav>
    </header>
  );
}
