import { CoverageFailed, CoverageScreen } from "@/components/admin/coverage/coverage-screen";
import { loadCoverage } from "@/lib/admin/coverage-data";
import { parseCrmView } from "@/lib/admin/crm-map";
import { filtersHref, parseFilters, periodOf, resolveDoors } from "@/lib/admin/coverage-filters";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coverage · nakolabs-d2d" };

/**
 * UI-10 F4d (owner A32, A33, A44). Coverage: the filters live in the URL
 * (`prop`, `date` or `from`/`to` or `period=all`, `visit`, `slot`,
 * `outcome`, `who`, and `via=calendar` for the way back). Props' "Show on
 * Coverage" sends `?prop=`. Which knock paints each door is worked out here,
 * so only one row per door reaches the browser. The old Coverage components
 * stay on disk until F6.
 */
/** Offer "the last 7 days" only when it really is fewer days than the view that failed. */
function longerThanAWeek(from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 7;
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = londonDate();
  const params = await searchParams;
  const filters = parseFilters(params, today);
  // CRM-2 D (owner 2026-10-10): the CRM layer (`crm=`), read in the browser when switched on.
  const crmView = parseCrmView(params.crm);
  const supabase = await createClient();
  const loaded = await loadCoverage(supabase, filters);

  if (!loaded.ok) {
    return (
      <CoverageFailed
        message={loaded.message}
        narrower={loaded.tooMany && longerThanAWeek(filters.from, filters.to) ? filtersHref({ ...filters, ...periodOf("7", today) }, today) : null}
      />
    );
  }

  const { worked } = resolveDoors(loaded.rows, loaded.visits, filters);

  return (
    <CoverageScreen
      today={today}
      filters={filters}
      doors={loaded.doors}
      props={loaded.props}
      visits={loaded.visits}
      worked={[...worked.values()]}
      people={loaded.people}
      missingProp={loaded.missingProp}
      folder={loaded.folder}
      crmView={crmView}
    />
  );
}
