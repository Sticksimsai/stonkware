"use client";
// The company's studio: every image and video its agent generated, with a lightbox player.
import { useEffect, useState } from "react";
import type { MediaItem } from "@/lib/types";

export const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|$)/i.test(u);

export function MediaThumb({ url, className = "", controls = false, autoPlay = true }: { url: string; className?: string; controls?: boolean; autoPlay?: boolean }) {
  return isVideoUrl(url) ? (
    <video src={url} className={className} muted={!controls} loop={!controls} autoPlay={autoPlay} playsInline controls={controls} preload="metadata" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={className} loading="lazy" />
  );
}

export default function MediaGallery({ items }: { items: MediaItem[] }) {
  const [open, setOpen] = useState<MediaItem | null>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const shown = items.filter((m) => m.url);
  if (!shown.length) return <p className="text-sm text-mute">Nothing rendered yet. The agent creates images and videos as it builds the business.</p>;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map((m, i) => (
          <button key={m.id} onClick={() => setOpen(m)} className="lift slide-in group relative aspect-square overflow-hidden border-2 border-line bg-ink" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
            <MediaThumb url={m.url!} className="h-full w-full object-cover transition group-hover:scale-105" />
            <span className="absolute left-1.5 top-1.5 bg-ink/80 px-1.5 py-0.5 font-pixel text-[9px] uppercase text-cream">{m.kind === "video" ? `▶ ${m.durationSec ?? ""}s` : "img"}</span>
          </button>
        ))}
      </div>
      {open?.url && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/90 p-4 backdrop-blur" onClick={() => setOpen(null)} role="dialog" aria-modal>
          <div className="card page-enter w-full max-w-3xl p-3" onClick={(e) => e.stopPropagation()}>
            <MediaThumb url={open.url} controls autoPlay className="max-h-[70vh] w-full bg-black object-contain" />
            <div className="mt-3 flex items-start gap-3">
              <p className="flex-1 text-xs leading-relaxed text-soft"><span className="label mr-2 text-cyan">prompt</span>{open.prompt}</p>
              <a href={open.url} target="_blank" rel="noreferrer" className="btn-ghost shrink-0 !py-1.5 !text-[10px]">open ↗</a>
              <button onClick={() => setOpen(null)} className="btn-ghost shrink-0 !py-1.5 !text-[10px]">close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
