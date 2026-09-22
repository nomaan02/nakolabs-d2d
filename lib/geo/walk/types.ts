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
  /** LineString coordinates in walking direction. On a cross, the same short line as the walkline. */
  centreline: LonLat[];
  /** The centreline offset ~4 m onto the pavement being walked; a cross is pavement to pavement. */
  walkline: LonLat[];
  /** 0-based positions in `door_order` knocked by a work step; null otherwise. */
  first_seq: number | null;
  last_seq: number | null;
  /** From the fixed vocabulary only. British English. */
  instruction: string;
  /** True when the step ends at a node with a single road (degree 1 in the buffer graph). */
  is_dead_end: boolean;
  /** road_segments.length_m for road steps; the crossing distance for a cross; great-circle metres for a straight line. */
  length_m: number;
};

export type WalkEndpoint = { node_id: number; lon: number; lat: number };

export type WalkVariant = {
  key: VariantKey;
  hand: Hand;
  start: WalkEndpoint;
  end: WalkEndpoint;
  /** working_m + non_working_m. */
  total_m: number;
  working_m: number;
  /** Every cross, walk and transfer, including the appended "Back to the start" leg. */
  non_working_m: number;
  /** The appended "Back to the start" leg; 0 when the pattern ends at the start (and on best_reversed). */
  return_m: number;
  /** What ranked this candidate: every non-working metre, the return leg included (equals non_working_m). Copied onto best_reversed. */
  rank_cost_m: number;
  /** Planar metres from the pattern's end (before any return leg) to the start. */
  end_to_start_m: number;
  stranded_count: number;
  straight_transfers: number;
  /** Every knockable UPRN exactly once; the last `stranded_count` are stranded. */
  door_order: number[];
  steps: WalkStep[];
  warnings: string[];
  /**
   * Verification aid, not for display: the chain (street as walked) each step
   * belongs to (-1 on transfers and the return leg) and each chain's parent
   * chain (-1 at the root). A two-sided street's two passes must be separated
   * only by steps whose chain descends from its own.
   */
  tree: { step_chain: number[]; chain_parent: number[] };
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
