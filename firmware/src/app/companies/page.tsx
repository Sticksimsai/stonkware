import { listCompanies } from "@/lib/queries";
import CompanyTable from "@/components/CompanyTable";

export const dynamic = "force-dynamic";

export default async function Companies() {
  const rows = await listCompanies();
  return (
    <div className="wrap py-12">
      <h1 className="text-3xl font-display font-bold text-cream glow">Companies</h1>
      <p className="mt-2 text-soft">{rows.length} live. Ranked by creator fees + revenue.</p>
      <div className="mt-6"><CompanyTable rows={rows} /></div>
    </div>
  );
}
