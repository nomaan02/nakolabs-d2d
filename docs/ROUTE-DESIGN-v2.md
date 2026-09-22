# Route generation v2 — walking-pattern traversal (Stage 5b, routing pivot)

Written before any code, 2026-09-22. Supersedes the traversal in
`docs/ROUTE-DESIGN.md`; keeps its projection, half-edge graph, door snapping,
side classification, Dijkstra and determinism rules. The brief's 2026-09-22
pivot note (rules 1–8) is the specification; `docs/reference/routing/` is the
ground truth for the pattern. Everything the rules leave open is decided here
and carried into `lib/geo/walk/` unchanged.

Facts this note is sized to (live database, 2026-09-22; 250 m buffer, 40 m
snap):

| Prop | Buffer segments | Working segments | Working metres | Named working streets | Doors | Stranded (> 40 m) |
|---|---|---|---|---|---|---|
| REF - Speedwell | 207 | 13 | 1,404 | 5 | 182 | 0 |
| redland | 545 | 135 | 8,175 | 47 | 2,821 | 3 |
| Northville | 530 | 124 | 8,321 | 29 | 1,225 | 13 |

## Vocabulary used below

- **Buffer graph** — every `road_segments` row within 250 m (geography) of the
  prop polygon, plus its endpoint nodes. Two half-edges per segment as in
  `route-graph.ts`.
- **Working side** — a `(segment, left|right)` pair with at least one knockable
  door snapped to it within 40 m. A segment is *two-sided*, *one-sided* or
  *walking-only*.
- **Hand** — `left` or `right`, fixed for the whole route (rule 1). Walking a
  half-edge, the side on the hand is *knocked*; the other is *the other side*.
- **Chain** — one street as walked: a half-edge and its continuations (rule
  below) until the street ends. A chain is entered at one end only.
- **Demand** — an unclaimed working side. Claims are per side and monotonic.

## a. The DFS walk — what the tree is, cycles, crossings

The route is a depth-first walk over *chains*, not over nodes. Its tree has
the start node as root; the **trunk** is the sequence of one-sided chains the
walker *carries on* along without returning (the prop's edge in the reference
drawing: Speedwell → Harewood → Ventnor); every other chain is a **branch**
hanging off the trunk or off a parent branch at the junction where it opens
on the hand side. A branch is walked out (knocking the hand side, entering
hand-side sub-branches at intermediate junctions as they are passed), crossed
at its far end, and walked straight back (knocking the other side, entering
the sub-branches that are now on the hand side). Control returns to the
junction it was entered from, and the parent chain continues. That is the
Euler tour of the chain tree: each two-sided chain contributes exactly two
consecutive passes, separated only by its own sub-branches (rules 2, 3, 5).

