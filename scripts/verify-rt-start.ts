/**
 * RT-START P1 (owner 2026-10-19): browser- and database-free checks for the
 * per-visit route choice (lib/geo/walk/route-options.ts).
 *
 *   npm run verify:rt-start
 */
import {
  defaultRouteKey,
  distanceText,
  kmText,
  metresBetween,
  nextVisitLine,
  orderCheckOf,
  parseVisitRouteOptions,
  routeChangeable,
  routeChangeMessage,
  routeName,
  routeRank,
  routeSubline,
  routeTitle,
  sortRoutes,
  type RouteOption,
} from "../lib/geo/walk/route-options";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("1. Names and lines");
check("best is Route A", routeName("best") === "Route A");
check("best_reversed is Route B", routeName("best_reversed") === "Route B");
check("manual is Your route", routeName("manual") === "Your route");
check("manual_reversed", routeName("manual_reversed") === "Your route, reversed");
check("alt_3 is Alternative 3", routeName("alt_3") === "Alternative 3");
check("km to one decimal", kmText(30043) === "30.0 km", kmText(30043));
check("title", routeTitle({ key: "best_reversed", totalM: 30043 }) === "Route B · 30.0 km");
check("rank orders A, B, drawn, alternatives", ["alt_2", "manual", "best_reversed", "alt_1", "best"].sort((a, b) => routeRank(a) - routeRank(b)).join() === "best,best_reversed,manual,alt_1,alt_2");
check("sub line, default", routeSubline({ option: { startStreet: "Henleaze Road" }, isDefault: true }) === "Starts on Henleaze Road · default");
check("sub line, chosen", routeSubline({ option: { startStreet: "Waterford Road" }, isDefault: false, chosenBy: "Ada" }) === "Starts on Waterford Road · chosen by Ada");
check("sub line, nothing known", routeSubline({ option: null, isDefault: false }) === "Start not known");

console.log("\n2. Default by turns (mirrors 043)");
check("odd auto -> best", defaultRouteKey(1, false) === "best");
check("even auto -> best_reversed", defaultRouteKey(2, false) === "best_reversed");
check("odd drawn -> manual", defaultRouteKey(3, true) === "manual");
check("even drawn -> manual_reversed", defaultRouteKey(4, true) === "manual_reversed");
check("next visit line, auto", nextVisitLine(1, "best") === "Only this visit changes. Visit 2 goes back to Route B.", nextVisitLine(1, "best"));
check("next visit line, drawn", nextVisitLine(2, "manual_reversed") === "Only this visit changes. Visit 3 goes back to Your route.");

console.log("\n3. Parsing assignment_route_options");
const raw = {
  assignment_id: "a1",
  visit_number: 1,
  work_date: "2026-10-19",
  closed: false,
  knocks: 0,
  current_key: "best",
  default_key: "best",
  choice: null,
  chosen_by: null,
  chosen_at: null,
  source_id: "r1",
  routes: [
    { key: "best", total_m: 30043, hand: "right", start_lon: -2.6, start_lat: 51.48, start_street: "Henleaze Road", usable: true },
    { key: "best_reversed", total_m: "30043", hand: "left", start_lon: -2.61, start_lat: 51.481, start_street: " ", usable: true },
    { key: "alt_1", total_m: 30357, hand: "right", start_lon: null, start_lat: null, start_street: null, usable: false },
    { nonsense: true },
  ],
};
const parsed = parseVisitRouteOptions(raw);
check("parses", parsed !== null);
check("drops a malformed route", parsed?.routes.length === 3, String(parsed?.routes.length));
check("numeric strings read as numbers", parsed?.routes[1]?.totalM === 30043);
check("blank street is null", parsed?.routes[1]?.startStreet === null);
check("missing start is null", parsed?.routes[2]?.start === null);
check("usable carried", parsed?.routes[2]?.usable === false);
check("hand left", parsed?.routes[1]?.hand === "left");
check("not an object -> null", parseVisitRouteOptions(null) === null && parseVisitRouteOptions([]) === null);
check("no default key -> null", parseVisitRouteOptions({ ...raw, default_key: null }) === null);

console.log("\n4. Distances (on the device only)");
const henleaze = { lon: -2.6, lat: 51.48 };
const m = metresBetween(henleaze, { lon: -2.6, lat: 51.481 });
check("0.001 deg latitude is about 111 m", Math.abs(m - 111.2) < 1, m.toFixed(1));
check("short distance rounds to 10 m", distanceText(87) === "90 m");
check("never below 10 m", distanceText(2) === "10 m");
check("over 1 km in km", distanceText(1234) === "1.2 km");

console.log("\n5. Sorting the field list");
const routes: RouteOption[] = [
  { key: "best", totalM: 30000, hand: "right", start: { lon: -2.6, lat: 51.49 }, startStreet: "A", usable: true },
  { key: "best_reversed", totalM: 30000, hand: "right", start: { lon: -2.6, lat: 51.4801 }, startStreet: "B", usable: true },
  { key: "alt_1", totalM: 30400, hand: "right", start: { lon: -2.6, lat: 51.4805 }, startStreet: "C", usable: false },
  { key: "alt_2", totalM: 31000, hand: "right", start: null, startStreet: null, usable: true },
];
check("nearest usable first, unusable last", sortRoutes(routes, henleaze).map((r) => r.key).join() === "best_reversed,best,alt_2,alt_1", sortRoutes(routes, henleaze).map((r) => r.key).join());
check("no position: route order, unusable last", sortRoutes(routes, null).map((r) => r.key).join() === "best,best_reversed,alt_2,alt_1");
check("does not mutate", routes[0]!.key === "best");

console.log("\n6. When the route can change");
check("open, no knocks", routeChangeable({ closed: false, knocks: 0 }));
check("a server knock locks it", !routeChangeable({ closed: false, knocks: 1 }));
check("a knock still on this phone locks it", !routeChangeable({ closed: false, knocks: 0 }, 1));
check("an ended visit is locked", !routeChangeable({ closed: true, knocks: 0 }));

console.log("\n7. Refusals in plain words");
check("frozen", routeChangeMessage("frozen", "x") === "Someone has knocked on this visit, so its route is locked.");
check("stale routes", routeChangeMessage("stale_variant", "x") === routeChangeMessage("snapshot_mismatch", "y"));
check("offline or error", routeChangeMessage("unavailable", "x").startsWith("The route didn't change."));
check("unknown keeps the server's words", routeChangeMessage("bad_steps", "Server words") === "Server words");

console.log("\n8. Order check (mirrors assignment_route_options.order_check, 043)");
const six = [3, 4, 5, 6, 1, 2].map((uprn, sequence) => ({ uprn, sequence }));
check("small order", orderCheckOf(six) === 67, String(orderCheckOf(six)));
check("order matters", orderCheckOf([...six].reverse().map((d, i) => ({ uprn: d.uprn, sequence: i }))) !== 67);
check("10-digit UPRNs", orderCheckOf([{ uprn: 10015341584, sequence: 0 }, { uprn: 258743, sequence: 1 }]) === 829025, String(orderCheckOf([{ uprn: 10015341584, sequence: 0 }, { uprn: 258743, sequence: 1 }])));
check("empty is 0", orderCheckOf([]) === 0);
check("parsed from the RPC", parseVisitRouteOptions({ ...raw, order_check: "1287510698" })?.orderCheck === 1287510698);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
