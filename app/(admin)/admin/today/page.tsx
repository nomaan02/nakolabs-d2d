import { TodayFailed, TodayScreen } from "@/components/admin/today/today-screen";
import { loadToday } from "@/lib/admin/today-data";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today · nakolabs-d2d" };

/**
 * UI-10 F3 (owner A17, A24-A27, A36). Today: needs attention, today's
 * numbers and the schedule by date. `?visit=<id>` opens a visit.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ visit?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
  const today = londonDate();
  const loaded = await loadToday(supabase, today);

  if (!loaded.ok) return <TodayFailed today={today} message={loaded.message} />;

  return (
    <TodayScreen
      today={today}
      serverNow={Date.now()}
      visits={loaded.visits}
      figures={loaded.figures}
      props={loaded.props}
      canvassers={loaded.canvassers}
      initialVisitId={params.visit ?? null}
    />
  );
}
