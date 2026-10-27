import Link from "next/link";
import type { CompanyRow } from "@/lib/queries";
import { ago, fmtSol } from "@/lib/units";
import { Avatar } from "./ui";

export default function CompanyTable({ rows }: { rows: CompanyRow[] }) {
  if (!rows.length)
    return <div className="card p-8 text-center text-sm text-mute">No companies yet. <Link href="/launch" className="link text-cream">Launch the first one →</Link></div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b-2 border-line text-left">
            {["#", "Company", "Mind", "Creator fees", "Revenue", "Compute", "Agent"].map((h) => <th key={h} className="label px-4 py-3 font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y-2 divide-line">
          {rows.map((c, i) => {
            const asleep = !c.working && c.sleepingUntil && c.sleepingUntil.getTime() > Date.now();
            return (
              <tr key={c.id} className="hover:bg-cream/[0.03]">
                <td className="num px-4 py-3 text-mute">{i + 1}</td>
                <td className="max-w-[280px] px-4 py-3">
                  <Link href={`/c/${c.slug}`} className="flex items-center gap-3">
                    <Avatar id={c.id} ticker={c.ticker} hasImage={c.hasImage} size={32} />
                    <div className="min-w-0">
                      <div className="font-medium text-cream">{c.name} <span className="font-mono text-xs text-mute">${c.ticker}</span></div>
                      <div className="truncate text-xs text-mute">{c.tagline}</div>
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-cyan">{c.modelLabel}</td>
                <td className="num px-4 py-3">{fmtSol(c.lifetimeFees)}</td>
                <td className="num px-4 py-3">{fmtSol(c.lifetimeRevenue)}</td>
                <td className="num px-4 py-3 text-mute">{fmtSol(c.lifetimeCompute, 4)}</td>
                <td className="px-4 py-3 font-mono text-[11px]">
                  {c.working ? <span className="glow text-cyan"><span className="flicker">●</span> working</span>
                    : asleep ? <span className="text-mute">● asleep</span>
                    : <span className="text-soft">● idle{c.lastRunAt ? ` · ${ago(c.lastRunAt)}` : ""}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
