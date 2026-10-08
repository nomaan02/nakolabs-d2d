import { PastVisitsReview } from "@/components/admin/today/past-visits-review";
import { TodayFailed } from "@/components/admin/today/today-screen";
import { loadToday } from "@/lib/admin/today-data";
import { staleVisits } from "@/lib/admin/today";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Past visits · nakolabs-d2d" };

/** UI-10 F3d (owner A27; frames 18-19): close every open visit dated before today. */
export default async function PastVisitsPage() {
  const supabase = await createClient();
  const today = londonDate();
  const loaded = await loadToday(supabase, today);
  if (!loaded.ok) return <TodayFailed today={today} message={loaded.message} />;
  const stale = staleVisits(loaded.visits, today);
  const figures = Object.fromEntries(stale.flatMap((visit) => (loaded.figures[visit.id] ? [[visit.id, loaded.figures[visit.id]!]] : [])));
  return <PastVisitsReview visits={stale} figures={figures} />;
}
