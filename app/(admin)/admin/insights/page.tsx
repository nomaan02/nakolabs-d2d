import { CrmSection } from "@/components/admin/insights/crm-section";
import { InsightsFrame, InsightsScreen } from "@/components/admin/insights/insights-screen";
import { PageFailed } from "@/components/admin/ui/page-failed";
import { completionRows, leadOutcomeBars, slotRows, staleRows, staleTitle, weekColumns, weekTotals, weeklyRows } from "@/lib/admin/insights";
import {
  CRM_PERIODS,
  areaRankings,
  confirmedByDay,
  crmHref,
  crmWindow,
  crmWindowLine,
  heroFigures,
  leadSplit,
  longerPeriod,
  minLeadsForAreas,
  outcomeColumns,
  parseCrmPeriod,
  parseInsightsView,
  periodOptions,
  propRows,
  rateFigures,
} from "@/lib/admin/crm-insights";
import { loadCrmInsights } from "@/lib/admin/crm-data";
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
 * CRM-2 C (Figma CRM-2 C1–C9, D1 approved 2026-10-10): `view=crm` shows the
 * Company CRM view instead, its period in `crm=` (Last 12 months when
 * absent), read from `crm_insights`. Only the chosen view's data is read.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = londonDate();
  const params = await searchParams;
  const supabase = await createClient();

  if (parseInsightsView(params.view) === "crm") {
    const period = parseCrmPeriod(params.crm);
    const window = crmWindow(period, today);
    const crm = await loadCrmInsights(supabase, window);
    const longer = longerPeriod(period);
    const areaMin = minLeadsForAreas(period);
    return (
      <InsightsFrame view="crm" line={null}>
        <CrmSection
          today={today}
          period={period}
          periodLabel={CRM_PERIODS.find((p) => p.value === period)?.label ?? ""}
          windowLine={crmWindowLine(period, window, today)}
          periods={periodOptions(today)}
          booked={crm.ok ? confirmedByDay(crm.data.confirmed) : []}
          bookedCount={crm.ok ? crm.data.confirmed.length : 0}
          failed={crm.ok ? null : crm.message}
          longer={longer ? { label: `Show ${CRM_PERIODS.find((p) => p.value === longer)?.label.toLowerCase()}`, href: crmHref(longer) } : null}
          data={
            crm.ok
              ? {
                  hero: heroFigures(crm.data.totals),
                  rates: rateFigures(crm.data.totals),
                  split: leadSplit(crm.data.totals),
                  totals: crm.data.totals,
                  columns: outcomeColumns(crm.data, window, today),
                  byDay: window.byDay && crm.data.days !== null,
                  areas: areaRankings(crm.data.sectors, areaMin),
                  areaMin,
                  props: propRows(crm.data.props),
                }
              : null
          }
        />
      </InsightsFrame>
    );
  }

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
