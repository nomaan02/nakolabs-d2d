import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCoverageMap, type CoverageDoorCollection, type CoverageProp } from "@/lib/admin/coverage";
import { visitScope, type CoverageFilters, type CoverageRow, type CoverageVisit } from "@/lib/admin/coverage-filters";
import { addDays, firstName } from "@/lib/admin/props";
import { readAll, TooManyRows } from "@/lib/admin/read-all";
import type { Slot } from "@/lib/geo/rotation";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F4b (owner A32, A44; no migration, owner 2026-10-08). Everything the
 * rebuilt Coverage map needs, read on the server with the admin's own
 * session. Doors and props come from `coverage_map_payload` (live props,
 * knockable or already-knocked doors). Knocks are `v_latest_knock` rows,
 * narrowed in the database by person, days and visits where a filter says
 * so, then resolved per door in `resolveDoors`. Coverage stays derived.
 */

export type CoveragePerson = { id: string; name: string };

export type CoverageData =
  | {
      ok: true;
      doors: CoverageDoorCollection;
      props: CoverageProp[];
      visits: CoverageVisit[];
      rows: CoverageRow[];
      /** Who can be picked in the person filter (canvassers, plus anyone in the rows). */
      people: CoveragePerson[];
      /** `?prop=` names a prop that is not live (archived): its name, for the chip and the note. */
      missingProp: { id: string; name: string } | null;
    }
  | { ok: false; message: string; detail?: string; tooMany: boolean };

/** Up to this many visit ids are filtered in the database (`in.(…)` in the URL). */
const SCOPE_IN_DATABASE = 150;

function asSlot(value: string | null): Slot | null {
  return value === "early" || value === "mid" || value === "late" ? value : null;
}

export async function loadCoverage(supabase: SupabaseClient<Database>, filters: CoverageFilters): Promise<CoverageData> {
  const map = await fetchCoverageMap(supabase);
  if (!map.ok) return { ok: false, message: "Coverage didn't load. Check your signal, then try again.", detail: map.detail, tooMany: false };
  try {
    const live = new Set(map.payload.props.map((prop) => prop.id));
    const [assignments, people, missing] = await Promise.all([
      // Every visit (archived props' too, so Calendar's links always resolve), paged past 1,000.
      readAll((from, to) =>
        supabase.from("assignments").select("id, territory_id, visit_number, slot").order("id", { ascending: true }).range(from, to),
      ),
      supabase.from("profiles").select("id, full_name, role"),
      filters.prop && !live.has(filters.prop)
        ? supabase.from("territories").select("id, name").eq("id", filters.prop).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (people.error) throw new Error(people.error.message);
    if (missing.error) throw new Error(missing.error.message);

    const visits: CoverageVisit[] = assignments.map((row) => ({
      id: row.id,
      propId: row.territory_id,
      visitNumber: row.visit_number,
      slot: asSlot(row.slot),
    }));
    const scope = visitScope(visits, filters);

    let rows: CoverageRow[] = [];
    if (!scope || scope.size > 0) {
      const raw = await readAll((from, to) => {
        let query = supabase.from("v_latest_knock").select("assignment_id, uprn, outcome, canvasser_id, occurred_at");
        if (filters.who) query = query.eq("canvasser_id", filters.who);
        // A day either side: London days are decided in resolveDoors.
        if (filters.from) query = query.gte("occurred_at", `${addDays(filters.from, -1)}T00:00:00Z`);
        if (filters.to) query = query.lt("occurred_at", `${addDays(filters.to, 2)}T00:00:00Z`);
        // Short lists go to the database; a long one (a visit number across every prop) would
        // overflow the URL, so those rows are narrowed by `resolveDoors` instead.
        if (scope && scope.size <= SCOPE_IN_DATABASE) query = query.in("assignment_id", [...scope]);
        return query.order("assignment_id", { ascending: true }).order("uprn", { ascending: true }).range(from, to);
      });
      // Offset paging while phones sync can return a row twice: keep one per door per visit.
      const seen = new Set<string>();
      rows = raw.flatMap((row) => {
        if (!row.assignment_id || row.uprn === null || !row.outcome || !row.canvasser_id || !row.occurred_at) return [];
        const key = `${row.assignment_id}|${row.uprn}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ assignmentId: row.assignment_id, uprn: row.uprn, outcome: row.outcome, canvasserId: row.canvasser_id, occurredAt: row.occurred_at }];
      });
    }

    const knockers = new Set(rows.map((row) => row.canvasserId));
    if (filters.who) knockers.add(filters.who);
    const list: CoveragePerson[] = (people.data ?? [])
      .filter((row) => row.role === "canvasser" || knockers.has(row.id))
      .map((row) => ({ id: row.id, name: firstName(row.full_name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

    return {
      ok: true,
      doors: map.payload.doors,
      props: map.payload.props,
      visits,
      rows,
      people: list,
      // Archived: its name. Gone altogether (an old link): still shown, so the filter can be removed.
      missingProp: !filters.prop || live.has(filters.prop) ? null : { id: filters.prop, name: missing.data?.name ?? "Unknown prop" },
    };
  } catch (caught) {
    return {
      ok: false,
      tooMany: caught instanceof TooManyRows,
      message:
        caught instanceof TooManyRows
          ? "That's too many knocks to show at once. Pick fewer days or one prop."
          : "Coverage didn't load. Check your signal, then try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
