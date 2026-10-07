/**
 * UI-10: browser-free checks for the admin redesign's pure logic.
 * F1a: lib/admin/nav.ts. Later phases append their own blocks.
 *
 *   npm run verify:ui10
 */
import {
  ADMIN_NAV,
  activeNavKey,
  initialOf,
  coverageHref,
  isDarkReady,
  navGroups,
  parseRailState,
  visitHref,
  type AdminNavItem,
} from "../lib/admin/nav";
import { ADMIN_THEME_BOOT_SCRIPT } from "../lib/admin/theme-boot";
import {
  addPoint,
  canClose,
  canRedo,
  canUndo,
  closeShape,
  cornerLabel,
  edgeMidpoints,
  insertPoint,
  movePoint,
  redo,
  ringKey,
  ringOfShape,
  shapeFromRing,
  startHistory,
  toolbarHint,
  topHint,
  undo,
  HISTORY_LIMIT,
  type DrawHistory,
} from "../lib/admin/draw-history";
import { doorDelta, doorsLine, flatsNote, kmOf, ncczNote, routeCards, routeDetailLine } from "../lib/admin/draw-copy";
import { boxOf, outerRing, parsePropGeometry, polygonOfRing } from "../lib/admin/map-fit";
import {
  addDays,
  countsLine,
  dayDate,
  filterCounts,
  frozenVisitNote,
  historyFigures,
  joinNames,
  latestLeadPerDoor,
  matchesFilter,
  matchesQuery,
  nextVisitLine,
  nextVisitNumber,
  outcomeSegments,
  propState,
  propSubtitle,
  shortDate,
  sortProps,
  statePill,
  visitTitle,
  PROP_DUE_AFTER_DAYS,
  type PropRow,
  type PropVisit,
} from "../lib/admin/props";
import { detentHeights, nextDetent, settleDetent, PEEK_HEIGHT } from "../lib/admin/sheet-detents";
import type { WalkStep } from "../lib/geo/walk/types";
import { THEME_BOOT_SCRIPT } from "../lib/field/theme";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// --- F1a: nav ---

const keys = ADMIN_NAV.map((item) => item.key);
const hrefs = ADMIN_NAV.map((item) => item.href);
check("nav keys are unique", new Set(keys).size === keys.length, keys.join(","));
check("nav hrefs are unique", new Set(hrefs).size === hrefs.length, hrefs.join(","));
check(
  "every href is an admin route",
  ADMIN_NAV.every((item) => item.href === "/admin" || item.href.startsWith("/admin/")),
);
check(
  "labels are sentence case and non-empty",
  ADMIN_NAV.every((item) => /^[A-Z][a-z]+( [a-z]+)*$/.test(item.label)),
  ADMIN_NAV.map((item) => item.label).join(","),
);
check("Today is the first item", ADMIN_NAV[0]?.key === "today");

const cases: Array<[string, string | null]> = [
  ["/admin", null],
  ["/admin/props", "props"],
  ["/admin/props/", "props"],
  ["/admin/dashboard", "today"],
  ["/admin/allocate", "allocate"],
  ["/admin/allocate/anything", "allocate"],
  ["/admin/coverage", "coverage"],
  ["/admin/settings", "settings"],
  ["/admin/unknown", null],
  ["/field", null],
  ["/administrator", null],
];
for (const [path, expected] of cases) {
  const got = activeNavKey(path);
  check(`active item for ${path}`, got === expected, `got ${String(got)}`);
}

// Longest prefix wins, and `exact` stops a parent swallowing its children.
const nested: AdminNavItem[] = [
  { key: "today", label: "Today", href: "/admin/today", icon: "today", group: "main" },
  { key: "calendar", label: "Calendar", href: "/admin/today/calendar", icon: "calendar", group: "main" },
  { key: "props", label: "Props", href: "/admin", icon: "props", group: "main", exact: true },
];
check("longest prefix wins", activeNavKey("/admin/today/calendar/2026-10", nested) === "calendar");
check("parent still matches its own children", activeNavKey("/admin/today/add", nested) === "today");
check("exact item does not match children", activeNavKey("/admin/team", nested) === null);

