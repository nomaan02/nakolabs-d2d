import { AllocateForm } from "@/components/admin/allocate-form";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import type { Slot, SweepDirection } from "@/lib/geo/rotation";

export const metadata = { title: "Allocate · nakolabs-d2d" };

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

  const [{ data: territories }, { data: people }, { data: assignmentRows }] = await Promise.all([
    supabase
      .from("territories")
      .select("id, name, visit_count")
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
      .select("id, territory_id, work_date, visit_number, entry_vertex_index, sweep_direction, slot")
      .order("work_date", { ascending: true }),
  ]);

  return (
    <AllocateForm
      props={(territories ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        visitCount: row.visit_count,
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
          },
        ];
      })}
      initialPropId={params.prop ?? null}
      signedInAs={profile?.full_name ?? user?.email ?? ""}
    />
  );
}
