import { CalendarFailed, CalendarScreen } from "@/components/admin/calendar/calendar-screen";
import { buildCalendar, parseDay, parseMonth } from "@/lib/admin/calendar";
import { loadCalendarMonth } from "@/lib/admin/calendar-data";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar · nakolabs-d2d" };

/**
 * UI-10 F4c (owner A38-A46). Calendar: `?month=2026-10` picks the month
 * (default this month), `?day=2026-10-01` opens that day's visits.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string }>;
}) {
  const params = await searchParams;
  const today = londonDate();
  const month = parseMonth(params.month, today);
  const supabase = await createClient();
  const loaded = await loadCalendarMonth(supabase, month);

  if (!loaded.ok) return <CalendarFailed message={loaded.message} />;

  // Built here so only the day entries reach the browser, never the knock rows.
  const days = buildCalendar({
    knocks: loaded.knocks,
    visits: loaded.visits,
    leads: loaded.leads,
    names: new Map(Object.entries(loaded.names)),
    today,
  });

  return <CalendarScreen key={month} month={month} today={today} initialDay={parseDay(params.day)} entries={Object.fromEntries(days)} />;
}