**Cycles.** Every chain is entered at exactly one end. When a chain's far end
lands on a node the walk already owns — a trunk junction (Derwent's far end at
Ventnor), a junction of an earlier branch, or any node at all — the walker
**crosses there and comes back; it never turns onto the road it crossed at**.
No sub-branch is entered at a far end, on either side, before or after the
cross. Cycle-closing roads are therefore never used as through-connections
inside the pattern, which is what keeps rule 2 on a grid: a street connecting
two trunk points is out-and-back from the first, and skipped (already claimed)
when the trunk reaches the second. The road crossed at is covered by its own
chain — the trunk's final leg, or a branch entered from an intermediate
junction elsewhere (rule 7, generalised: *crossing does not knock the road you
cross at*, not only when that road is the prop's edge).

**Crossings** are emitted at the far end of a chain whenever any segment
walked out has demand on the other side. A one-sided chain has no cross: in
trunk mode it carries on; as a branch it walks back on the same pavement
(walk steps, non-working). The cross step is a short line from the pavement
just walked to the pavement about to be walked.

**Continuation rule (where a street ends).** Arriving at a junction along
half-edge `h`, the chain continues along (1) the departure with the same
non-null `name` as `h` and the smallest |turn|; failing that (2) the departure
with the smallest |turn| if it is within 30° of straight (a name change on a
straight road: "Carry on along {new street}"); failing that the street ends.
The continuation is followed only while the remaining chain still has demand
(a look-ahead that follows continuations and stops at a repeated segment), so
a boundary road that runs on past the prop ends at its last door. A segment
inside a chain with no demand on the knocked side is a walk step
("Walk to {street} — no doors"), which is how doors-on-one-side-for-part-of-a-
street is handled without any special case.

**Junction handling, precisely.** Standing at node `v`:

- *Intermediate node of a chain* (branch mode): candidates are departures with
  demand ahead that lie on the hand side (right hand: signed turn > 0; left
  hand: < 0), excluding the continuation and the reverse of the arrival.
  Sharpest hand-side turn first; ties → `road_segments.id`, then forward
  direction. Each is entered as a branch and returns to `v`; candidates are
  re-evaluated after every return because claims changed.
- *Far end of a one-sided chain, the start node, or a transfer target* (trunk
  mode): candidates are every departure with demand ahead, excluding the
  reverse of the arrival, ordered two-sided-by-look-ahead first, then
  hand-side sharpest first, then the other side, then id. Two-sided chains are
  branches (they return); the first one-sided chain is a **carry-on** — the
  walker follows it and does not come back to `v`. Anything left at `v` is
  picked up later by a transfer. This is the rule that makes the perimeter the
  trunk without ever computing a perimeter: at a corner the sharpest hand-side
  one-sided departure is the next boundary road.
- *At the start node* there is no arrival. The walker is treated as having
  arrived from the prop centroid (arrival bearing = centroid → start), so with
  the right hand the sharpest right turn is the clockwise boundary direction
  and with the left hand the anticlockwise one.

**Leftovers and transfers.** When the trunk runs out and demand remains
(interior streets enclosed by T-junctions, a second road component, streets
abandoned at a carry-on), the walker transfers: Dijkstra over the whole buffer
graph (weight `length_m`) to the nearest node with an incident unclaimed side
(ties → shortest, then node id), one `walk` step per segment, then trunk-mode
processing at that node. A straight line is used only when Dijkstra finds no
road path in the buffer; each is a warning on the variant.

**The end.** The walk ends where the pattern ends. If that is not the start
node, a final walk over the shortest buffer path, "Back to the start", is
appended so the team is led back to the car (the reference drawing's End pin
sits beside its Start pin, up the doorless last 62 m of Ventnor Road). Its
metres are reported (`returnM`, and inside `nonWorkingM`) but **excluded from
the ranking cost** — see (c) and (f).

## b. One-sided streets and boundary roads

A one-sided segment has demand on exactly one side. Walked in the direction
that puts that side on the hand it is a work step; in the other direction it is
a walk step. A **boundary road** is simply a one-sided chain whose only door
side faces the prop (rule 6): the polygon decides which doors are knockable,
the snap decides which side they are on, and the outer side has no demand
because its doors are not in the prop. The generator never identifies "the
perimeter"; boundary roads become the trunk through the carry-on rule in (a),
which is why a boundary road drawn down the middle of a two-sided street (both
sides in the prop) is handled as an ordinary two-sided branch, not as a trunk
leg with an orphaned far side. A one-sided street in the interior (a park on
one side) entered from a two-sided parent is out-and-back with one working
pass and one walking pass; as a carry-on it costs nothing extra.

## c. Candidate enumeration and the cost function

**Starts.** The exterior ring is sampled at 24 points by perimeter fraction,
starting at ring vertex 0. For each sample the nearest *working node* (a node
with at least one incident working segment) is taken if it lies within 60 m of
the sample; the set is de-duplicated and sorted by node id. If no sample finds
a working node within 60 m (a prop with no roads near its edge), every sample
takes its nearest working node regardless of distance. Candidates = starts ×
{left, right}, at most 48 per prop.

**Cost** of a candidate = Σ non-working metres of its pattern: cross steps
(planar length of the pavement-to-pavement line), walk steps along roads
(`length_m`), straight-line transfers (haversine). Working metres never enter
the cost. The appended "Back to the start" leg is excluded; the tie-break
below is exactly its length. **Ties:** planar distance from the pattern's end
to the start (nearer wins), then start node id ascending, then hand (`left`
before `right`). Geometric only: no pace, doors per hour, outcomes or
`knock_events`.

## d. `best_reversed` and why rule 1 holds

`best_reversed` is `best` with the step list reversed and every step's
centreline and walkline reversed. A pavement that was on the right of the
direction of travel is on the left of the opposite direction, so every `side`
flips, the hand flips, and every work step still knocks the pavement it was
offset onto — rule 1 holds because the hand is a property of the direction of
travel, and reversing all directions at once flips it uniformly. Kinds,
segments, streets and metres are unchanged; the non-stranded door order is
reversed (stranded doors stay at the tail) and `first_seq`/`last_seq` are
remapped; instructions are regenerated from the reversed sequence by the same
rules (an out pass becomes a return pass, so "Turn right into Derwent Road"
becomes "Come back down Derwent Road" at the other end). Nothing is
re-optimised: same md5 of the step multiset, same distance.

## e. Alternatives and "materially different"

Candidates are ranked by (c). `alt_1…alt_K`, K ≤ 4, are taken in rank order,
each accepted only if it is materially different from `best`, `best_reversed`
and every alternative already accepted. **Materially different** = (i) its
start node is not the start node of any route in that set, and (ii) the set of
doors in its first fifth of the non-stranded door order overlaps each route's
first fifth by less than 50 %. `best_reversed`'s first fifth is `best`'s last
fifth. Only as many alternatives as pass; a prop that supports none reports
zero.

## f. Cases rules 1–8 did not decide, and the choice made

1. **Where a street ends** — same-name continuation, else straight within 30°,
   else the street ends; followed only while demand lies ahead.
2. **Far-end junctions** — no sub-branches at a far end on either side (rule 7
   generalised). A street enclosed by T-junctions on every access is reached
   by a transfer.
3. **Order at a junction** — sharpest hand-side turn first; in trunk mode
   two-sided chains before the carry-on; ties on segment id then direction.
4. **Start direction** — as if arrived from the centroid.
5. **One-sided branch** — out and straight back on the same pavement, no cross
   step, walk steps on the way back ("Come back down {street}").
6. **Doors on one side for only part of a street** — per segment: walk steps
   where the knocked side is empty, chain continues while demand lies ahead.
7. **Roundabouts and loops** — a chain stops when its continuation is a segment
   already in the chain; a crescent that returns to its own start is one
   chain, out around and back around.
8. **No clear perimeter** — the start fallback in (c); the trunk degenerates to
   nothing and transfers join the branches.
9. **Transfer target** — nearest by road distance, then node id; entry at the
   target by the trunk-mode order.
10. **End of the route** — the pattern's end; "Back to the start" appended and
    excluded from the cost.
11. **Cross step `side`** — the hand (the pavement being moved to is on the
    hand of the next step). `is_dead_end` is true on any step whose end node
    has degree 1 in the buffer graph.
12. **Stranded order** — by the sequence position of the nearest non-stranded
    door, then UPRN, so a mop-up walks in route order.
13. **Walk-step street** — the street of the next work step; a walk that ends
    at the start node is "Back to the start".
14. **`first_seq`/`last_seq`** — 0-based positions in `doorOrder`; null on
    cross and walk steps.
15. **Two hand-side side streets at one node** — sharpest first, re-evaluated
    after each returns.

## g. What I think is wrong or contradictory, and what I would change

1. **Ventnor Road segment 93566 has no prop door within 40 m.** The acceptance
   item "every segment of Speedwell, Harewood, Ventnor has exactly one work
   step" cannot hold for it under the prompt's own street-selection rule; it is
   walking-only and gets a walk step (the "Back to the start" leg in the
   right-hand route). I follow the rule and report the segment.
2. **Return leg vs. ranking.** Counting the return-to-start leg in the cost
   makes the reference route tie with three mirror routes on Speedwell (every
   one costs two crosses plus 62 m) and lose on node id to a route that
   crosses Selby at the Harewood end. Excluding it makes the reference the
   unique minimum (two crosses, 16 m) and makes "ends within 100 m of start"
   a meaningful number (62 m). The prompt's tie-break "end nearer the start"
   only makes sense under the second reading, so that is what is built. I
   would state it explicitly in the brief.
3. **`route_steps` (migration 018) cannot hold this output.** It has
   `segment_id, street_name, instruction, is_spur, cumulative_m, geom` and no
   kind, side, walkline, door range, dead-end flag, variant key or hand. R2
   needs the pivot note's `territory_routes` (per prop, per variant) and a
   per-assignment copy; storing the walkline as a second geometry column and
   the centreline as the first. `assignments.route_geom` as one LineString
   loses kinds and sides and should become derived from the steps.
4. **`is_spur` is gone.** The field display (5b-b) collapses spur steps; the
   new shape has `is_dead_end` on the step that reaches the dead end and a
   nested branch structure. 5b-b's collapsing logic will need to key on
   consecutive `walk` steps and on chain returns instead.
5. **The 250 m buffer is a tuning knob the same way 40 m is.** Widening it
   changes which transfers exist and therefore the route. It should be fixed
   in the brief with the same "never tune" status, or recorded on the stored
   route as an input.
6. **"96 two-sided streets" in the old redland numbers are almost certainly
   clipped segments, not named streets** (redland has 47 named working streets
   in the buffer). I report separation per two-sided segment and per named
   street.
7. **Rule 7's "typically the prop's edge"** invites an exception for interior
   cross streets. I chose the strict reading; the price is that a street
   reachable only at far ends is a transfer. If redland shows many of these, a
   principled relaxation is "enter the arms of an interior two-sided cross
   street at a far end", which would need the trunk to be identified
   explicitly (outer face of the working graph). Not built; reported with a
   count.
8. **Door snapping is nearest-segment.** A door near a corner can snap to the
   side street rather than the street it fronts. 5b-a accepted this; a
   frontage-aware snap (prefer the segment the door is perpendicular to) would
   be a later, separately measured change.
9. **The old 5b-a instruction vocabulary** ("Spur —", "Transfer to",
   "continue to the end") is still what the field header renders. R2 must
   swap the display vocabulary at the same time as the source, or the header
   will show two dialects.

## Post-run corrections — 2026-09-22, after the first harness run

The body above is what was written before code and is left as written. These
are the places the live data proved it wrong, and what the code does instead.

1. **Ranking cost includes the return leg (corrects c, f.10, g.2).** On
   Speedwell every one of the 24 candidates walks the same 26.73 m of
   non-working: two crosses and Ventnor Road's one doorless 10.73 m segment.
   Excluding the return leg made the two candidates that start beside that
   segment score 16 m — the doorless walk became a "free" return leg — and
   `best` started mid-Ventnor, entering Derwent from Ventnor and crossing at
   the Harewood end. That is a start-position artefact with no metres behind
   it. The cost is now every non-working metre, the return leg included; the
   prompt's literal definition. `rank_cost_m` equals `non_working_m` and is
   kept as the explicit ranking key.
2. **Hand tie-break is right before left (corrects c).** With the return leg
   counted, 22 of Speedwell's 24 candidates tie at 26.73 m and 0 m end-to-start.
   Node id then picks the Speedwell/Harewood corner; left there is the mirror
   route (both crosses at the Harewood end), right is the drawing's pattern
   (Harewood first, Derwent and Selby crossed at Ventnor). Rules 1–8 do not
   decide which end an interior street is entered from — it follows from the
   start corner and the hand — so on the final tie the reference drawing's
   hand wins. This is a convention chosen to match the ground-truth drawing,
   and is recorded as such.
3. **"The doorless last 62 m of Ventnor Road" (a, g.1, g.2) was wrong.** The
   walking-only Ventnor segment is 10.73 m, mid-street (between Derwent's and
   Selby's junctions); Ventnor's segment at the corner has three doors. The
   trunk therefore closes the loop exactly at its start and no return leg is
   needed on the drawing's route.
4. **Straight-line transfers cannot reach zero on redland or Northville with
   the current network.** All 3 redland and 9 Northville straight lines in
   `best` join components separated by a `primary` road that the Stage 1b
   ingest excluded — Whiteladies Road (A4018) on redland, Filton Road /
   Filton Avenue (A38) on Northville. `road_segments` holds service,
   residential, unclassified, tertiary, secondary and living_street only.
   Confirmed by query: no segment passes within 3 m of any of the stranded
   nodes. Fix belongs to a later ingest pass (add `primary`/`trunk` as
   walking-only roads); not re-fetched here.
5. **Non-working share is 30–33 %, not below the old 26 %.** Composition of
   `best`: redland 6,309 m = 14 transfers 3,378 m (552 m straight) + one-sided
   back passes 1,258 m + in-chain doorless / wrong-side walks 1,034 m + 55
   crosses 440 m + return 199 m. Northville 6,690 m = 19 transfers 2,991 m
   (688 m straight) + back passes 1,271 m + in-chain 1,533 m + 46 crosses
   368 m + return 527 m. The old figure counted straight-line transfers
   (shorter than roads), no crosses and no return leg, so it is not the same
   quantity. Transfers are half the total and follow from the strict far-end
   rule ("you do not turn onto the next road") plus the missing primary roads;
   the relaxation in g.7 was not applied because the pivot note forbids it.
6. **Walkline side check.** 2/182 Speedwell doors, 99/2,819 redland, 51/1,217
   Northville lie within 4 m of the OSM centreline — on the correct side of
   the centreline, but inside the pavement offset, so on the wrong side of the
   walkline. Data (OS UPRN point vs OSM centreline), not routing; the ~4 m
   offset is the prompt's and was not tuned.
