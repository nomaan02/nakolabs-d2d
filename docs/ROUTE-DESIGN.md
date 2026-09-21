# Route generation — design note (Stage 5b)

Written before any code, 2026-09-19. The brief's algorithm (Stage 5b) is a
sketch. Every rule below that the brief leaves open is decided here, visibly,
and carried into code unchanged. Determinism is the product; optimality is
parked (Section 9 of the brief).

Facts this note is sized to (verified against the live database, 2026-09-19):

| Prop | Clipped segments | Clipped length | Components | Dead-end nodes | Doors | Doors ≤ 40 m of a clipped segment |
|---|---|---|---|---|---|---|
| Northville | 127 | 7,945 m | 6 (86/10/5/5/3/3 nodes) | 37 | 1,225 | 1,185 (40 beyond) |
| DEMO Clifton | 12 | 471 m | 1 | – | 133 | – |
| DEMO Southville | 7 | 344 m | 1 | – | 138 | – |
| DEMO Bishopston | 2 | 315 m | 1 | – | 69 | 50 (19 beyond) |

`authenticated` runs with `statement_timeout = 8s`. Both RPCs must finish
inside that. The Northville input query runs in ~470 ms.

## The six decisions

### a. Turn convention

Bearings are compass bearings in the local plane: 0 = north, increasing
clockwise, in `[0, 2π)` — the same convention as `ST_Azimuth`. The plane is an
equirectangular projection centred on the prop centroid (metres); at prop
scale the distortion is below 0.1 %.

- **Departure bearing** of a half-edge = bearing from its first vertex to its
  first *distinct* subsequent vertex, in the direction of travel.
- **Arrival bearing** at a node = bearing of the last distinct vertex pair of
  the half-edge just walked, in the direction of travel.
- **Signed turn** `θ = wrap(departure − arrival)` into `(−π, π]`.
  **Negative is left** (anticlockwise), positive is right. `+π` is a U-turn.
- `cw` takes the **leftmost** turn = the candidate with the **minimum** `θ`.
  `ccw` takes the **rightmost** = the **maximum** `θ`.
- Two candidates within `1e-6` rad of each other are a tie. Ties break on
  ascending `osm_way_id`, then ascending `road_segments.id`.
- **At the start** there is no arrival bearing. The walker is treated as
  having arrived facing the prop centroid: arrival bearing = bearing from the
  entry node to the centroid. This is stable (the centroid is far from the
  entry corner) and deterministic.
- **After a transfer or backtrack**, the arrival bearing is the bearing of the
  last leg walked.

The U-turn (the reverse of the half-edge just walked) is **never a candidate
while any other unvisited half-edge departs the node**. Without this rule the
`ccw` sweep would U-turn at every node (`+π` is always the rightmost turn) and
walk each street out-and-back before touching a side street. The U-turn is
taken only when nothing else at the node is unvisited and the reverse
half-edge still is. That is exactly the cul-de-sac case.

### b. Two passes per segment — half-edges

Every `road_segments` row becomes two **half-edges**: `+` (from_node →
to_node, geometry as stored) and `−` (to_node → from_node, geometry
reversed). The traversal state is one boolean per half-edge. A segment is done
when **both** half-edges are visited; the traversal terminates on "every
half-edge visited", never on "every segment touched once".

A half-edge is marked visited only when it is walked as a **working pass**.
Backtracks re-walk already-visited half-edges and mark nothing (see d).

### c. Side assignment

For every UPRN in the snapshot: nearest clipped segment by planar distance to
the polyline (ties → ascending segment id); closest point on it; the local
direction is the vertex pair containing that closest point, oriented
from_node → to_node. Cross product `z = dir × (uprn − closest)`:
`z > 0` → left of from→to, `z < 0` → right, `z = 0` → left (documented tie).

Which pass works which side follows the sweep, so `ccw` is the exact mirror of
`cw`:

| sweep | worked side (relative to walking direction) | UPRN left of from→to | UPRN right of from→to |
|---|---|---|---|
| `cw` (leftmost turns) | left | half-edge `+` | half-edge `−` |
| `ccw` (rightmost turns) | right | half-edge `−` | half-edge `+` |

The worked side is the inside of the preferred turn, so the door sequence stays
continuous around a corner when the turn rule fires. Route position of a UPRN
= cumulative metres at the start of its half-edge's working pass + distance
along that half-edge in the direction of travel (fraction × `length_m`).

