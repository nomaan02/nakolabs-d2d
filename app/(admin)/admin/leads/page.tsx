import { LeadsScreen } from "@/components/admin/leads/leads-screen";
import { PageFailed } from "@/components/admin/ui/page-failed";
import { parseStatusFilter } from "@/lib/admin/leads";
import { loadLeads } from "@/lib/admin/leads-data";
import { parseTeamPeriod, periodWindow } from "@/lib/admin/team";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads · nakolabs-d2d" };

/**
 * UI-10 F5d (frame 21). `?period=week|4w|all` (default this week) picks the
 * leads read; `?status=` is the chip, kept in the URL by the screen.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ period?: string; status?: string }> }) {
  const params = await searchParams;
  const today = londonDate();
  const period = parseTeamPeriod(params.period);
  const supabase = await createClient();
  const loaded = await loadLeads(supabase, periodWindow(period, today));
  if (!loaded.ok) return <PageFailed title="Leads" message={loaded.message} />;
  return <LeadsScreen key={period} period={period} today={today} items={loaded.items} initialStatus={parseStatusFilter(params.status)} />;
}
