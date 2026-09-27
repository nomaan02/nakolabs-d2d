/**
 * Stage 5b, routing pivot (R1) — the output shape of the walking-pattern
 * route generator. Typed pure data; nothing here touches the database.
 *
 * Field names are snake_case because this is the document R2 will store on
 * `territory_routes` and copy onto an assignment. See docs/ROUTE-DESIGN-v2.md.
 */

import type { LonLat } from "@/lib/geo/route-graph";

export type Hand = "left" | "right";
export type StepKind = "work" | "cross" | "walk";
export type VariantKey = "best" | "best_reversed" | `alt_${number}`;

export type WalkStep = {
  kind: StepKind;
  /** Null on a cross and on a straight-line fallback transfer. */
  segment_id: number | null;
  /** Null when the road is unnamed (the instruction then carries the highway type). */
  street_name: string | null;
  /** Side of the direction of travel. On work steps it equals the route's hand. */
  side: Hand;
  /** road_nodes ids. Equal on a cross. */
  from_node: number;
  to_node: number;
  /**
   * LineString coordinates in walking direction: the part of the segment
   * actually walked (the first and last steps start and end level with a
   * door; a street's far end stops level with its furthest door). On a cross,
   * the same arc as the walkline.
   */
  centreline: LonLat[];
  /**
   * The centreline offset ~4 m onto the pavement being walked. A cross is a
   * 9-point U-turn arc from one pavement to the other. A one-sided street's
   * walk back sits on the knocked pavement, inset towards the road, starts
   * with the U-turn arc from the work line and ends with a short line to
   * the next step.
   */
  walkline: LonLat[];
  /** 0-based positions in `door_order` knocked by a work step; null otherwise. */
  first_seq: number | null;
  last_seq: number | null;
  /** From the fixed vocabulary only. British English. */
  instruction: string;
  /** True when the step ends at a node with a single road (degree 1 in the buffer graph). */
  is_dead_end: boolean;
  /**
   * road_segments.length_m scaled to the part walked, for road steps; the
   * crossing distance (pavement to pavement, not the drawn arc) for a
   * cross; great-circle metres for a straight line.
   */
  length_m: number;
};

/** `node_id` is the first step's from_node / last step's to_node; lon/lat is the first / last walkline point. */
export type WalkEndpoint = { node_id: number; lon: number; lat: number };

export type WalkVariant = {
  key: VariantKey;
  hand: Hand;
  /** Level with the first door. */
  start: WalkEndpoint;
  /** Level with the last door. */
  end: WalkEndpoint;
  /** Sum of every step's length_m. */
  total_m: number;
  working_m: number;
  /** Every cross, walk and transfer between the first door and the last. */
  non_working_m: number;
  /** Always 0: routes are open paths with no leg back to the start. Kept for the stored column. */
  return_m: number;
  /** What ranked this candidate: the non-working metres between the first and last door (equals non_working_m). Copied onto best_reversed. */
  rank_cost_m: number;
  /** Planar metres between the first and last doors' centreline feet. The same on best_reversed. */
  end_to_start_m: number;
  stranded_count: number;
  straight_transfers: number;
  /** Every knockable UPRN exactly once; the last `stranded_count` are stranded. */
  door_order: number[];
  steps: WalkStep[];
  warnings: string[];
  /**
   * Verification aid, not for display: the chain (street as walked) each step
   * belongs to (-1 on transfers) and each chain's parent
   * chain (-1 at the root). A two-sided street's two passes must be separated
   * only by steps whose chain descends from its own.
   */
  tree: { step_chain: number[]; chain_parent: number[] };
  /**
   * Verification aid, not for display (2026-09-27, adaptive offset amended
   * 2026-09-27 Session A2): per step, what `offsetCore` was actually
   * called with (`offset_m`, the first rung of the fixed ladder whose
   * run-local check passed, or the run's base if none did — owner decision
   * 2026-09-27, Session A3) and the ladder's own starting rung for that run
   * (`offset_base_m`: 4 for a normal run, 2 for a walk-back strip), so a
   * reduction can be counted. `offset_ladder_passed` is false when no rung
   * passed and the base was kept; `offset_run` numbers the offset runs of
   * the variant, so consecutive steps of one run can be grouped.
   * `head_arc_points` / `tail_arc_points` are exact vertex counts, not
   * booleans: a uTurnArc splice rewrites `ARC_POINTS - 1` vertices from
   * that end (the splice's own last point is the strip's real offset
   * point, so it is still checked); a connector push/unshift rewrites
   * exactly 1. `offset_m` / `offset_base_m` / `offset_side` /
   * `offset_ladder_passed` / `offset_run` are null on a cross (every one of
   * its vertices is arc). `variantForStorage` strips this whole field, same
   * as `tree`.
   */
  walk_meta: {
    offset_m: number | null;
    offset_base_m: number | null;
    offset_side: Hand | null;
    offset_ladder_passed: boolean | null;
    offset_run: number | null;
    head_arc_points: number;
    tail_arc_points: number;
  }[];
};

export type CandidateSummary = {
  start_node_id: number;
  hand: Hand;
  rank_cost_m: number;
  end_to_start_m: number;
  transfers: number;
  straight_transfers: number;
  covered_every_side: boolean;
};

export type WalkTimings = {
  parse_ms: number;
  graph_ms: number;
  demand_ms: number;
  candidates_ms: number;
  variants_ms: number;
  total_ms: number;
};

export type WalkResult = {
  territory_id: string;
  name: string;
  buffer_m: number;
  doors: number;
  stranded_count: number;
  buffer_segments: number;
  buffer_nodes: number;
  working_segments: number;
  two_sided_segments: number;
  one_sided_segments: number;
  working_sides: number;
  start_candidates: number;
  /** Every candidate evaluated, in rank order. */
  candidates: CandidateSummary[];
  variants: WalkVariant[];
  timings: WalkTimings;
};
