/**
 * Stage 5b — the route generator, end to end.
 *
 *   read   route_clipped_subgraph(assignment)   (RLS: admin)
 *   plan   buildRoutePlan(inputs, rotation)      (pure TypeScript)
 *   write  route_commit(...)                     (RLS: admin; one transaction)
 *
 * Runs under the ADMIN'S OWN SESSION. Never the service role.
 *
 * Fail open. Allocation has already succeeded by the time this runs; on any
 * failure — no roads, frozen, RPC error, safety bound, exception — the
 * assignment is left exactly as allocate_prop made it and the caller gets a
 * notice, never a throw. "Is this route-derived?" stays a per-assignment fact:
 * route_geom is not null.
 *
 * The freeze principle: an assignment with any knock_events is refused here
 * before any work, and again inside route_commit in the write transaction.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { rotationForVisit, type Rotation } from "@/lib/geo/rotation";
import { parseRouteInputs, type RouteInputs } from "@/lib/geo/route-graph";
import { buildRoutePlan, type RoutePlan } from "@/lib/geo/route-plan";

export type RouteFailureCode =
  | "not_admin"
  | "missing_assignment"
  | "frozen"
  | "no_roads"
  | "polygon_changed"
  | "bound_hit"
  | "commit_rejected"
  | "unavailable";

export type RouteTimings = {
  clipMs: number;
  traversalMs: number;
  snapOrderMs: number;
  commitMs: number;
  totalMs: number;
};

export type RouteSummary = {
  assignmentId: string;
  steps: number;
  workingSteps: number;
  routeLengthM: number;
  doors: number;
  strandedCount: number;
  clippedSegments: number;
  components: number;
  backtracks: number;
  transfers: number;
  entryNodeId: number;
};

export type RouteGenerationResult =
  | { ok: true; summary: RouteSummary; timings: RouteTimings }
  | { ok: false; code: RouteFailureCode; message: string; detail?: string; timings?: RouteTimings };

const NOTICE_TAIL = " The door order is the interim sweep.";

const SERVER_HINTS: Record<string, RouteFailureCode> = {
  not_admin: "not_admin",
  missing_assignment: "missing_assignment",
  frozen: "frozen",
  snapshot_mismatch: "commit_rejected",
  duplicate_uprn: "commit_rejected",
  bad_stranded_count: "commit_rejected",
  bad_route: "commit_rejected",
  bad_steps: "commit_rejected",
};

function mapRpcError(error: PostgrestError, fallback: string): Extract<RouteGenerationResult, { ok: false }> {
  const hint = error.hint ?? "";
  const code = SERVER_HINTS[hint];
  if (code) {
    return {
      ok: false,
      code,
      message: code === "frozen" ? error.message : `${error.message}${NOTICE_TAIL}`,
      detail: error.details ?? undefined,
    };
  }
  if (error.code === "42501") {
    return { ok: false, code: "not_admin", message: "Only an admin can generate a route.", detail: error.message };
  }
  return {
    ok: false,
    code: "unavailable",
    message: `${fallback}${NOTICE_TAIL}`,
    detail: [error.code, error.hint, error.message, error.details].filter(Boolean).join(" | "),
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Phase 1. The clipped subgraph and every other input, from one RPC. */
export async function fetchRouteInputs(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<{ ok: true; inputs: RouteInputs } | Extract<RouteGenerationResult, { ok: false }>> {
  const { data, error } = await supabase.rpc("route_clipped_subgraph", {
    p_assignment_id: assignmentId,
  });
  if (error) return mapRpcError(error, "The road network could not be read.");
  if (data === null || data === undefined) {
    return {
      ok: false,
      code: "missing_assignment",
      message: "That assignment could not be found.",
    };
  }
  try {
    return { ok: true, inputs: parseRouteInputs(data) };
  } catch (err) {
    return {
      ok: false,
      code: "unavailable",
      message: `The road network could not be read.${NOTICE_TAIL}`,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Phase 3. One transaction; refuses a worked assignment; verifies the snapshot multiset. */
export async function commitRoutePlan(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  plan: RoutePlan,
): Promise<{ ok: true } | Extract<RouteGenerationResult, { ok: false }>> {
  const { error } = await supabase.rpc("route_commit", {
    p_assignment_id: assignmentId,
    p_steps: plan.steps as unknown as Json,
    p_route_wkt: plan.routeWkt,
    p_route_length_m: plan.routeLengthM,
    p_snapshot: plan.snapshot,
    p_stranded_count: plan.strandedCount,
  });
  if (error) return mapRpcError(error, "The route could not be saved.");
  return { ok: true };
}

/**
 * The rotation this assignment was allocated under, recomputed from
 * lib/geo/rotation.ts against the CURRENT polygon. If the corner count has
 * changed since allocation the frozen entry vertex no longer means anything,
 * so the generator declines rather than guess.
 */
export function rotationForInputs(inputs: RouteInputs): { ok: true; rotation: Rotation } | { ok: false; reason: string } {
  const rotation = rotationForVisit(inputs.visitNumber, inputs.ring.length);
  if (
    rotation.entryVertexIndex !== inputs.entryVertexIndex ||
    rotation.sweepDirection !== inputs.sweepDirection
  ) {
    return {
      ok: false,
      reason:
        `rotationForVisit(${inputs.visitNumber}, ${inputs.ring.length}) gives vertex ` +
        `${rotation.entryVertexIndex} ${rotation.sweepDirection}; the assignment froze vertex ` +
        `${inputs.entryVertexIndex} ${inputs.sweepDirection}`,
    };
  }
  return { ok: true, rotation };
}

export function summarise(assignmentId: string, plan: RoutePlan): RouteSummary {
  return {
    assignmentId,
    steps: plan.steps.length,
    workingSteps: plan.workingSteps,
    routeLengthM: plan.routeLengthM,
    doors: plan.snapshot.length,
    strandedCount: plan.strandedCount,
    clippedSegments: plan.graph.segments.length,
    components: plan.graph.componentCount,
    backtracks: plan.traversal.backtracks,
    transfers: plan.traversal.transfers,
    entryNodeId: plan.entryNodeId,
  };
}

/**
 * Generates and commits the route for one assignment. Never throws.
 *
 * `supabase` must carry the admin's own session. `dryRun` builds the plan and
 * reports it without writing.
 */
export async function generateRoute(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  options: { dryRun?: boolean } = {},
): Promise<RouteGenerationResult & { plan?: RoutePlan }> {
  const t0 = now();
  const timings: RouteTimings = { clipMs: 0, traversalMs: 0, snapOrderMs: 0, commitMs: 0, totalMs: 0 };
  const finish = <T extends RouteGenerationResult>(result: T): T => {
    timings.totalMs = now() - t0;
    if (!result.ok) {
      console.warn(`[route] ${assignmentId} not generated: ${result.code} — ${result.message}${result.detail ? ` (${result.detail})` : ""}`);
    }
    return { ...result, timings };
  };

  try {
    const fetched = await fetchRouteInputs(supabase, assignmentId);
    timings.clipMs = now() - t0;
    if (!fetched.ok) return finish(fetched);
    const { inputs } = fetched;

    if (inputs.knockCount > 0) {
      return finish({
        ok: false,
        code: "frozen",
        message: `This assignment has already been worked (${inputs.knockCount} knocks logged). Its door order is frozen.`,
      });
    }

    if (inputs.segments.length === 0) {
      return finish({
        ok: false,
        code: "no_roads",
        message: `No roads lie inside this prop, so no route was drawn.${NOTICE_TAIL}`,
      });
    }

    const r = rotationForInputs(inputs);
    if (!r.ok) {
      return finish({
        ok: false,
        code: "polygon_changed",
        message: `The prop polygon has changed since this allocation, so no route was drawn.${NOTICE_TAIL}`,
        detail: r.reason,
      });
    }

    const plan = buildRoutePlan(inputs, r.rotation);
    timings.traversalMs = plan.phaseMs.traversalMs;
    timings.snapOrderMs = plan.phaseMs.snapOrderMs;

    if (plan.traversal.terminatedBy === "bound") {
      return finish({
        ok: false,
        code: "bound_hit",
        message: `The route hit its safety bound before covering every street, so it was not saved.${NOTICE_TAIL}`,
        detail: `walked ${Math.round(plan.traversal.walkedM)} m of bound ${Math.round(plan.traversal.boundM)} m`,
      });
    }

    if (options.dryRun) {
      return { ...finish({ ok: true, summary: summarise(assignmentId, plan), timings }), plan };
    }

    const t3 = now();
    const committed = await commitRoutePlan(supabase, assignmentId, plan);
    timings.commitMs = now() - t3;
    if (!committed.ok) return finish(committed);

    return { ...finish({ ok: true, summary: summarise(assignmentId, plan), timings }), plan };
  } catch (err) {
    return finish({
      ok: false,
      code: "unavailable",
      message: `The route could not be drawn.${NOTICE_TAIL}`,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
