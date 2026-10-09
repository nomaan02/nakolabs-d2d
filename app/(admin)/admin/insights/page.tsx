import { InsightsScreen } from "@/components/admin/insights/insights-screen";
import { PageFailed } from "@/components/admin/ui/page-failed";
import { completionRows, leadOutcomeBars, slotRows, staleRows, staleTitle, weekColumns, weekTotals, weeklyRows } from "@/lib/admin/insights";
import { loadInsights } from "@/lib/admin/insights-data";
import { longDate } from "@/lib/admin/today";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights · nakolabs-d2d" };

/**
 * UI-10 F5d (owner A48, A50). Insights replaces the old dashboard. The
 * charts' figures are worked out here from `admin_dashboard` and the lead
 * statuses; the browser gets the figures only.
 */
export default async function InsightsPage() {
  const today = londonDate();
  const supabase = await createClient();
  const loaded = await loadInsights(supabase);
  if (!loaded.ok) return <PageFailed title="Insights" message={loaded.message} />;

  const { payload } = loaded;
  const weeks = weekColumns(today);
  const weekly = weeklyRows(payload.worked_per_week, weeks);
  const leads = leadOutcomeBars(loaded.leadStatuses);
  return (
    <InsightsScreen
      asOf={longDate(payload.as_of)}
      weeks={weeks}
      weekTotals={weekTotals(weekly.rows, weeks)}
      weekly={weekly.rows}
      weeklyPeak={weekly.peak}
      slots={slotRows(payload.answer_by_slot)}
      leads={leads.bars}
      leadTotal={leads.total}
      completion={completionRows(payload.coverage)}
      stale={staleRows(payload.props_last_visit)}
      staleTitle={staleTitle(payload.stale_weeks)}
    />
  );
}
