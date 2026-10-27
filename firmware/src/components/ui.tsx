import Link from "next/link";
import { ago, short } from "@/lib/units";
import PixelIcon, { type IconName } from "./PixelIcon";

export function Avatar({ id, ticker, hasImage, size = 40 }: { id: string; ticker: string; hasImage: boolean | number; size?: number }) {
  return hasImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/image/${id}`} alt="" width={size} height={size} className="notch shrink-0 border-2 border-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="notch grid shrink-0 place-items-center border-2 border-line bg-ink font-pixel text-[9px] text-cream" style={{ width: size, height: size }}>
      {ticker.slice(0, 4)}
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: IconName }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        {icon && <PixelIcon name={icon} size={14} />}
        <span className="label">{label}</span>
      </div>
      <div className="num glow mt-2 text-xl text-cream">{value}</div>
      {hint && <div className="mt-1 text-xs text-mute">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, icon, right }: { children: React.ReactNode; icon?: IconName; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="flex items-center gap-2.5 font-pixel text-[13px] uppercase tracking-wider text-cream">
        {icon && <PixelIcon name={icon} size={16} />}
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

export function solscan(sig: string) {
  return sig.startsWith("mock") ? null : `https://solscan.io/tx/${sig}`;
}

export type FeedItem = { id: string; kind: string; title: string; body: string; sig: string | null; createdAt: Date; slug?: string; ticker?: string };

export function FeedList({ items, showCompany }: { items: FeedItem[]; showCompany?: boolean }) {
  if (!items.length) return <div className="card p-6 text-sm text-mute">No activity yet.</div>;
  return (
    <ol className="card divide-y-2 divide-line">
      {items.map((e) => {
        const tx = e.sig ? solscan(e.sig) : null;
        const k = KIND[e.kind] ?? KIND.SYSTEM;
        return (
          <li key={e.id} className="flex gap-3 p-4">
            <PixelIcon name={k.i} size={16} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-pixel text-[10px] uppercase">
                <span className={k.c}>{e.kind.toLowerCase()}</span>
                {showCompany && e.slug && <Link href={`/c/${e.slug}`} className="text-cream hover:underline">${e.ticker}</Link>}
                <span className="ml-auto font-mono normal-case text-mute">{ago(e.createdAt)}</span>
              </div>
              <div className="mt-1 text-[13px] text-cream">{e.title}</div>
              {e.body && <p className="mt-1 line-clamp-4 whitespace-pre-line text-[12px] leading-relaxed text-mute">{e.body}</p>}
              {tx && <a href={tx} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[11px] text-mute hover:text-cyan">tx {short(e.sig!, 6)} ↗</a>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