const groups = navGroups();
check(
  "groups split main and tools",
  groups.main.length + groups.tools.length === ADMIN_NAV.length &&
    groups.tools.every((item) => item.group === "tools"),
);

check("rail defaults to expanded", parseRailState(null) === "expanded");
check("rail reads collapsed", parseRailState("collapsed") === "collapsed");
check("rail ignores junk", parseRailState("sideways") === "expanded");

check("initial of a name", initialOf("nomaan") === "N");
check("initial trims spaces", initialOf("  ada ") === "A");
check("initial of nothing", initialOf(null) === "?" && initialOf("   ") === "?");

check("old pages stay light", !isDarkReady("/admin/dashboard") && !isDarkReady("/admin") && !isDarkReady("/admin/allocate"));
check("Props is dark-ready (F2)", isDarkReady("/admin/props"));
check("a ready path and its children go dark", isDarkReady("/admin/today/add", ["/admin/today"]));
check("a ready path does not leak to siblings", !isDarkReady("/admin/todays", ["/admin/today"]));

check("visit and coverage links carry the prop", visitHref("a b") === "/admin/allocate?prop=a%20b" && coverageHref("x") === "/admin/coverage?prop=x");

// --- F1c: shared theme (A51) ---
check("admin theme boot script matches the field one", ADMIN_THEME_BOOT_SCRIPT === THEME_BOOT_SCRIPT);
check("theme boot reads the shared d2d.theme key", ADMIN_THEME_BOOT_SCRIPT.includes('"d2d.theme"'));

// --- F2a: draw history (A19-A21) ---

const P = (lon: number, lat: number): [number, number] => [lon, lat];
let h: DrawHistory = startHistory();
check("empty shape has no ring", ringOfShape(h.present) === null && !canUndo(h) && !canRedo(h));
check("top hint before the first corner", topHint(h.present) === "Tap the map to drop the first corner");
h = addPoint(h, P(0, 0));
h = addPoint(h, P(0, 0));
check("a repeated tap on the same spot is ignored", h.present.points.length === 1 && h.past.length === 1);
check("top hint goes after the first corner", topHint(h.present) === null);
h = addPoint(h, P(1, 0));
check("cannot close with 2 corners", !canClose(h.present) && closeShape(h) === h);
check("hint asks for 3", toolbarHint(h.present) === "At least 3 to close");
h = addPoint(h, P(1, 1));
check("hint offers corner 1 at 3", toolbarHint(h.present) === "Or tap corner 1" && canClose(h.present));
h = closeShape(h);
check("closed shape has a ring of 3", ringOfShape(h.present)?.length === 3 && h.present.closed);
check("no corners added once closed", addPoint(h, P(5, 5)) === h);
const beforeMove = h;
h = movePoint(h, 2, P(2, 2));
check("move commits one step", h.past.length === beforeMove.past.length + 1 && h.present.points[2]?.[0] === 2);
check("move to the same spot is ignored", movePoint(h, 2, P(2, 2)) === h);
h = undo(h);
check("undo restores the corner", h.present.points[2]?.[0] === 1 && canRedo(h));
h = redo(h);
check("redo re-applies it", h.present.points[2]?.[0] === 2 && !canRedo(h));
h = undo(h);
h = undo(h);
check("undo reopens a closed shape", !h.present.closed && h.present.points.length === 3);
h = addPoint(h, P(0, 1));
check("a new step clears redo", !canRedo(h) && h.present.points.length === 4);
const mids = edgeMidpoints(closeShape(h).present);
check("closed shape has a midpoint per edge, wrapping", mids.length === 4 && mids[3]?.afterIndex === 3 && mids[3]?.point[0] === 0 && mids[3]?.point[1] === 0.5);
check("open shape has no midpoints", edgeMidpoints(h.present).length === 0);
const inserted = insertPoint(closeShape(h), 3, P(0, 0.5));
check("insert after the last corner of a closed shape appends", inserted.present.points.length === 5 && inserted.present.points[4]?.[1] === 0.5);
check("insert after the last corner of an open shape is ignored", insertPoint(h, 3, P(9, 9)) === h);
let long: DrawHistory = startHistory();
for (let i = 0; i < HISTORY_LIMIT + 20; i++) long = addPoint(long, P(i, i));
check("history is capped", long.past.length === HISTORY_LIMIT);
const edited = shapeFromRing([P(0, 0), P(1, 0), P(1, 1), P(0, 0)]);
check("a saved ring loads closed, without the repeated corner", edited.closed && edited.points.length === 3);
check("ring key is stable to 7 dp", ringKey([P(0.123456789, 1)]) === "0.1234568,1.0000000" && ringKey(null) === "");
check("corner label", cornerLabel(0) === "No corners yet" && cornerLabel(1) === "1 corner" && cornerLabel(4) === "4 corners");