### d. Disconnected components, backtracks and transfers

Northville clips to six components; this is the normal case, not an edge case.

- **Within a component**, when the current node has no unvisited departing
  half-edge (including the reverse of the arrival), **backtrack**: Dijkstra on
  the clipped graph (undirected, weight `length_m`, O(V²) with explicit
  `(distance, node id)` selection) to the nearest node that has one. Ties →
  shortest distance, then ascending node id. Every half-edge on a backtrack
  path is already visited (its intermediate nodes are nearer than the target,
  so they have nothing unvisited); nothing is marked. One `route_steps` row per
  backtrack: `segment_id` null, geometry = the whole path, instruction
  `Transfer to {street}` naming the street of the next working pass.
- **Between components**: when Dijkstra finds nothing reachable, the component
  is complete. The next component is the one whose nearest node (planar
  distance from the current node) is closest; ties → ascending lowest node id
  in the component, then ascending node id. The join is a **straight transfer
  segment**: `segment_id` null, two-point geometry, instruction
  `Transfer to {street}`. Chosen over shortest path on the full road graph
  because it needs no reads outside the clipped subgraph (loop guard 7), it is
  trivially deterministic, and an honest straight line beats a road route that
  might leave the polygon anyway.
- The entry component is whichever contains the entry node — the clipped node
  nearest polygon vertex `entry_vertex_index` (ties → ascending node id).

"Transfer to" is used for both backtracks and component joins on purpose. Both
are non-working movement to the next place with unworked doors, and the field
app needs one signal for "nothing to knock on this leg".

### e. Stranded UPRNs

A UPRN whose nearest clipped segment is **more than 40 m** away has no honest
route position. Rule:

- It is never dropped. Every UPRN in the old snapshot appears exactly once in
  the new one (the commit RPC verifies multiset equality).
- Non-stranded UPRNs come first, ordered by route position then UPRN.
  Stranded UPRNs are **appended at the end**, ordered by the route position of
  their nearest half-edge then UPRN, so a mop-up at the end still walks in
  route order.
- The flag is `assignments.route_stranded_count` (new integer column, default
  0): the last `route_stranded_count` entries of `uprn_snapshot` are stranded.
  A count rather than a second UPRN array because the tail rule cannot drift
  from the snapshot. Stored rather than derived on read because a
  planar-vs-geography distance disagreement at 39.99 m must not flip a door
  between two views of the same route.
- The 40 m threshold is never adjusted to make a test pass.

DEMO Bishopston (2 segments, 50 of 69 doors within 40 m) will therefore
**route**, with 19 doors in the stranded tail. It will not fail open. That is
the rule working on a small graph, reported as such.

### f. Route trigger

- `allocate_prop` is not modified. Allocation returns and is confirmed to the
  admin exactly as today (`uprn_snapshot` interim angular, `route_geom` null).
- The allocate form then calls a **second server action**,
  `generateRouteAction(assignmentId)` (`lib/props/generate-route.ts`), under
  the admin's own cookie session (`lib/supabase/server`). RLS governs every
  read and write; the service role is never used.
- While it runs the form shows "Allocated … Drawing the route…". On success it
  shows length, step count and stranded count. On any failure it shows a
  one-line notice ("Route not drawn: … The door order is the interim sweep.")
  and the assignment is left exactly as `allocate_prop` made it. Nothing
  throws to the admin.
- The same action is offered as a **Draw route** button on already-allocated
  rows with no route, which is how Northville's existing assignment gets one.
- The allocate page exports `maxDuration = 60` so the action is not cut off by
  the platform default before the 30 s target.

## The freeze principle

The generator refuses any assignment with `knock_events > 0`. It is checked
twice: in the TypeScript orchestrator before any work, and again inside the
commit RPC in the same transaction as the write, so a knock that lands between
the two cannot be reordered underneath. Re-running on an unworked assignment is
allowed and idempotent — the output is identical by construction.

## Termination and the safety bound

The brief says "terminate when every edge is visited, or at twice the clipped
network's total length". With two passes per segment the **floor** for a
complete route is already `2 × Σ length_m`; any backtrack at all would trip a
bound set at `2 ×`. Resolution (simplest deterministic): the bound is **twice
the required two-pass length**, i.e. `4 × Σ length_m` of the clipped segments.
Hitting it is a warning; the route is **not committed** (fail open, interim
order kept) because a bound-terminated route is not complete.

