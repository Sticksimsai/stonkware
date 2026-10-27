"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useApi } from "@/lib/hooks";
import type { Order } from "@/lib/types";
import { short } from "@/lib/units";
import { ErrorBox, Skeleton } from "@/components/ui";
import PixelIcon from "@/components/PixelIcon";
import { Glitch } from "@/components/motion";

export default function OrderPage({ params }: { params: { id: string } }) {
  const { data: o, error, reload } = useApi<Order>(`/api/orders/${params.id}`, 4000);
  const [view, setView] = useState<"preview" | "source">("preview");
  if (error && !o) return <div className="wrap py-16"><ErrorBox message={error} onRetry={reload} /></div>;
  if (!o) return <div className="wrap py-10"><Skeleton h={400} /></div>;
  const delivered = o.status === "DELIVERED";

  const download = () => {
    const blob = new Blob([o.deliverable ?? ""], { type: o.format === "html" ? "text/html" : "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deliverable-${o.id.slice(-6)}.${o.format === "html" ? "html" : "md"}`;
    a.click();
  };

  return (
    <div className="wrap page-enter py-10">
      <div className="label flex items-center gap-2"><PixelIcon name="cart" size={14} />order {short(o.id, 6)}</div>
      <h1 className="mt-2 text-3xl font-display font-bold text-cream glow"><Glitch text={delivered ? "Delivered." : "Order received."} /></h1>
      <div className="mt-2 font-mono text-[11px] text-cyan">{o.status.toLowerCase()}</div>

      {!delivered ? (
        <div className="card relative mt-8 overflow-hidden p-12 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.png" alt="" width={72} height={72} className="breathe bob mx-auto" />
          <div className="mt-5 font-pixel text-[12px] uppercase text-cream"><span className="cursor">{o.status === "AWAITING_PAYMENT" ? "awaiting payment" : o.kind === "merch" ? (o.fulfillment?.draft ? "paid · test mode: saved as a draft, not printed" : o.fulfillment?.status === "failed" ? "paid · the print order failed, the company has been notified" : o.fulfillment ? `paid · printing (${o.fulfillment.status})` : "paid · sending to print") : "paid — the agent will deliver during its next shift"}</span></div>
          <p className="mt-3 text-xs text-mute">{o.kind === "merch" ? "Tracking appears here when it ships (usually 2–7 days). " : ""}This page updates by itself.</p>
          <div className="mx-auto mt-6 h-2 max-w-xs overflow-hidden border border-line"><div className="h-full w-1/3 animate-[marquee_1.6s_steps(8)_infinite] bg-cream/70" /></div>
        </div>
      ) : (
        <div className="slide-in mt-8">
          <div className="mb-3 flex gap-2">
            {o.format === "html" && (
              <>
                <button className={`btn-ghost !py-1.5 ${view === "preview" ? "!border-cream text-cream" : ""}`} onClick={() => setView("preview")}>Preview</button>
                <button className={`btn-ghost !py-1.5 ${view === "source" ? "!border-cream text-cream" : ""}`} onClick={() => setView("source")}>Source</button>
              </>
            )}
            <button className="btn-acid ml-auto !py-1.5" onClick={download}>Download</button>
          </div>
          {o.format === "html" && view === "preview" ? (
            <iframe title="deliverable" sandbox="allow-scripts" srcDoc={o.deliverable ?? ""} className="crt-on h-[75vh] w-full border-2 border-line bg-white" />
          ) : o.format === "html" ? (
            <pre className="card max-h-[75vh] overflow-auto whitespace-pre-wrap p-6 font-mono text-[12px] text-cream-dim">{o.deliverable}</pre>
          ) : (
            <article className="card prose-fw max-h-[75vh] overflow-auto p-6 text-[14px] leading-relaxed text-cream-dim">
              <ReactMarkdown>{o.deliverable ?? ""}</ReactMarkdown>
            </article>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-mute">Bookmark this page — the link is your receipt.</p>
    </div>
  );
}
