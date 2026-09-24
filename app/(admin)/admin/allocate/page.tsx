import { AllocateForm } from "@/components/admin/allocate-form";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import type { Slot, SweepDirection } from "@/lib/geo/rotation";

export const metadata = { title: "Allocate · nakolabs-d2d" };

// Stage 5b: the route generator runs as a server action from this page after
// allocation (R2: freeze a saved variant, generating and saving the prop's
// variant set first when it has none). Northville (1,225 doors) is sized to
// finish well inside 30 s; the platform default would cut it off before that.
export const maxDuration = 60;

function isSweep(value: string): value is SweepDirection {
  return value === "cw" || value === "ccw";
}

function isSlot(value: string): value is Slot {
  return value === "early" || value === "mid" || value === "late";
}

export default async function AllocatePage({
  searchParams,
}: {
  searchParams: Promise<{ prop?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;
  const params = await searchParams;

  const [{ data: territories }, { data: people }, { data: assignmentRows }, { data: variantRows }] =
    await Promise.all([
    supabase
      .from("territories")
      .select("id, name")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "canvasser")
      .eq("active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("assignments")
      .select(
        "id, territory_id, work_date, visit_number, entry_vertex_index, sweep_direction, slot, route_length_m, route_stranded_count, route_variant_key",
      )
      .order("work_date", { ascending: true }),
    supabase.from("territory_routes").select("territory_id, variant_key"),
  ]);

  // Stage 5b-R2: visit_number is 1 + the prop's existing assignments (the
  // count allocate_prop takes under its row lock), not territories.visit_count,
  // which nothing increments before Stage 12b. Every assignment is loaded
  // above, so the count is taken from the same rows the list shows.
  const allocationCounts = new Map<string, number>();
  for (const row of assignmentRows ?? []) {
    allocationCounts.set(row.territory_id, (allocationCounts.get(row.territory_id) ?? 0) + 1);
  }

  return (
    <AllocateForm
      props={(territories ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        allocationCount: allocationCounts.get(row.id) ?? 0,
      }))}
      canvassers={(people ?? []).map((row) => ({
        id: row.id,
        fullName: row.full_name?.trim() || "Unnamed canvasser",
      }))}
      allocations={(assignmentRows ?? []).flatMap((row) => {
        if (!isSweep(row.sweep_direction) || !isSlot(row.slot)) return [];
        return [
          {
            id: row.id,
            territoryId: row.territory_id,
            workDate: row.work_date,
            visitNumber: row.visit_number,
            entryVertexIndex: row.entry_vertex_index,
            sweepDirection: row.sweep_direction,
            slot: row.slot,
            // route_length_m is written in the same UPDATE as route_geom, so
            // it stands in for "route_geom is not null" without shipping the line.
            routeLengthM: row.route_length_m,
            routeStrandedCount: row.route_stranded_count,
            routeVariantKey: row.route_variant_key,
          },
        ];
      })}
      initialPropId={params.prop ?? null}
      savedVariants={(variantRows ?? []).map((row) => ({
        territoryId: row.territory_id,
        variantKey: row.variant_key,
      }))}
      signedInAs={profile?.full_name ?? user?.email ?? ""}
    />
  );
}