// --- F2a: sheet detents (A22) ---

const heights = detentHeights(780);
check("detents rise", heights.peek === PEEK_HEIGHT && heights.peek < heights.half && heights.half < heights.full, JSON.stringify(heights));
check("full leaves a strip of map", heights.full === 780 - 64);
const tiny = detentHeights(300);
check("detents stay ordered on a short screen", tiny.peek < tiny.half && tiny.half < tiny.full, JSON.stringify(tiny));
check("slow release snaps to nearest", settleDetent(heights.half + 20, 0, heights, "half") === "half");
check("slow release past half-way snaps up", settleDetent(heights.full - 30, 0.1, heights, "half") === "full");
check("fling up goes one step", settleDetent(heights.peek + 10, 0.9, heights, "peek") === "half");
check("fling down from full goes to half", settleDetent(heights.full - 10, -0.9, heights, "full") === "half");
check("fling never passes the ends", settleDetent(heights.peek, -2, heights, "peek") === "peek");
check("handle cycles", nextDetent("peek") === "half" && nextDetent("half") === "full" && nextDetent("full") === "half");

// --- F2a: props list (A22, A25) ---

const TODAY = "2026-10-06";
const visit = (n: number, date: string, extra: Partial<PropVisit> = {}): PropVisit => ({
  id: `v${n}-${date}`,
  visitNumber: n,
  workDate: date,
  slot: "early",
  startedAt: null,
  closedAt: null,
  countsForRotation: true,
  routeVariantKey: null,
  team: ["Tom", "Ada"],
  ...extra,
});
const prop = (name: string, visits: PropVisit[], archivedAt: string | null = null): PropRow => ({
  id: name,
  name,
  archivedAt,
  geometry: null,
  visits,
});
check("dates: add days across a month", addDays("2026-09-24", 14) === "2026-10-08");
check("dates: short and day forms", shortDate("2026-09-27") === "27 Sep" && dayDate("2026-10-20") === "Tue 20 Oct");
check("names join", joinNames(["Tom"]) === "Tom" && joinNames(["Tom", "Ada"]) === "Tom and Ada" && joinNames(["Tom", "Ada", "Sam"]) === "Tom, Ada and Sam" && joinNames([]) === "No one yet");

const live = prop("Live", [visit(1, "2026-09-08", { closedAt: "x" }), visit(2, TODAY, { startedAt: "2026-10-06T08:00:00Z" })]);
const liveState = propState(live, TODAY);
check("a started visit today is live", liveState.kind === "today" && statePill(liveState) === "live");
check("live subtitle", propSubtitle(liveState, 1682, null) === "1,682 doors · visit 2 today");
const notStarted = propState(prop("NS", [visit(1, TODAY)]), TODAY);
check("today but not started", statePill(notStarted) === "not-started");
const doneToday = propState(prop("Done", [visit(1, TODAY, { closedAt: "x", startedAt: "y" })]), TODAY);
check("closed today shows done", doneToday.kind === "today" && statePill(doneToday) === "done");

