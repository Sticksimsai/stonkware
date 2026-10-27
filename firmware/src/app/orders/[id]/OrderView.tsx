"use client";
import { useEffect, useState } from "react";

type O = { id: string; status: string; format: string; deliverable: string | null };

export default function OrderView({ initial }: { initial: O }) {
  const [o, setO] = useState(initial);
  const [view, setView] = useState<"preview" | "source">("preview");

  useEffect(() => {
    if (o.status === "DELIVERED" || o.status === "FAILED") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/orders/${o.id}`, { cache: "no-store" });
      if (r.ok) setO(await r.json());
    }, 4000);
    return () => clearInterval(t);
  }, [o.id, o.status]);

  if (o.status !== "DELIVERED")
    return (
      <div className="card p-10 text-center">
        <div className="cursor font-mono text-sm text-cream-dim">{o.status === "AWAITING_PAYMENT" ? "awaiting payment" : "paid — the agent will deliver during its next shift"}</div>
        <p className="mt-3 text-xs text-mute">This page updates automatically.</p>
      </div>
    );

  const download = () => {
    const blob = new Blob([o.deliverable ?? ""], { type: o.format === "html" ? "text/html" : "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deliverable-${o.id.slice(-6)}.${o.format === "html" ? "html" : "md"}`;
    a.click();
  };

  return (
    <div>
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
        // sandboxed: scripts may run for interactive tools, but no same-origin access
        <iframe title="deliverable" sandbox="allow-scripts" srcDoc={o.deliverable ?? ""} className="h-[75vh] w-full border border-line bg-white" />
      ) : (
        <pre className="card max-h-[75vh] overflow-auto whitespace-pre-wrap p-6 font-mono text-[13px] leading-relaxed text-cream-dim">{o.deliverable}</pre>
      )}
    </div>
  );
}
