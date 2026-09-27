/**
 * Stage 5b (R2) — save a prop's route variants.
 *
 *   read   route_walk_inputs(territory)      (019, RLS: admin)
 *   plan   generateWalk(inputs)               (R1, pure TypeScript)
 *   write  territory_routes_save(territory, variants)   (020, one transaction)
 *
 * Runs under the ADMIN'S OWN SESSION. Never the service role. Nothing here
 * touches an assignment: variants belong to the prop and are copied onto an
 * assignment by `freezeAssignmentRoute`.
 *
 * The generator's output is sent as-is minus `tree` (a verification aid).
 * Field names are the ones in lib/geo/walk/types.ts; the SQL reads exactly
 * those.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { generateWalk } from "@/lib/geo/walk/generate";
import { fetchWalkInputs } from "@/lib/geo/walk/inputs";
import type { WalkResult, WalkVariant } from "@/lib/geo/walk/types";
import {
  describeGeometryIssues,
  validateWalkResult,
  type GeometryIssue,
} from "@/lib/geo/walk/validate";

export type SaveRoutesFailureCode =
  | "not_admin"
  | "missing_territory"
  | "no_route"
  | "save_rejected"
  | "unavailable";

export type SaveRoutesSummary = {
  territoryId: string;
  variants: number;
  steps: number;
  keys: string[];
  doors: number;
  strandedCount: number;
  bestTotalM: number;
  generateMs: number;
};

export type SaveRoutesResult =
  | { ok: true; summary: SaveRoutesSummary; result: WalkResult; issues: GeometryIssue[] }
  | { ok: false; code: SaveRoutesFailureCode; message: string; detail?: string };

/** Preview is the same read-and-generate path as save, with no `territory_routes_save` call. */
export type PreviewRoutesResult =
  | { ok: true; result: WalkResult; issues: GeometryIssue[] }
  | { ok: false; code: SaveRoutesFailureCode; message: string; detail?: string };

const NO_ROUTE = "No road near this prop has a door on it, so no route could be drawn.";

const SERVER_HINTS: Record<string, SaveRoutesFailureCode> = {
  not_admin: "not_admin",
  missing_territory: "missing_territory",
  no_variants: "no_route",
  bad_variant: "save_rejected",
  bad_steps: "save_rejected",
  duplicate_uprn: "save_rejected",
  bad_stranded_count: "save_rejected",
};

function describe(error: PostgrestError): string {
  return [error.code, error.hint, error.message, error.details].filter(Boolean).join(" | ");
}

function mapRpcError(error: PostgrestError): Extract<SaveRoutesResult, { ok: false }> {
  const code = SERVER_HINTS[error.hint ?? ""];
  if (code) return { ok: false, code, message: error.message, detail: error.details ?? undefined };
  if (error.code === "42501") {
    return { ok: false, code: "not_admin", message: "Only an admin can save routes.", detail: error.message };
  }
  return { ok: false, code: "unavailable", message: "The routes could not be saved.", detail: describe(error) };
}

/** The document `territory_routes_save` stores: the variant without its verification aids (`tree`, `walk_meta`). */
export function variantForStorage(v: WalkVariant): Json {
  const { tree: _tree, walk_meta: _walk_meta, ...rest } = v;
  void _tree;
  void _walk_meta;
  return rest as unknown as Json;
}

/**
 * Reads the prop and generates every variant. No write.
 * Never throws. `supabase` must carry the admin's own session.
 */
async function generateForTerritory(
  supabase: SupabaseClient<Database>,
  territoryId: string,
  thrownMessage: string,
): Promise<PreviewRoutesResult> {
  try {
    const fetched = await fetchWalkInputs(supabase, territoryId);
    if (!fetched.ok) return { ok: false, code: fetched.code, message: fetched.message, detail: fetched.detail };

    const result = generateWalk(fetched.inputs);
    if (result.variants.length === 0) return { ok: false, code: "no_route", message: NO_ROUTE };
    return { ok: true, result, issues: validateWalkResult(result) };
  } catch (err) {
    return {
      ok: false,
      code: "unavailable",
      message: thrownMessage,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Preview only: `route_walk_inputs` then `generateWalk`. Does not call
 * `territory_routes_save`. The draw page renders this `WalkResult` directly.
 */
export async function previewTerritoryRoutes(
  supabase: SupabaseClient<Database>,
  territoryId: string,
): Promise<PreviewRoutesResult> {
  return generateForTerritory(supabase, territoryId, "The route could not be generated.");
}

/**
 * Generates every variant for a prop and replaces its saved set. Never
 * throws. `supabase` must carry the admin's own session.
 */
export async function saveTerritoryRoutes(
  supabase: SupabaseClient<Database>,
  territoryId: string,
): Promise<SaveRoutesResult> {
  const preview = await generateForTerritory(supabase, territoryId, "The routes could not be saved.");
  if (!preview.ok) return preview;

  if (preview.issues.length > 0) {
    console.warn(`[route geometry] ${territoryId}: ${describeGeometryIssues(preview.issues)}`);
  }

  try {
    const result = preview.result;
    const { data, error } = await supabase.rpc("territory_routes_save", {
      p_territory_id: territoryId,
      p_variants: result.variants.map(variantForStorage),
    });
    if (error) return mapRpcError(error);

    const saved = (data ?? {}) as { variants?: number; steps?: number; keys?: string[] };
    const best = result.variants[0];
    return {
      ok: true,
      result,
      issues: preview.issues,
      summary: {
        territoryId,
        variants: saved.variants ?? result.variants.length,
        steps: saved.steps ?? result.variants.reduce((n, v) => n + v.steps.length, 0),
        keys: saved.keys ?? result.variants.map((v) => v.key),
        doors: result.doors,
        strandedCount: result.stranded_count,
        bestTotalM: best.total_m,
        generateMs: result.timings.total_ms,
      },
    };
  } catch (err) {
    return {
      ok: false,
      code: "unavailable",
      message: "The routes could not be saved.",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