const planned = prop("Planned", [visit(1, "2026-09-01", { closedAt: "x" }), visit(2, "2026-10-20")]);
const plannedState = propState(planned, TODAY);
check("future visit is planned", plannedState.kind === "planned" && statePill(plannedState) === null);
check("planned subtitle", propSubtitle(plannedState, null, null) === "visit 2 · Tue 20 Oct");

const never = propState(prop("Never", []), TODAY);
check("never visited is due", never.kind === "due" && statePill(never) === "due" && propSubtitle(never, 80, null) === "80 doors · not visited yet");
const old = prop("Old", [visit(1, addDays(TODAY, -PROP_DUE_AFTER_DAYS), { closedAt: "x" })]);
check("due exactly on the day", propState(old, TODAY).kind === "due");
const recent = prop("Recent", [visit(1, "2026-10-05", { closedAt: "x" })]);
const recentState = propState(recent, TODAY);
check("recent visit rests", recentState.kind === "resting" && recentState.dueFrom === "2026-11-02");
check("resting subtitle and next line", propSubtitle(recentState, 802, null) === "802 doors · last 5 Oct" && nextVisitLine(recent, recentState) === "Visit 2 due from Mon 2 Nov");
const early = prop("Early end", [visit(1, "2026-10-01", { closedAt: "x" }), visit(2, "2026-10-03", { closedAt: "y", countsForRotation: false })]);
check("an early end does not count", nextVisitNumber(early.visits) === 2 && propState(early, TODAY).kind === "resting");
const stale = prop("Stale", [visit(1, "2026-09-01")]);
check("an unclosed past visit is history, not planned", propState(stale, TODAY).kind === "due");
const archived = propState(prop("Arch", [], "2026-10-01T10:00:00Z"), TODAY);
check("archived wins", archived.kind === "archived" && propSubtitle(archived, null, "2026-10-01T10:00:00Z") === "archived 1 Oct");

const states = [liveState, plannedState, never, recentState, archived];
const counts = filterCounts(states);
check("filter counts", counts.live === 4 && counts.due === 1 && counts.today === 1 && counts.archived === 1, JSON.stringify(counts));
check("counts line", countsLine(counts) === "4 live · 1 due");
check("All hides archived", !matchesFilter(archived, "all") && matchesFilter(plannedState, "all"));
check("Archived shows only archived", matchesFilter(archived, "archived") && !matchesFilter(never, "archived"));
check("Out today and Due", matchesFilter(liveState, "today") && !matchesFilter(plannedState, "today") && matchesFilter(never, "due"));
check("search ignores case and spaces", matchesQuery("Whitechurch Lane", "  lane ") && !matchesQuery("Northville", "lane") && matchesQuery("x", ""));
const sorted = sortProps([
  { row: recent, state: recentState },
  { row: prop("Never", []), state: never },
  { row: live, state: liveState },
  { row: planned, state: plannedState },
]).map((item) => item.row.name);
check("today, due, planned, resting", sorted.join(",") === "Live,Never,Planned,Recent", sorted.join(","));

const segs = outcomeSegments({ worked: 312, remaining: 1370, contacts: 22, leads: 4, rented: 30, notIn: 200 });
check("outcome bar adds an other segment", segs.total === 1682 && segs.segments.find((s) => s.key === "other")?.value === 56);
check("empty segments are dropped", outcomeSegments({ worked: 0, remaining: 10, contacts: 0, leads: 0, rented: 0, notIn: 0 }).segments.length === 0);
check("history figures", historyFigures({ worked: 1402, leads: 7 }) === "1,402 worked · 7 leads" && historyFigures({ worked: 3, leads: 1 }) === "3 worked · 1 lead");
check("visit titles", visitTitle(visit(3, TODAY), TODAY) === "Visit 3 · today" && visitTitle(visit(2, "2026-09-24"), TODAY) === "Visit 2 · Thu 24 Sep");
check("edit note while live", frozenVisitNote(liveState) === "Visit 2 is live. Changes apply from visit 3.");
check("edit note while planned", frozenVisitNote(plannedState) === "Visit 2 is planned. Changes apply from visit 3.");
check("no edit note when resting", frozenVisitNote(recentState) === null);

