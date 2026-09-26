import { AllocateForm } from "@/components/admin/allocate-form";
import type { AllocationMember } from "@/components/admin/allocation-manage";
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

  const [{ data: territories }, { data: people }, { data: assignmentRows }, { data: variantRows }, { data: memberRows }] =
    await Promise.all([
    supabase
      .from("territories")
      .select("id, name")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, role, active")
      .order("full_name", { ascending: true }),
    supabase
      .from("assignments")
      .select(
        "id, territory_id, work_date, visit_number, entry_vertex_index, sweep_direction, slot, route_length_m, route_stranded_count, route_variant_key, closed_at, counts_for_rotation",
      )
      .order("work_date", { ascending: true }),
    supabase.from("territory_routes").select("territory_id, variant_key"),
    supabase.from("assignment_members").select("assignment_id, canvasser_id, left_at"),
  ]);

  // Same rule as allocate_prop: next visit_number is 1 + the highest
  // visit_number on this prop with counts_for_rotation. Admin SELECT on
  // assignments is assignments_all_admin, so this is that query, not a
  // second definition. An early end at or under the threshold does not count.
  const countingMax = new Map<string, number>();
  for (const row of assignmentRows ?? []) {
    if (!row.counts_for_rotation) continue;
    const prev = countingMax.get(row.territory_id) ?? 0;
    if (row.visit_number > prev) countingMax.set(row.territory_id, row.visit_number);
  }

  const names = new Map(
    (people ?? []).map((row) => [row.id, row.full_name?.trim() || "Unnamed canvasser"] as const),
  );
  const membersByAssignment = new Map<string, AllocationMember[]>();
  for (const row of memberRows ?? []) {
    const list = membersByAssignment.get(row.assignment_id) ?? [];
    list.push({
      canvasserId: row.canvasser_id,
      fullName: names.get(row.canvasser_id) ?? "Unnamed canvasser",
      leftAt: row.left_at,
    });
    membersByAssignment.set(row.assignment_id, list);
  }
  for (const list of membersByAssignment.values()) {
    list.sort((a, b) => {
      const aLeft = a.leftAt ? 1 : 0;
      const bLeft = b.leftAt ? 1 : 0;
      if (aLeft !== bLeft) return aLeft - bLeft;
      return a.fullName.localeCompare(b.fullName, "en-GB");
    });
  }

  const assignmentById = new Map((assignmentRows ?? []).map((row) => [row.id, row]));
  const bookings = (memberRows ?? []).flatMap((row) => {
    if (row.left_at) return [];
    const assignment = assignmentById.get(row.assignment_id);
    if (!assignment || assignment.closed_at) return [];
    return [
      {
        canvasserId: row.canvasser_id,
        workDate: assignment.work_date,
        assignmentId: row.assignment_id,
      },
    ];
  });

  return (
    <AllocateForm
      props={(territories ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        nextVisit: (countingMax.get(row.id) ?? 0) + 1,
      }))}
      canvassers={(people ?? []).flatMap((row) =>
        row.role === "canvasser" && row.active
          ? [{ id: row.id, fullName: row.full_name?.trim() || "Unnamed canvasser" }]
          : [],
      )}
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
            closedAt: row.closed_at,
            countsForRotation: row.counts_for_rotation,
            members: membersByAssignment.get(row.id) ?? [],
          },
        ];
      })}
      initialPropId={params.prop ?? null}
      bookings={bookings}
      savedVariants={(variantRows ?? []).map((row) => ({
        territoryId: row.territory_id,
        variantKey: row.variant_key,
      }))}
      signedInAs={profile?.full_name ?? user?.email ?? ""}
    />
  );
}
