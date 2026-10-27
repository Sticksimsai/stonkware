"use client";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { imageUrl, solscanTx } from "@/lib/api";
import { MediaThumb } from "./MediaGallery";
import { ago, short } from "@/lib/units";
import type { FeedItem } from "@/lib/types";
import PixelIcon, { type IconName } from "./PixelIcon";
import { CountUp } from "./motion";

export function Avatar({ id, ticker, hasImage, size = 40 }: { id: string; ticker: string; hasImage: boolean; size?: number }) {
  return hasImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl(id)} alt="" width={size} height={size} className="notch shrink-0 border-2 border-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="notch grid shrink-0 place-items-center border-2 border-line bg-ink font-pixel text-[9px] text-cream" style={{ width: size, height: size }}>
      {ticker.slice(0, 4)}
    </div>
  );
}

export function Stat({ label, value, format, hint, icon }: { label: string; value: number | null | undefined; format?: (n: number) => string; hint?: string; icon?: IconName }) {
  return (
    <div className="card lift p-4">
      <div className="flex items-center gap-2">
        {icon && <PixelIcon name={icon} size={14} />}
        <span className="label">{label}</span>
      </div>
      <div className="num glow mt-2 text-xl text-cream">
        {value == null ? <span className="text-mute">—</span> : <CountUp value={value} format={format} />}
      </div>
      {hint && <div className="mt-1 text-xs text-mute">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, icon, right }: { children: React.ReactNode; icon?: IconName; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="flex items-center gap-2.5 font-pixel text-[13px] uppercase tracking-wider text-cream">
        {icon && <PixelIcon name={icon} size={16} className="bob" />}
        <span className="glow">{children}</span>
      </h2>
      {right}
    </div>
  );
}

const KIND: Record<string, { c: string; i: IconName }> = {
  ACTION: { c: "text-cream", i: "bolt" },
  POST: { c: "text-cyan", i: "chat" },
  DELIVERY: { c: "text-lime", i: "check" },
  TREASURY: { c: "text-lime", i: "coin" },
  SYSTEM: { c: "text-mute", i: "flow" },
};

function FeedItemRow({ e, i, showCompany }: { e: FeedItem; i: number; showCompany?: boolean }) {
  const tx = solscanTx(e.sig);
  const k = KIND[e.kind] ?? KIND.SYSTEM;
  // media events put the file URL on the body's first line
  const first = e.body?.split("\n")[0] ?? "";
  const mediaUrl = /^https?:\/\/\S+\/api\/media\/\S+\.(mp4|webm|mov|png|jpe?g|webp|gif)$/i.test(first) ? first : null;
  const body = mediaUrl ? e.body.split("\n").slice(1).join("\n") : e.body;
  return (
    <li className="slide-in flex gap-3 p-4 transition-colors hover:bg-cream/[0.02]" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
      <PixelIcon name={k.i} size={16} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-pixel text-[10px] uppercase">
          <span className={k.c}>{e.kind.toLowerCase()}</span>
          {showCompany && e.slug && <Link href={`/c/${e.slug}`} className="text-cream hover:underline">${e.ticker}</Link>}
          <span className="ml-auto font-mono normal-case text-mute">{ago(e.createdAt)}</span>
        </div>
        <div className="mt-1 break-words text-[13px] text-cream">{e.title}</div>
        {mediaUrl && <a href={mediaUrl} target="_blank" rel="noreferrer" className="mt-2 block w-fit"><MediaThumb url={mediaUrl} className="max-h-40 max-w-full border-2 border-line object-cover" /></a>}
        {body && <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-[12px] leading-relaxed text-mute">{body}</p>}
        {tx && <a href={tx} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[11px] text-mute hover:text-cyan">tx {short(e.sig!, 6)} ↗</a>}
      </div>
    </li>
  );
}

/**
 * Activity feed. Shows the first `limit` items; "Show more" reveals the rest inside a scroller
 * that keeps the card exactly the same height as the collapsed list.
 */
export function FeedList({ items, showCompany, limit }: { items: FeedItem[]; showCompany?: boolean; limit?: number }) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState<number | null>(null);
  const ref = useRef<HTMLOListElement>(null);
  const collapsible = !!limit && items.length > limit;
  useLayoutEffect(() => {
    if (!open && ref.current) setH(ref.current.offsetHeight);
  }, [open, items.length]);
  if (!items.length) return <div className="card p-6 text-sm text-mute">No activity yet.</div>;
  const shown = collapsible && !open ? items.slice(0, limit) : items;
  return (
    <div className="card">
      <ol ref={ref} className={`divide-y-2 divide-line ${open ? "overflow-y-auto overscroll-contain" : ""}`} style={open && h ? { height: h } : undefined}>
        {shown.map((e, i) => <FeedItemRow key={e.id} e={e} i={open ? 0 : i} showCompany={showCompany} />)}
      </ol>
      {collapsible && (
        <button onClick={() => { setOpen(!open); if (open && ref.current) ref.current.scrollTop = 0; }}
          className="flex w-full items-center justify-center gap-2 border-t-2 border-line py-2.5 font-pixel text-[10px] uppercase tracking-wider text-mute transition-colors hover:bg-cream/[0.03] hover:text-cream">
          {open ? "▲ show less" : `▼ show ${items.length - limit!} more`}
        </button>
      )}
    </div>
  );
}

export function Skeleton({ h = 80, className = "" }: { h?: number; className?: string }) {
  return <div className={`card animate-pulse bg-raise/70 ${className}`} style={{ height: h }} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex items-center gap-3 border-red/50 p-4 text-sm text-red">
      <PixelIcon name="error" size={16} />
      <span className="flex-1">{message}</span>
      {onRetry && <button className="btn-ghost !py-1.5" onClick={onRetry}>Retry</button>}
    </div>
  );
}