Every loop iteration either visits a new half-edge or backtracks onto a node
that has one, so the traversal is bounded by `2 × (number of half-edges)`
iterations regardless of the length bound. No wall clock is consulted inside
the algorithm.

## Instruction vocabulary (fixed; nothing else)

| Case | Instruction |
|---|---|
| first working step | `Start on {street}` |
| same street name as the previous working pass, or turn within ±30° | `{street} — continue to the end` |
| turn ≤ −30° (left) | `Left into {street}` |
| turn ≥ +30° (right) | `Right into {street}` |
| working pass whose chain through degree-2 nodes ends at a clipped dead end | `Spur — {street}, return the way you came` |
| U-turn (reverse of the arrival half-edge) | `Cross to the far side and work back` |
| backtrack or component join | `Transfer to {street}` |
| first working step after a transfer | `{street} — continue to the end` |

`{street}` is `road_segments.name`; when null it is `service road` for
`highway = service` and `unnamed road` otherwise (53 of Northville's 127
clipped segments are unnamed service roads). `is_spur` is true on every step
whose segment lies on a chain that ends at a clipped dead end, in both
directions. `cumulative_m` is metres from the route start to the **end** of the
step, so `route_length_m = max(cumulative_m)`. Lengths of working passes are
`road_segments.length_m` (geography metres from Stage 1b); transfer lengths are
haversine metres.

## Contradictions and gaps found in the brief, and the resolution taken

1. **2× bound vs two passes** — see above. Bound is `4 × Σ length_m`.
2. **"One Postgres clip function" vs an atomic write.** The traversal is in
   TypeScript, so the write back (delete old steps, insert steps, update
   `route_geom`, `route_length_m`, `uprn_snapshot`, `route_stranded_count`) is
   three statements. PostgREST cannot span a transaction across calls, so a
   second SECURITY INVOKER function, `route_commit`, does the write in one
   transaction and re-checks the freeze. Two functions, both RLS-governed.
3. **`route_steps.segment_id` is nullable in the brief's DDL** — used as
   written: null on transfers and backtracks.
4. **Stranded flag has nowhere to live** in the brief's schema. One integer
   column on `assignments`. No address text, no UPRN array.
5. **Polygon edits after allocation.** The generator reads the *current*
   polygon. It recomputes `rotationForVisit(visit_number, vertexCount)` and
   fails open if the result disagrees with the frozen `entry_vertex_index` /
   `sweep_direction` (vertex count changed since allocation). Same vertex
   count, moved corners: proceeds; deterministic on the current polygon.
6. **Brief's Stage 5b acceptance "200-door prop under five seconds"** and the
   session's "Northville under 30 s" are both reported.
7. **Rotation vs wall-following (found at verification, 2026-09-19).** The
   acceptance item asks visit n and n+1 to be "materially different, not a
   reversal". The brief's own turn rule cannot deliver that. Leftmost-turn /
   rightmost-turn is face tracing: from any node on a face it walks the same
   cycle, so two entry vertices on the same boundary street give the same
   route cut at a different point, and flipping the sweep gives that route
   backwards. Measured on Northville (127 segments, 19 ring corners):
   visit 1 vs 2 share 25% of ordered step pairs forwards and **89% against the
   reversed sequence**; visit 1 vs 3 (same sweep, entry node 267 m away) share
   **99%**. The product effect: consecutive visits swap the first hour and the
   last hour (0.4% of first-fifth doors in common), but visits 1 and 3 give the
   same doors the same slot (99.6% in common). Each door sees two time-of-day
   slots across a cycle, not `ring.length`. Resolution: the algorithm is left
   exactly as the brief specifies (loop guard 3 and "do not optimise"); the
   item is reported FAIL with the numbers; the fix is a product decision on
   the rule — e.g. rotate the *face order* or start from an interior node —
   and belongs in an amendment to Stage 5b, not in this session.

## Determinism checklist (what the code must not do)

No `Math.random()`, no `Date.now()` inside the algorithm, no reliance on
`Set`/`Map` iteration order or sort stability. Every array is sorted on an
explicit total key before use. Every SQL aggregate is `ORDER BY id` / `uprn` /
ring path. Timings are measured around the phases, never read inside them.
