"use client";
import { useEffect } from "react";
import CompanyView from "@/components/CompanyView";
import { BuildingFirmware, FlagshipHero, useFlagship } from "@/components/Flagship";
import { ErrorBox, Skeleton } from "@/components/ui";

export default function FirmwarePage() {
  const { data: f, error, reload } = useFlagship();
  useEffect(() => { if (f) document.title = `$${f.ticker} — the Stonkware token`; }, [f]);
  if (error && !f) return <div className="wrap py-16"><ErrorBox message={error === "no flagship yet" ? "The Stonkware token page opens soon." : error} onRetry={reload} /></div>;
  if (!f) return <div className="wrap space-y-4 py-10"><Skeleton h={320} /><Skeleton h={420} /></div>;
  return (
    <div className="page-enter">
      <FlagshipHero f={f} />
      <BuildingFirmware f={f} />
      <div id="live" className="wrap scroll-mt-20 py-10">
        <CompanyView slug={f.slug} embedded />
      </div>
    </div>
  );
}
