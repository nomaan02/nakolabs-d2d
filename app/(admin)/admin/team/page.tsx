import { TeamScreen } from "@/components/admin/team/team-screen";
import { PageFailed } from "@/components/admin/ui/page-failed";
import { parseTeamPeriod, parseTeamSort, periodLine, periodWindow, personStats, teamRows } from "@/lib/admin/team";
import { loadTeam } from "@/lib/admin/team-data";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team · nakolabs-d2d" };

/**
 * UI-10 F5c (owner A9, A34; frame 20). `?period=week|4w|all` (default this
 * week), `?sort=` the card order. The numbers are worked out here; only one
 * row per person reaches the browser.
 */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ period?: string; sort?: string }> }) {
  const params = await searchParams;
  const today = londonDate();
  const period = parseTeamPeriod(params.period);
  const window = periodWindow(period, today);
  const supabase = await createClient();
  const loaded = await loadTeam(supabase, window);
  if (!loaded.ok) return <PageFailed title="Team" message={loaded.message} />;

  const rows = teamRows(loaded.people, personStats(loaded.knocks, loaded.leads, window));
  return <TeamScreen period={period} periodText={periodLine(period, today)} rows={rows} initialSort={parseTeamSort(params.sort)} />;
}
