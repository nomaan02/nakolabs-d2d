/**
 * UI-10: browser-free checks for the admin redesign's pure logic.
 * F1a: lib/admin/nav.ts. Later phases append their own blocks.
 *
 *   npm run verify:ui10
 */
import {
  ADMIN_NAV,
  APPEARANCE_OPTIONS,
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
import {
  activeTeam,
  addableCanvassers,
  addVisitGroups,
  addVisitLine,
  ago,
  allocateButton,
  attentionLine,
  cardMeta,
  cardStatus,
  dayLabel,
  dayNumeral,
  dayTotals,
  defaultVisitDate,
  doorLabelLine,
  emptyDayLine,
  endVisitConfirm,
  longDate,
  mustEnd,
  reviewButton,
  reviewConfirm,
  reviewRowMeta,
  routeLine,
  scheduleDays,
  selectionLine,
  sheetMeta,
  splitReview,
  staleGroups,
  staleVisits,
  teamLine,
  teamOptions,
  NO_FIGURES,
  type TodayVisit,
  type VisitFigures,
} from "../lib/admin/today";
import {
  allocatedNote,
  buildCalendar,
  calendarHref,
  dayCell,
  daySummary,
  entryMeta,
  gridSpan,
  leadResultRows,
  leadResultsLine,
  londonDay,
  londonTime,
  monthGrid,
  monthTitle,
  monthTotals,
  notWorkedCopy,
  openOnMapHref,
  outcomeKey,
  outcomesLine,
  parseDay,
  parseMonth,
  peopleLine,
  shiftMonth,
  swipeMonth,
  type CalendarVisit,
} from "../lib/admin/calendar";
import {
  coverageFigures,
  doorMeta,
  clearedFilters,
  filterCount,
  filterCountLine,
  filtersHref,
  knockWhen,
  matchedLabel,
  outcomeChip,
  outcomeGroup,
  outcomeWords,
  paintedOf,
  parseFilters,
  periodIsFilter,
  periodLabel,
  periodOf,
  resolveDoors,
  scopeLine,
  slotChip,
  visitChip,
  whoChip,
  withoutProp,
  NO_FILTERS,
  type CoverageRow,
  type CoverageVisit,
} from "../lib/admin/coverage-filters";
import type { WalkStep } from "../lib/geo/walk/types";
import { THEME_BOOT_SCRIPT } from "../lib/field/theme";
import {
  contactToLead,
  dayLine,
  doorsCount,
  daysLabel,
  funnel,
  inWindow,
  parseTeamPeriod,
  parseTeamSort,
  peopleCount,
  percentText,
  periodLine,
  periodWindow,
  personStats,
  profileHref,
  profileLine,
  propsLine,
  queryBounds,
  recentDays,
  recentDoors,
  recentLeads,
  sortTeam,
  teamHref,
  teamRows,
  type TeamLead,
  type TeamPerson,
} from "../lib/admin/team";
import {
  doorTitle,
  emptyLeadsLine,
  filterByStatus,
  leadMark,
  leadMeta,
  leadStatusLabel,
  leadsHref,
  leadsInWindow,
  leadsSubtitle,
  parseStatusFilter,
  showMoreLabel,
  statusChips,
  whenLine,
  type LeadItem,
} from "../lib/admin/leads";
import {
  barShare,
  completionLine,
  completionRows,
  leadOutcomeBars,
  slotRows,
  staleRows,
  staleTitle,
  weekColumns,
  weekLabel,
  weekTotals,
  weeklyRows,
  weeksSummary,
} from "../lib/admin/insights";
import {
  accountLine,
  buildLine,
  checkEmail,
  checkFirstName,
  dataRows,
  inviteButtonLabel,
  latestOf,
  loggingLabel,
  parseLoggingDefault,
  parseThreshold,
  plannedWarning,
  sortAccounts,
  thresholdValue,
} from "../lib/admin/settings";

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
  ["/admin/today", "today"],
  ["/admin/today/add", "today"],
  ["/admin/today/review", "today"],
  ["/admin/dashboard", null],
  ["/admin/allocate", null],
  ["/admin/calendar", "calendar"],
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
check("Today and its pages are dark-ready (F3)", isDarkReady("/admin/today") && isDarkReady("/admin/today/add"));
check("no temporary Allocate item (F3)", !ADMIN_NAV.some((item) => item.key === "allocate"));
check("Calendar is the second item (A39, F4)", ADMIN_NAV[1]?.key === "calendar" && ADMIN_NAV[1]?.href === "/admin/calendar");
check("Calendar is dark-ready (F4c)", isDarkReady("/admin/calendar"));
check("Coverage is dark-ready (F4d)", isDarkReady("/admin/coverage"));
check(
  "appearance: System, Light, Dark over the shared theme values",
  APPEARANCE_OPTIONS.map((option) => `${option.value}:${option.label}`).join() === "auto:System,light:Light,dark:Dark",
);
check("a ready path and its children go dark", isDarkReady("/admin/today/add", ["/admin/today"]));
check("a ready path does not leak to siblings", !isDarkReady("/admin/todays", ["/admin/today"]));

check("visit and coverage links", visitHref("a b") === "/admin/today?visit=a%20b" && coverageHref("x") === "/admin/coverage?prop=x");

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

// --- F3a: Today (A17, A24-A27, A36) ---

const D = "2026-10-07";
const tv = (id: string, date: string, extra: Partial<TodayVisit> = {}): TodayVisit => ({
  id,
  propId: `p-${id}`,
  propName: `Prop ${id}`,
  visitNumber: 3,
  workDate: date,
  slot: "early",
  startedAt: null,
  closedAt: null,
  routeVariantKey: "best",
  routeLengthM: 6200,
  team: [
    { id: "t", name: "Tom", left: false },
    { id: "a", name: "Ada", left: false },
  ],
  ...extra,
});
const figs = (rows: [string, Partial<VisitFigures>][]) => new Map(rows.map(([id, f]) => [id, { ...NO_FIGURES, ...f }]));

check("long date", longDate(D) === "Wednesday 7 October");
check("day numeral", dayNumeral(D).day === "7" && dayNumeral(D).weekday === "Wed");
check("day labels", dayLabel(D, D) === "Today" && dayLabel("2026-10-08", D) === "Tomorrow" && dayLabel("2026-10-09", D) === "Fri 9 Oct");
const sched = scheduleDays(
  [
    tv("old", "2026-10-01"),
    tv("late", D, { slot: "late", propName: "B" }),
    tv("done", D, { closedAt: "x", propName: "A" }),
    tv("early", D, { slot: "early", propName: "Z" }),
    tv("fri", "2026-10-09"),
    tv("friClosed", "2026-10-10", { closedAt: "x" }),
  ],
  D,
);
check("schedule: today and tomorrow always, later dates with visits, no past", sched.map((d) => d.date).join(",") === "2026-10-07,2026-10-08,2026-10-09", sched.map((d) => d.date).join(","));
check("schedule: open by slot, done last", sched[0]?.visits.map((v) => v.id).join(",") === "early,late,done");
check("schedule: tomorrow empty", sched[1]?.visits.length === 0 && emptyDayLine(sched[1]!.date, D) === "Nothing planned yet" && emptyDayLine(D, D) === "No one is out today");
check("team ignores people who left", teamLine(tv("x", D, { team: [{ id: "1", name: "Tom", left: false }, { id: "2", name: "Sam", left: true }] })) === "Tom" && activeTeam(tv("y", D)).length === 2);
check("card status", cardStatus(tv("a", D), D, true) === "live" && cardStatus(tv("b", D, { startedAt: "s" }), D, false) === "out" && cardStatus(tv("c", D), D, false) === "not-started" && cardStatus(tv("d", D, { closedAt: "x" }), D, false) === "done" && cardStatus(tv("e", "2026-10-09"), D, true) === null);
const NOW = Date.parse("2026-10-07T12:00:00Z");
check("ago", ago("2026-10-07T11:54:00Z", NOW) === "6 min ago" && ago("2026-10-07T11:59:45Z", NOW) === "20 s ago" && ago("2026-10-07T09:00:00Z", NOW) === "3 h ago" && ago("2026-10-04T12:00:00Z", NOW) === "3 days ago");
check("card meta", cardMeta(tv("a", D), { lastKnockAt: "2026-10-07T11:54:00Z" }, NOW) === "Visit 3 · Early · 6 min ago" && cardMeta(tv("a", D, { slot: null }), null, NOW) === "Visit 3");
check("sheet meta", sheetMeta(tv("a", D), D) === "Visit 3 · today · Early slot" && sheetMeta(tv("a", "2026-10-09", { slot: "mid" }), D) === "Visit 3 · Fri 9 Oct · Mid slot");
const tf = figs([
  ["t1", { worked: 312, contacts: 22, leads: 4, answered: 88 }],
  ["t2", { worked: 113, contacts: 14, leads: 2, answered: 30 }],
  ["f", { worked: 999 }],
]);
const totals = dayTotals([tv("t1", D), tv("t2", D), tv("f", "2026-10-09")], tf, D);
check("day totals: today only", totals.doors === 425 && totals.contacts === 36 && totals.leads === 6 && totals.answered === 118, JSON.stringify(totals));

const stale3 = staleVisits([tv("s1", "2026-10-03"), tv("s2", "2026-10-05", { propName: "B" }), tv("s3", "2026-10-05", { propName: "A" }), tv("closed", "2026-10-01", { closedAt: "x" }), tv("t", D)], D);
check("stale: open past only, newest first", stale3.map((v) => v.id).join(",") === "s3,s2,s1");
const sf = figs([["s3", { knocks: 214 }]]);
check("attention line", attentionLine(stale3, sf)?.title === "3 past visits still open" && attentionLine(stale3, sf)?.detail === "2 have no knocks synced. Review and end them.");
check("attention: all empty, one, none", attentionLine([stale3[1]!], sf)?.detail === "It has no knocks synced. Review and end it." && attentionLine([stale3[0]!], sf)?.detail === "Review and end it." && attentionLine([], sf) === null);
const groups3 = staleGroups(stale3);
check("stale visits grouped by date", groups3.length === 2 && groups3[0]?.label === "Mon 5 October" && groups3[0]?.visits.length === 2);
const split = splitReview(stale3, new Set(["s3", "s2"]), sf, D);
check("past visits are all ended, unticked kept", split.end.map((v) => v.id).join() === "s3,s2" && split.remove.length === 0);
check("a visit still ahead with no knocks is deleted", splitReview([tv("fut", "2026-10-09")], new Set(["fut"]), sf, D).remove.length === 1);
const startedEmpty = tv("se", "2026-10-04", { startedAt: "2026-10-04T08:00:00Z" });
check(
  "once its day has come a visit is ended, never deleted (owner 2026-10-08)",
  mustEnd(startedEmpty, undefined, D) && mustEnd(tv("n", D), undefined, D) && mustEnd(tv("p", "2026-10-01"), undefined, D) && splitReview([startedEmpty], new Set(["se"]), sf, D).end.length === 1,
);
check("only a visit still ahead, with no knocks, can be deleted", !mustEnd(tv("f", "2026-10-08"), undefined, D) && mustEnd(tv("f", "2026-10-08"), { knocks: 1 }, D));
check("review row for an empty visit", reviewRowMeta(startedEmpty, undefined) === "Visit 3 · Tom and Ada · no knocks synced");
check("review button", reviewButton(6, 15) === "End 6 and delete 15" && reviewButton(1, 0) === "End 1 visit" && reviewButton(0, 2) === "Delete 2 visits" && reviewButton(0, 0) === "Tick the visits to close");
const rc = reviewConfirm(6, 15);
check("review confirm both", rc.title === "End 6 visits and delete 15?" && rc.body === "The 15 never started, so nothing is lost. The 6 ended visits keep all their knocks." && rc.confirm === "End and delete");
check("review confirm single kinds", reviewConfirm(0, 1).confirm === "Delete visit" && reviewConfirm(2, 0).title === "End 2 visits?");
check("review row", reviewRowMeta(stale3[0]!, sf.get("s3")) === "Visit 3 · Tom and Ada · 214 knocks" && reviewRowMeta(tv("n", D, { team: [] }), undefined) === "Visit 3 · No one · no knocks synced");
check("selection line", selectionLine(21, 21) === "All 21 selected" && selectionLine(3, 21) === "3 of 21 selected");

const ev = endVisitConfirm(tv("w", D, { propName: "Whitechurch Lane - Hartcliffe" }), { kind: "close", worked: 312, total: 1682, countsForRotation: false });
check("end visit confirm", ev.title === "End visit 3 of Whitechurch Lane - Hartcliffe?" && ev.body === "Tom and Ada stop logging here. 1,370 doors weren't reached. It is under the visit threshold, so the next visit is still visit 3." && ev.confirm === "End visit", ev.body);
check("end visit counts", endVisitConfirm(tv("w", D), { kind: "close", worked: 10, total: 10, countsForRotation: true }).body === "Tom and Ada stop logging here. Every door was reached. It counts as visit 3.");
check("end visit, one person, nothing known", endVisitConfirm(tv("w", D, { team: [{ id: "s", name: "Sam", left: false }] }), { kind: "close", worked: 0, total: 0, countsForRotation: false }).body === "Sam stops logging here. It is under the visit threshold, so the next visit is still visit 3.");
check("delete visit confirm", endVisitConfirm(tv("w", D), { kind: "delete" }).confirm === "Delete visit");

check("default visit date", defaultVisitDate(null, D) === "2026-10-08" && defaultVisitDate("2026-10-01", D) === "2026-10-08" && defaultVisitDate(D, D) === D && defaultVisitDate("junk", D) === "2026-10-08");
check("allocate button", allocateButton(["Tom", "Ada"], D) === "Allocate Tom and Ada · Wed 7 Oct" && allocateButton([], D) === "Pick the team");
const opts = teamOptions(
  [
    { id: "s", name: "Sam" },
    { id: "t", name: "Tom" },
    { id: "l", name: "Leon" },
  ],
  [
    { canvasserId: "s", workDate: D, propName: "REF - Speedwell" },
    { canvasserId: "l", workDate: "2026-10-09", propName: "X" },
  ],
  D,
);
check("team options sorted, busy that date only", opts.map((o) => o.name).join() === "Leon,Sam,Tom" && opts[1]?.busyWith === "REF - Speedwell" && opts[0]?.busyWith === null);
check("add person: free and not already on", addableCanvassers(opts, tv("v", D)).map((o) => o.id).join() === "l");
check("door label ladder", doorLabelLine({ house_number: "41", street_name: "Bishport Ave" }) === "41 Bishport Ave" && doorLabelLine({ building_name: "Court", street_name: "X St" }) === "Court, X St" && doorLabelLine(null) === null);
check("route line", routeLine({ routeLengthM: 6200, routeVariantKey: "best_reversed" }) === "Route B · 6.2 km" && routeLine({ routeLengthM: null, routeVariantKey: null }) === "No route yet");

const avRows = [
  { row: prop("Due one", [visit(1, "2026-08-01", { closedAt: "x" })]), doors: 10 },
  { row: prop("Booked", [visit(1, "2026-08-01", { closedAt: "x" }), visit(2, "2026-10-08")]), doors: 5 },
  { row: prop("Ended that day", [visit(1, "2026-08-01", { closedAt: "x" }), visit(2, "2026-10-08", { closedAt: "y", countsForRotation: false })]), doors: 7 },
  { row: prop("Fresh", [visit(1, "2026-10-06", { closedAt: "x" })]), doors: null },
  { row: prop("Gone", [], "2026-10-01T00:00:00Z"), doors: 1 },
].map((item) => ({ ...item, state: propState(item.row, D) }));
const av = addVisitGroups(avRows, "2026-10-08");
check("add visit: due first, archived out, ended-that-day still booked", av.due.map((i) => i.row.name).join() === "Due one,Ended that day" && av.due[1]?.booked === true && av.other.map((i) => i.row.name).join() === "Fresh,Booked", av.other.map((i) => i.row.name).join());
check("add visit lines", addVisitLine(av.due[0]!, "2026-10-08") === "10 doors · visit 2 · last 1 Aug" && addVisitLine(av.other[1]!, "2026-10-08") === "Already booked on 8 Oct");

// --- F4a: Calendar (A38-A46) ---

const PA = "11111111-1111-4111-8111-111111111111";
const PB = "22222222-2222-4222-8222-222222222222";
const T7 = "2026-10-07";
check("london day crosses midnight in BST", londonDay("2026-10-01T23:30:00Z") === "2026-10-02" && londonDay("2026-10-01T22:59:00Z") === "2026-10-01");
check("london time, summer and winter", londonTime("2026-10-01T15:10:00Z") === "16:10" && londonTime("2026-12-01T15:10:00Z") === "15:10");
check("month param", parseMonth("2026-13", T7) === "2026-10" && parseMonth("2026-02", T7) === "2026-02" && parseMonth(null, T7) === "2026-10");
check("day param", parseDay("2026-02-30") === null && parseDay("2026-10-01") === "2026-10-01" && parseDay("x") === null);
check("shift month", shiftMonth("2026-01", -1) === "2025-12" && shiftMonth("2026-12", 1) === "2027-01");
check("month title", monthTitle("2026-10") === "October 2026");
const oct = monthGrid("2026-10");
check("grid: Monday first, 5 weeks for October 2026", oct.length === 5 && oct[0]![0]!.date === "2026-09-28" && oct[4]![6]!.date === "2026-11-01" && !oct[0]![0]!.inMonth && oct[0]![3]!.inMonth);
check("grid: 6 weeks when needed (March 2026)", monthGrid("2026-03").length === 6);
check("grid span", gridSpan("2026-10").from === "2026-09-28" && gridSpan("2026-10").to === "2026-11-01");
check("outcome groups", outcomeKey("not_interested") === "refused" && outcomeKey("inaccessible") === "cantReach" && outcomeKey("no_opportunity") === "rented");

const cv = (id: string, extra: Partial<CalendarVisit>): CalendarVisit => ({
  id,
  propId: PA,
  propName: `Prop ${id}`,
  visitNumber: 2,
  workDate: "2026-10-01",
  slot: "mid",
  startedAt: null,
  closedAt: null,
  remaining: 100,
  worked: null,
  team: [{ id: "s", name: "Sam", left: false }],
  ...extra,
});
const cVisits = [
  cv("vA", { propName: "Whitechurch", closedAt: "x", startedAt: "s" }),
  cv("vB", { propId: PB, propName: "REF - Speedwell", visitNumber: 5, workDate: "2026-09-30", slot: "early", closedAt: "x", startedAt: "s" }),
  cv("vC", { propName: "TEST - dry run", workDate: "2026-10-04", slot: "late" }),
  cv("vD", { workDate: "2026-10-09" }),
  cv("vE", { workDate: "2026-10-03", closedAt: "x" }),
  cv("vF", { workDate: "2026-10-05", startedAt: "2026-10-05T08:00:00Z" }),
  cv("vG", { workDate: "2026-10-06", worked: 40 }),
];
const ck = (assignmentId: string, uprn: number, outcome: string, canvasserId: string, occurredAt: string) => ({ assignmentId, uprn, outcome, canvasserId, occurredAt });
const cal = buildCalendar({
  knocks: [
    ck("vA", 1, "answered", "t", "2026-10-01T15:10:00Z"),
    ck("vA", 2, "lead", "a", "2026-10-01T16:00:00Z"),
    ck("vA", 3, "no_opportunity", "t", "2026-10-01T18:35:00Z"),
    ck("vA", 4, "no_answer", "t", "2026-10-01T23:30:00Z"),
    ck("vB", 9, "refused", "s", "2026-10-01T13:55:00Z"),
    ck("vB", 8, "inaccessible", "s", "2026-10-01T16:40:00Z"),
    ck("gone", 7, "answered", "s", "2026-10-01T12:00:00Z"),
  ],
  visits: cVisits,
  leads: [
    { assignmentId: "vA", occurredAt: "2026-10-01T16:00:00Z", status: "sale" },
    { assignmentId: "vA", occurredAt: "2026-10-01T16:00:00Z", status: "pending" },
  ],
  names: new Map([
    ["t", "Tom"],
    ["a", "Ada"],
    ["s", "Sam"],
  ]),
  today: T7,
});
const d1 = cal.get("2026-10-01") ?? [];
check("a day lists its worked visits, earliest first", d1.map((e) => e.visit.id).join() === "vB,vA", d1.map((e) => e.visit.id).join());
const eA = d1.find((e) => e.visit.id === "vA")!;
check("worked visit figures", eA.kind === "worked" && eA.worked === 3 && eA.outcomes.contacts === 1 && eA.outcomes.leads === 1 && eA.outcomes.rented === 1);
check("people and time on the doors", peopleLine(eA) === "Ada and Tom · 16:10–19:35" && peopleLine(eA, true) === "Ada and Tom · 16:10–19:35 on the doors");
check("lead results", leadResultsLine(eA.leadResults) === "2 leads · 1 sale · 1 awaiting" && leadResultsLine({}) === "No leads" && leadResultRows(eA.leadResults).map((r) => r.label).join() === "Sale,Awaiting");
const eB = d1.find((e) => e.visit.id === "vB")!;
check("allocated for another day (A45)", allocatedNote(eB) === "Allocated for Wed 30 Sep" && allocatedNote(eA) === null);
check("outcomes line", outcomesLine(eB.outcomes) === "2 other" && outcomesLine(eA.outcomes) === "1 contact · 1 lead · 1 rented");
check("knocks after midnight land on the next day", (cal.get("2026-10-02") ?? []).map((e) => `${e.visit.id}:${e.worked}`).join() === "vA:1");
check("day summary", daySummary(d1) === "2 worked · 5 doors · 1 lead" && daySummary(cal.get("2026-10-02")!) === "1 visit · 1 door · 0 leads", daySummary(d1));
check("entry meta", entryMeta(eA.visit) === "Visit 2 · Mid slot" && entryMeta({ visitNumber: 1, slot: null }) === "Visit 1");
const eC = cal.get("2026-10-04")![0]!;
const nC = notWorkedCopy(eC);
check("not worked: end only, never delete (owner 2026-10-08)", eC.kind === "not-worked" && nC.canEnd && nC.line === "Planned for Sam. No knocks have synced. Ending it keeps any that arrive late.");
check("a visit knocked only outside the grid is not 'not worked'", !cal.has("2026-10-06") && cal.get("2026-10-05")![0]!.kind === "not-worked");
check("planned and ended-empty kinds", cal.get("2026-10-09")![0]!.kind === "planned" && cal.get("2026-10-03")![0]!.kind === "ended" && daySummary(cal.get("2026-10-09")!) === "1 planned");
check("a knock on an unknown visit is ignored", ![...cal.values()].flat().some((e) => e.visit.id === "gone"));
const cell1 = dayCell(d1);
check("cell: solid bars and doors", cell1.bars.length === 2 && cell1.bars.every((b) => b.solid) && cell1.doors === 5 && cell1.more === 0);
check("cell: dashed for not worked, nothing for ended-empty", dayCell(cal.get("2026-10-04")).bars[0]?.solid === false && dayCell(cal.get("2026-10-03")).bars.length === 0 && dayCell(undefined).doors === 0);
const mt = monthTotals(cal, "2026-10");
check("month totals", mt.daysWorked === 2 && mt.doors === 6 && mt.leads === 1, JSON.stringify(mt));
check("calendar links", calendarHref("2026-10", "2026-10-01") === "/admin/calendar?month=2026-10&day=2026-10-01" && calendarHref("2026-10") === "/admin/calendar?month=2026-10");
check("open on map (A44)", openOnMapHref(eA) === `/admin/coverage?prop=${PA}&date=2026-10-01&visit=2&via=calendar`);
check("swipe", swipeMonth(-80, 10) === 1 && swipeMonth(80, 10) === -1 && swipeMonth(30, 0) === 0 && swipeMonth(80, 70) === 0);

// --- F4a: Coverage filters (A32, A44) ---

const f1 = parseFilters({ prop: PA, date: "2026-10-01", visit: "2", via: "calendar" }, T7);
check("filters from Calendar", f1.prop === PA && f1.from === "2026-10-01" && f1.to === "2026-10-01" && f1.visit === 2 && f1.via === "calendar");
check("filters round-trip", filtersHref(f1, T7) === `/admin/coverage?prop=${PA}&date=2026-10-01&visit=2&via=calendar` && filterCount(f1, T7) === 3 && filterCountLine(f1, T7) === "3 filters");
const THIRTY = { from: "2026-09-08", to: T7 };
check(
  "junk filters are dropped",
  JSON.stringify(parseFilters({ prop: "x", from: "2026-02-30", visit: "0", outcome: "blue", slot: "dawn", who: "bob" }, T7)) === JSON.stringify({ ...NO_FILTERS, ...THIRTY }),
);
const fSwap = parseFilters({ from: "2026-10-05", to: "2026-10-01" }, T7);
check("a backwards range is turned round", fSwap.from === "2026-10-01" && fSwap.to === "2026-10-05" && filtersHref(fSwap, T7) === "/admin/coverage?from=2026-10-01&to=2026-10-05");
const fOpen = parseFilters({}, T7);
check("Coverage opens on the last 30 days, not counted as a filter", fOpen.from === THIRTY.from && fOpen.to === T7 && filtersHref(fOpen, T7) === "/admin/coverage" && filterCountLine(fOpen, T7) === null && !periodIsFilter(fOpen, T7));
const fAll = parseFilters({ period: "all" }, T7);
check("all time is period=all", fAll.from === null && fAll.to === null && filtersHref(fAll, T7) === "/admin/coverage?period=all" && filterCount(fAll, T7) === 1);
const fProp = parseFilters({ prop: PA }, T7);
check("one prop opens on all time", fProp.from === null && filtersHref(fProp, T7) === `/admin/coverage?prop=${PA}` && filterCount(fProp, T7) === 1);
check("removing the prop goes back to 30 days, picked days stay", withoutProp(fProp, T7).from === THIRTY.from && withoutProp(f1, T7).from === "2026-10-01" && withoutProp(f1, T7).prop === null);
check("clear keeps the way back to Calendar", filtersHref(clearedFilters(f1, T7), T7) === "/admin/coverage?via=calendar");
check(
  "period labels",
  periodLabel({ from: null, to: null }, T7) === "All time" &&
    periodLabel({ from: T7, to: T7 }, T7) === "Today" &&
    periodLabel(periodOf("7", T7), T7) === "Last 7 days" &&
    periodLabel(periodOf("30", T7), T7) === "Last 30 days" &&
    periodLabel({ from: "2026-10-01", to: "2026-10-01" }, T7) === "Thu 1 Oct" &&
    periodLabel({ from: "2026-10-01", to: "2026-10-05" }, T7) === "1 Oct – 5 Oct" &&
    periodLabel({ from: "2026-10-01", to: null }, T7) === "Since 1 Oct",
);
check("chips", outcomeChip(null) === "All outcomes" && outcomeChip("contact") === "Contacts" && slotChip("early") === "Early slot" && slotChip(null) === "All slots" && visitChip(null) === "All visits" && visitChip(3) === "Visit 3" && whoChip(null, new Map()) === "Everyone" && whoChip("t", new Map([["t", "Tom"]])) === "Tom");
check("dot groups", outcomeGroup("answered") === "contact" && outcomeGroup("no_answer") === "notin" && outcomeGroup("callback") === "other");

const fv: CoverageVisit[] = [
  { id: "v1", propId: PA, visitNumber: 1, slot: "early" },
  { id: "v2", propId: PA, visitNumber: 2, slot: "mid" },
  { id: "v3", propId: PB, visitNumber: 1, slot: "early" },
];
const fr: CoverageRow[] = [
  { assignmentId: "v1", uprn: 100, outcome: "answered", canvasserId: "t", occurredAt: "2026-09-10T10:00:00Z" },
  { assignmentId: "v2", uprn: 100, outcome: "no_answer", canvasserId: "a", occurredAt: "2026-10-01T15:00:00Z" },
  { assignmentId: "v2", uprn: 101, outcome: "answered", canvasserId: "a", occurredAt: "2026-10-01T16:00:00Z" },
  { assignmentId: "v3", uprn: 200, outcome: "answered", canvasserId: "t", occurredAt: "2026-09-12T09:00:00Z" },
];
const allC = resolveDoors(fr, fv, NO_FILTERS);
check("no filters: latest knock across visits paints the door", allC.worked.size === 3 && allC.worked.get(100)?.group === "notin" && allC.painted === allC.worked);
const earlyC = resolveDoors(fr, fv, { ...NO_FILTERS, slot: "early", outcome: "contact" });
check("early-slot contacts (A32)", earlyC.painted.size === 2 && earlyC.painted.get(100)?.assignmentId === "v1" && earlyC.painted.has(200));
const dayC = resolveDoors(fr, fv, { ...NO_FILTERS, prop: PA, from: "2026-10-01", to: "2026-10-01" });
check("one prop on one day", dayC.worked.size === 2 && dayC.worked.get(100)?.group === "notin" && dayC.worked.get(101)?.group === "contact");
check("one canvasser", resolveDoors(fr, fv, { ...NO_FILTERS, who: "t" }).worked.size === 2);
const figs4 = coverageFigures([100, 101, 102], allC, NO_FILTERS);
check("figures: worked, contacts, not knocked", figs4.worked === 2 && figs4.contacts === 1 && figs4.leads === 0 && figs4.notKnocked === 1 && figs4.matched === null);
const figsEarly = coverageFigures([100, 101, 102, 200], earlyC, { ...NO_FILTERS, slot: "early", outcome: "contact" });
check("figures with an outcome filter", figsEarly.worked === 2 && figsEarly.matched === 2 && figsEarly.notKnocked === 2);
check("painted by outcome", paintedOf(allC.worked, "contact").size === 2 && paintedOf(allC.worked, null) === allC.worked);
check("matched label", matchedLabel({ outcome: "contact", slot: "early" }) === "Contacts, early" && matchedLabel({ outcome: "lead", slot: null }) === "Leads");
check(
  "scope line (frame 38)",
  scopeLine({ ...NO_FILTERS, prop: PA, visit: 2, from: "2026-10-01", to: "2026-10-01" }, dayC.painted, new Map([["a", "Ada"]]), [100, 101]) ===
    "Visit 2 · Thu 1 Oct · Ada · 16:00–17:00",
);
check("no scope line without a visit or day", scopeLine(NO_FILTERS, allC.painted, new Map(), [100]) === null);
check("door popup words", outcomeWords("inaccessible") === "Can't reach" && knockWhen("2026-10-01T15:42:00Z") === "Thu 1 Oct, 16:42" && doorMeta(2, "X") === "Visit 2 · X" && doorMeta(null, "X") === "X");

// ---- F5a: Team, canvasser profile, Leads, Insights, Settings (pure) ----------

console.log("\nF5a team");
const TODAY5 = "2026-10-09"; // a Friday
check("period default and parse", parseTeamPeriod(undefined) === "week" && parseTeamPeriod("4w") === "4w" && parseTeamPeriod("all") === "all" && parseTeamPeriod("x") === "week");
const wk = periodWindow("week", TODAY5);
check("this week is Monday to Sunday", wk.from === "2026-10-05" && wk.to === "2026-10-11");
check("this week on a Monday and a Sunday", periodWindow("week", "2026-10-05").from === "2026-10-05" && periodWindow("week", "2026-10-11").from === "2026-10-05");
const w4 = periodWindow("4w", TODAY5);
check("last 4 weeks is 28 days to today", w4.from === "2026-09-12" && w4.to === TODAY5);
check("all time has no start", periodWindow("all", TODAY5).from === null);
check(
  "period lines (frame 20)",
  periodLine("week", TODAY5) === "Mon 5 – Sun 11 October" &&
    periodLine("week", "2026-09-30") === "Mon 28 Sep – Sun 4 Oct" &&
    periodLine("4w", TODAY5) === "12 Sep – 9 Oct" &&
    periodLine("all", TODAY5) === "All time",
  periodLine("week", "2026-09-30"),
);
check("London days in the window (BST)", inWindow("2026-10-04T23:30:00Z", wk) && !inWindow("2026-10-04T22:30:00Z", wk));
check("query bounds a day wider", queryBounds(wk).fromAt === "2026-10-04T00:00:00Z" && queryBounds(wk).toAt === "2026-10-13T00:00:00Z" && queryBounds(periodWindow("all", TODAY5)).fromAt === null);

const k5 = (canvasserId: string, outcome: string, occurredAt: string, assignmentId = "v1", uprn = 1) => ({ assignmentId, uprn, outcome, canvasserId, occurredAt });
const knocks5 = [
  k5("t", "answered", "2026-10-05T09:00:00Z", "v1", 1),
  k5("t", "lead", "2026-10-05T09:10:00Z", "v1", 2),
  k5("t", "no_answer", "2026-10-06T09:00:00Z", "v2", 3),
  k5("t", "no_opportunity", "2026-10-06T09:05:00Z", "v2", 4),
  k5("t", "answered", "2026-09-20T09:00:00Z", "v0", 5),
  k5("a", "answered", "2026-10-07T10:00:00Z", "v3", 6),
  k5("a", "answered", "2026-10-07T10:05:00Z", "v3", 7),
  k5("a", "lead", "2026-10-07T10:10:00Z", "v3", 8),
  k5("a", "lead", "2026-10-07T10:15:00Z", "v3", 9),
];
const leads5: TeamLead[] = [
  { id: "l1", canvasserId: "t", occurredAt: "2026-10-05T09:10:00Z", status: "sale", uprn: 2, assignmentId: "v1" },
  { id: "l2", canvasserId: "a", occurredAt: "2026-10-07T10:10:00Z", status: "pending", uprn: 8, assignmentId: "v3" },
  { id: "l3", canvasserId: "a", occurredAt: "2026-10-07T10:15:00Z", status: "pm", uprn: 9, assignmentId: "v3" },
  { id: "l4", canvasserId: "t", occurredAt: "2026-09-01T10:00:00Z", status: "blowout", uprn: 10, assignmentId: "vx" },
];
const st = personStats(knocks5, leads5, wk);
const tom = st.get("t")!;
const ada = st.get("a")!;
check("doors, contacts, leads, days this week", tom.doors === 4 && tom.contacts === 1 && tom.leads === 1 && tom.days === 2 && ada.doors === 4 && ada.contacts === 2 && ada.leads === 2 && ada.days === 1);
check("doors answered is the broad rule", tom.answered === 3 && ada.answered === 4);
check("outcome groups", tom.outcomes.rented === 1 && tom.outcomes.notIn === 1 && tom.outcomes.contacts === 1);
check("settled and sales from the office status", tom.settled === 1 && tom.sales === 1 && ada.settled === 1 && ada.sales === 0);
const allSt = personStats(knocks5, leads5, periodWindow("all", TODAY5)).get("t")!;
check("all time counts everything", allSt.doors === 5 && allSt.contacts === 2 && allSt.settled === 2);
check("contact → lead uses contacts + leads", contactToLead(tom) === 0.5 && contactToLead(ada) === 0.5 && contactToLead({ contacts: 0, leads: 0 }) === null);
check("percent text", percentText(0.2069) === "21%" && percentText(null) === "–" && percentText(1) === "100%");

const people5: TeamPerson[] = [
  { id: "t", name: "Tom", active: true, canvasser: true },
  { id: "a", name: "Ada", active: true, canvasser: true },
  { id: "s", name: "Sam", active: true, canvasser: true },
  { id: "x", name: "Xan", active: false, canvasser: true },
  { id: "n", name: "Nomaan", active: true, canvasser: false },
];
const rows5 = teamRows(people5, st);
check("rows: active canvassers, plus anyone who knocked", rows5.map((row) => row.person.id).join() === "t,a,s");
check("sort by contact → lead: ties by name, no figure last", sortTeam(rows5, "conversion").map((row) => row.person.name).join() === "Ada,Tom,Sam");
check("sort by doors and by name", sortTeam(rows5, "doors").map((row) => row.person.name).join() === "Ada,Tom,Sam" && sortTeam(rows5, "name").map((row) => row.person.name).join() === "Ada,Sam,Tom");
check("sort parse", parseTeamSort("leads") === "leads" && parseTeamSort("nope") === "conversion" && parseTeamSort(null) === "conversion");
check("counts", peopleCount(1) === "1 canvasser" && peopleCount(4) === "4 canvassers" && daysLabel(0) === "No days" && daysLabel(1) === "1 day" && daysLabel(3) === "3 days");
check("hrefs keep the period", teamHref("week") === "/admin/team" && teamHref("4w", "doors") === "/admin/team?period=4w&sort=doors" && profileHref("t", "week") === "/admin/team/t" && profileHref("t", "all") === "/admin/team/t?period=all");

const f5 = funnel(tom);
check(
  "funnel: door → contact → lead → sale",
  f5.map((step) => `${step.label}:${percentText(step.rate)}`).join() === "Door → contact:50%,Contact → lead:50%,Lead → sale:100%" &&
    f5[0]!.detail === "2 of 4 doors" &&
    f5[1]!.detail === "1 of 2 contacts" &&
    f5[2]!.detail === "1 of 1 settled lead",
  f5.map((step) => step.detail).join(" | "),
);
const fNone = funnel(st.get("nobody") ?? { doors: 0, contacts: 0, leads: 0, answered: 0, days: 0, outcomes: tom.outcomes, settled: 0, sales: 0 });
check("funnel with nothing", fNone.every((step) => step.rate === null) && fNone[2]!.detail === "No leads settled yet" && fNone[0]!.detail === "No doors");
const propOf5 = new Map([["v1", "Whitechurch Lane"], ["v2", "Northville"], ["v3", "Redland"]]);
const days5 = recentDays(knocks5.filter((k) => k.canvasserId === "t"), propOf5, wk);
check("recent days newest first, per London day", days5.length === 2 && days5[0]!.date === "2026-10-06" && days5[0]!.props.join() === "Northville" && days5[1]!.contacts === 1 && days5[1]!.leads === 1);
check("day line and props line", dayLine(days5[1]!) === "1 contact · 1 lead · Whitechurch Lane" && doorsCount(2) === "2 doors" && doorsCount(1) === "1 door" && propsLine(["A", "B", "C"]) === "A and 2 more" && propsLine(["A"]) === "A");
check("recent doors newest first, in the window", recentDoors(knocks5.filter((k) => k.canvasserId === "t"), wk, 2).map((k) => k.uprn).join() === "4,3");
check("recent leads in the window", recentLeads(leads5.filter((l) => l.canvasserId === "t"), wk).map((l) => l.id).join() === "l1");
check(
  "profile line",
  profileLine(people5[0]!, tom, "week") === "Canvasser · 2 days this week" &&
    profileLine(people5[3]!, st.get("x") ?? { ...tom, days: 0 }, "4w") === "Inactive · no days in the last 4 weeks" &&
    profileLine(people5[4]!, { ...tom, days: 1 }, "all") === "Admin · 1 day in total",
);

console.log("\nF5a leads");
check("status labels", leadStatusLabel("pending") === "Awaiting" && leadStatusLabel("pm") === "Pitched" && leadStatusLabel("re_app") === "Re-app" && leadStatusLabel("utc") === "Unable to contact" && leadStatusLabel("zzz") === "Unknown");
check("status marks (frame 21)", leadMark("pending") === "awaiting" && leadMark("re_app") === "reapp" && leadMark("sale") === "sale" && leadMark("pm") === "pitched" && leadMark("blowout") === "closed" && leadMark("cancelled") === "closed");
const items5: LeadItem[] = [
  { id: "a", uprn: 1, door: "41 Bishport Avenue", propName: "Whitechurch Lane", canvasser: "Tom", occurredAt: "2026-10-09T13:10:00Z", status: "pending" },
  { id: "b", uprn: 2, door: null, propName: "Northville", canvasser: "Ada", occurredAt: "2026-10-08T08:05:00Z", status: "sale" },
  { id: "c", uprn: 3, door: "7 Fulford Road", propName: "Northville", canvasser: "Ada", occurredAt: "2026-09-27T10:00:00Z", status: "pending" },
  { id: "d", uprn: 4, door: "3 Whitchurch Lane", propName: "Ashton Gate", canvasser: "Leon", occurredAt: "2025-12-01T10:00:00Z", status: "re_app" },
];
check("door title falls back to the UPRN", doorTitle(items5[0]!) === "41 Bishport Avenue" && doorTitle(items5[1]!) === "UPRN 2");
check(
  "when line (London)",
  whenLine("2026-10-09T13:10:00Z", TODAY5) === "today 14:10" &&
    whenLine("2026-10-08T08:05:00Z", TODAY5) === "yesterday 09:05" &&
    whenLine("2026-09-27T10:00:00Z", TODAY5) === "27 Sep" &&
    whenLine("2025-12-01T10:00:00Z", TODAY5) === "1 Dec 2025",
);
check("row meta (frame 21)", leadMeta(items5[0]!, TODAY5) === "Whitechurch Lane · Tom · today 14:10");
const inWk = leadsInWindow(items5, wk);
check("leads in the period, newest first", inWk.map((item) => item.id).join() === "a,b" && leadsInWindow(items5, periodWindow("all", TODAY5)).map((item) => item.id).join() === "a,b,c,d");
const chips5 = statusChips(leadsInWindow(items5, periodWindow("all", TODAY5)));
check("status chips: All, then statuses with leads, office order", chips5.map((chip) => `${chip.label} ${chip.count}`).join() === "All 4,Awaiting 2,Re-app 1,Sale 1");
check("status filter", filterByStatus(items5, "pending").length === 2 && filterByStatus(items5, "all").length === 4 && parseStatusFilter("sale") === "sale" && parseStatusFilter("nope") === "all");
check("subtitle", leadsSubtitle(13, "week") === "13 this week · settled by the office" && leadsSubtitle(51, "all") === "51 in total · settled by the office");
check("show more and empty lines", showMoreLabel(50, 51) === "Show 1 more" && showMoreLabel(50, 200) === "Show 50 more" && emptyLeadsLine("all", "week") === "No leads this week." && emptyLeadsLine("sale", "4w") === "No sale leads in the last 4 weeks.");
check("leads href", leadsHref("week") === "/admin/leads" && leadsHref("all", "sale") === "/admin/leads?period=all&status=sale");

console.log("\nF5a insights");
const weeks5 = weekColumns(TODAY5, 3);
check("week columns: Mondays, oldest first", weeks5.join() === "2026-09-21,2026-09-28,2026-10-05" && weekLabel("2026-10-05") === "5 Oct");
const wr = weeklyRows(
  [
    { territory_id: "p1", name: "Whitechurch", iso_week: "2026-W41", week_start: "2026-10-05", worked: 120 },
    { territory_id: "p1", name: "Whitechurch", iso_week: "2026-W40", week_start: "2026-09-28", worked: 30 },
    { territory_id: "p2", name: "Northville", iso_week: "2026-W41", week_start: "2026-10-05", worked: 60 },
    { territory_id: "p3", name: "Old", iso_week: "2026-W30", week_start: "2026-07-20", worked: 500 },
  ],
  weeks5,
);
check("weekly rows: shown weeks only, busiest first, shared peak", wr.rows.map((row) => `${row.name}:${row.counts.join("/")}`).join() === "Whitechurch:0/30/120,Northville:0/0/60" && wr.peak === 120);
check("week totals and summary", weekTotals(wr.rows, weeks5).join() === "0,30,180" && weeksSummary(weeks5, weekTotals(wr.rows, weeks5)) === "21 Sep 0, 28 Sep 30, 5 Oct 180");
check("bar share: zero stays zero, small stays visible", barShare(0, 100) === 0 && barShare(1, 100) === 0.06 && barShare(50, 100) === 0.5 && barShare(5, 0) === 0);
const sr = slotRows([
  { slot: "early", worked: 200, answered: 50 },
  { slot: "mid", worked: 0, answered: 0 },
  { slot: "late", worked: 100, answered: 61 },
]);
check("slot rows", sr.map((row) => `${row.label}:${row.percent}`).join() === "Early:25%,Mid:–,Late:61%" && sr[0]!.detail === "50 of 200 doors" && sr[1]!.detail === "No doors");
const lob = leadOutcomeBars(["sale", "sale", "pending", "pm", "pending", "pending", "cancelled"]);
check("lead outcomes: all 8 statuses, office order, share of the largest", lob.bars.length === 8 && lob.total === 7 && lob.bars[0]!.label === "Awaiting" && lob.bars[0]!.share === 1 && lob.bars[2]!.count === 2 && lob.bars[4]!.count === 0 && lob.bars[7]!.mark === "closed");
const cr = completionRows([
  { territory_id: "p1", name: "B", knockable: 100, worked: 40, answered: 10, remaining: 60 },
  { territory_id: "p2", name: "A", knockable: 0, worked: 0, answered: 0, remaining: 0 },
  { territory_id: "p3", name: "C", knockable: 1000, worked: 100, answered: 50, remaining: 900 },
]);
check("completion rows: most left first, no percentage text", cr.map((row) => row.name).join() === "C,B,A" && cr[1]!.share === 0.4 && cr[2]!.share === 0 && completionLine(cr[0]!) === "100 worked · 900 left");
const sl = staleRows([
  { territory_id: "1", name: "Fresh", last_visited: "2026-10-01", stale: false },
  { territory_id: "2", name: "Older", last_visited: "2026-08-12", stale: true },
  { territory_id: "3", name: "Never", last_visited: null, stale: true },
  { territory_id: "4", name: "Oldest", last_visited: "2026-07-01", stale: true },
]);
check("stale rows: never first, then oldest", sl.map((row) => row.name).join() === "Never,Oldest,Older" && sl[0]!.line === "Never visited" && sl[2]!.line === "Last visited 12 Aug");
check("stale title", staleTitle(4) === "Not visited in 4 weeks" && staleTitle(1) === "Not visited in a week");

console.log("\nF5a settings");
check("threshold value and parse", thresholdValue(60) === "60% worked" && thresholdValue(62.5) === "62.5% worked" && parseThreshold("60") === 60 && parseThreshold(" 45% ") === 45 && parseThreshold("101") === null && parseThreshold("abc") === null && parseThreshold("") === null);
check("logging default", parseLoggingDefault("exceptions") === "exceptions" && parseLoggingDefault(null) === "every_door" && loggingLabel("exceptions") === "Exceptions only" && loggingLabel("every_door") === "Tap every door");
const acc5 = sortAccounts([
  { id: "s", name: "Sam", active: false, plannedVisits: 0 },
  { id: "t", name: "Tom", active: true, plannedVisits: 2 },
  { id: "a", name: "Ada", active: true, plannedVisits: 1 },
]);
check("accounts: active first, then by name", acc5.map((a) => a.name).join() === "Ada,Tom,Sam" && accountLine(acc5[0]!) === "Canvasser" && accountLine(acc5[2]!) === "Inactive · can't sign in");
check("planned warning", plannedWarning(acc5[1]!) === "Tom is on 2 planned visits. They stay on the team until you remove them on Today." && plannedWarning(acc5[2]!) === null && plannedWarning(acc5[0]!)?.includes("1 planned visit.") === true);
check("first name check", checkFirstName("  Leon ").ok && !checkFirstName("   ").ok && !checkFirstName("x".repeat(41)).ok);
const badEmail = checkEmail("leon@firsthome");
check(
  "email check (frame 24)",
  !badEmail.ok && badEmail.message === "Add the full address, like name@firsthome.co.uk" && checkEmail(" Leon@FirstHome.co.uk ").ok && (checkEmail(" Leon@FirstHome.co.uk ") as { value: string }).value === "leon@firsthome.co.uk" && !checkEmail("").ok,
);
check("invite button names the person", inviteButtonLabel("Leon") === "Send invite to Leon" && inviteButtonLabel("") === "Send invite");
check(
  "data rows",
  dataRows({ ncczZones: 26, properties: 424952, addressLabels: 133619, lastLoadAt: "2026-10-03T22:02:54Z" }).map((row) => `${row.label}=${row.value}`).join("|") ===
    "No Cold Calling zones=26 loaded|Properties=424,952|Address labels=133,619|Last data load=3 Oct 2026",
);
check("data rows when unknown", dataRows({ ncczZones: 0, properties: null, addressLabels: null, lastLoadAt: null }).map((row) => row.value).join() === "None loaded,–,–,–");
check("latest of two instants", latestOf("2026-09-16T20:31:06Z", "2026-10-03T22:02:54Z") === "2026-10-03T22:02:54Z" && latestOf(null, "x") === "x" && latestOf(null, null) === null);
check("build line", buildLine("82c922c1234") === "nakolabs-d2d · build 82c922c" && buildLine(undefined) === "nakolabs-d2d");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
