import { AddVisit, type RouteKms } from "@/components/admin/today/add-visit";
import { loadDoorCounts, loadPropRows } from "@/lib/admin/props-data";
import { firstName } from "@/lib/admin/props";
import { defaultVisitDate } from "@/lib/admin/today";
import { canCanvass } from "@/lib/auth/roles";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add visit · nakolabs-d2d" };
// Allocating can make a prop's routes first (generateRouteAction); give it time.
export const maxDuration = 60;

/**
 * UI-10 F3d (owner A24; frames 16-17). `?date=` (default tomorrow, never in
 * the past), then `&prop=<id>` for the team step. Read with the admin's own
 * session; door counts stream in after the list renders.
 */
export default async function AddVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; prop?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
  const today = londonDate();
  const date = defaultVisitDate(params.date ?? null, today);

  const [loaded, people, open, routes] = await Promise.all([
    loadPropRows(supabase),
    supabase.from("profiles").select("id, full_name, role, active"),
    supabase.from("assignments").select("id, territory_id, work_date").is("closed_at", null).gte("work_date", today),
    supabase.from("territory_routes").select("territory_id, variant_key, total_m").in("variant_key", ["best", "best_reversed"]),
  ]);

  if (!loaded.ok || people.error || open.error) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <h1 className="text-admin-title">Add visit</h1>
        <p className="mt-2 text-admin-body text-ink-muted">Props could not be loaded. Check your signal, then try again.</p>
      </main>
    );
  }

  const openIds = (open.data ?? []).map((row) => row.id);
  const members = openIds.length
    ? await supabase.from("assignment_members").select("assignment_id, canvasser_id, left_at").in("assignment_id", openIds).is("left_at", null)
    : { data: [] as { assignment_id: string; canvasser_id: string; left_at: string | null }[] };
  const propName = new Map(loaded.rows.map((row) => [row.id, row.name] as const));
  const visitById = new Map((open.data ?? []).map((row) => [row.id, row] as const));
  const bookings = (members.data ?? []).flatMap((row) => {
    const visit = visitById.get(row.assignment_id);
    return visit ? [{ canvasserId: row.canvasser_id, workDate: visit.work_date, propName: propName.get(visit.territory_id) ?? "another prop" }] : [];
  });

  const routeKms: RouteKms = {};
  for (const row of routes.data ?? []) {
    const entry = (routeKms[row.territory_id] ??= {});
    if (row.variant_key === "best" || row.variant_key === "best_reversed") entry[row.variant_key] = Number(row.total_m);
  }

  return (
    <AddVisit
      today={today}
      date={date}
      rows={loaded.rows}
      doorCounts={loadDoorCounts(supabase, loaded.rows)}
      canvassers={(people.data ?? [])
        .filter((row) => canCanvass(row.role) && row.active)
        .map((row) => ({ id: row.id, name: firstName(row.full_name) }))}
      bookings={bookings}
      routeKms={routeKms}
      propId={params.prop ?? null}
    />
  );
}
