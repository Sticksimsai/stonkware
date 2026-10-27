"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WakeButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  const router = useRouter();
  return (
    <div>
      <button className="btn-ghost w-full" disabled={busy} onClick={async () => {
        setBusy(true); setOut("");
        try {
          const r = await fetch(`/api/dev/tick/${id}`, { method: "POST" });
          const j = await r.json();
          setOut(r.ok ? `+${(j.claimed / 1e9).toFixed(4)} SOL simulated fees · ${j.started ? "shift started" : "already working"}` : j.error);
          router.refresh();
        } finally { setBusy(false); }
      }}>
        {busy ? "…" : "Simulate fees + wake agent (mock)"}
      </button>
      {out && <p className="mt-2 font-mono text-[11px] text-mute">{out}</p>}
    </div>
  );
}