const pins = latestLeadPerDoor([
  { uprn: 1, status: "pending", status_set_at: null, booked_for: "2026-10-01T10:00:00Z" },
  { uprn: 1, status: "sale", status_set_at: "2026-10-03T10:00:00Z", booked_for: "2026-10-01T10:00:00Z" },
  { uprn: 2, status: "re_app", status_set_at: null, booked_for: null },
  { uprn: 3, status: "pm", status_set_at: null, booked_for: null },
  { uprn: 4, status: "cancelled", status_set_at: null, booked_for: null },
]);
check("one pin per door, latest status wins", pins.get(1) === "sale" && pins.size === 4);
check("pin kinds", pins.get(2) === "lead" && pins.get(3) === "pitched" && pins.get(4) === "closed");

// --- F2a: map geometry and draw copy ---

const square: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] };
check("outer ring drops the repeat", outerRing(square)?.length === 4);
check("outer ring of a multipolygon", outerRing({ type: "MultiPolygon", coordinates: [square.coordinates] })?.length === 4);
check("outer ring of nothing", outerRing(null) === null);
const box = boxOf([square, null, { type: "Polygon", coordinates: [[[-1, 3], [0, 3], [0, 4], [-1, 3]]] }]);
check("box spans every prop", JSON.stringify(box) === JSON.stringify([[-1, 0], [2, 4]]), JSON.stringify(box));
check("box of nothing", boxOf([]) === null);
check("geometry from PostgREST: object or JSON string", parsePropGeometry(square)?.type === "Polygon" && parsePropGeometry(JSON.stringify(square))?.type === "Polygon");
check("geometry: junk is null", parsePropGeometry("0103000020E6") === null && parsePropGeometry({ type: "Point", coordinates: [0, 0] }) === null && parsePropGeometry(null) === null);
check("polygon of a ring closes it", polygonOfRing([P(0, 0), P(1, 0), P(1, 1)]).coordinates[0]?.length === 4);

check("NCCZ note", ncczNote({ nccz: 6 }) === "6 doors left out: No Cold Calling zone" && ncczNote({ nccz: 1 }) === "1 door left out: No Cold Calling zone" && ncczNote({ nccz: 0 }) === null);
check("flats note", flatsNote({ multiUnit: 12 }) === "12 flats left out" && flatsNote({ multiUnit: 0 }) === null);
check("doors line", doorsLine({ knockable: 1682, excluded: 34 }) === "1,682 doors · 34 excluded" && doorsLine({ knockable: 5, excluded: 0 }) === "5 doors");
check("door delta", doorDelta(1714, 1682) === "+32 since last save" && doorDelta(10, 22) === "−12 since last save" && doorDelta(5, 5) === "No change since last save" && doorDelta(5, null) === null);
check("km", kmOf(2449) === "2.4 km" && kmOf(15862) === "15.9 km");
const step = (street: string | null): WalkStep => ({ street_name: street } as unknown as WalkStep);
const cards = routeCards([
  { key: "alt_1", total_m: 1900, steps: [] },
  { key: "best_reversed", total_m: 2449, steps: [step(null), step("Fulford Road")] },
  { key: "best", total_m: 2449, steps: [step("Whitchurch Lane")] },
]);
check("route cards: A then B, alternates hidden", cards.map((c) => c.key).join(",") === "best,best_reversed");
check("route card copy", cards[0]?.title === "Route A · 2.4 km" && cards[0]?.visits === "Visits 1, 3, 5…" && cards[1]?.start === "Fulford Road");
check("route detail line", routeDetailLine({ key: "alt_2", hand: "left", total_m: 1900, steps: [step("A")], stranded_count: 2 }) === "Spare 2 · 1.9 km · doors on the left · 1 step · 2 off route");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
