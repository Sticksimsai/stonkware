"use client";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CompanyRow } from "@/lib/types";
import CompanyTable from "@/components/CompanyTable";
import { ErrorBox, Skeleton } from "@/components/ui";
import { Glitch } from "@/components/motion";

export default function Companies() {
  const { data, error, reload } = useApi<CompanyRow[]>("/api/companies", 20000);
  const [q, setQ] = useState("");
  const [onlyWorking, setOnlyWorking] = useState(false);
  const rows = useMemo(() => (data ?? []).filter((c) =>
    (!onlyWorking || c.working) && (!q || `${c.name} ${c.ticker} ${c.tagline} ${c.modelLabel}`.toLowerCase().includes(q.toLowerCase()))), [data, q, onlyWorking]);
  return (
    <div className="wrap page-enter py-12">
      <h1 className="text-3xl font-display font-bold text-cream glow"><Glitch text="Companies" /></h1>
      <p className="mt-2 text-soft">{data ? `${data.length} live. Ranked by trading fees + revenue.` : "Loading…"}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input className="input sm:max-w-sm" placeholder="Search name, ticker, model…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`btn-ghost ${onlyWorking ? "!border-cyan text-cyan" : ""}`} onClick={() => setOnlyWorking(!onlyWorking)}>
          <span className={onlyWorking ? "flicker" : ""}>●</span> working now
        </button>
      </div>
      <div className="mt-6">
        {error && !data ? <ErrorBox message={error} onRetry={reload} /> : data ? <CompanyTable rows={rows} /> : <Skeleton h={360} />}
      </div>
    </div>
  );
}
