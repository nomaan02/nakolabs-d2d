/**
 * UI-7 C1a: browser-free checks for lib/field/geo.ts.
 * Synthetic fixtures only; no database, no network, no browser.
 *
 *   npm run verify:ui7
 */
import {
  CHIP_START,
  accuracyPxAtZoom22,
  buildRouteIndex,
  compassHeading,
  courseHeading,
  doorAlongs,
  isWeakFix,
  mapPositionOf,
  metresBetween,
  nearestDoorIndex,
  normaliseDeg,
  partnerGapLabel,
  routeScalar,
  shouldSend,
  snapToRoute,
  stepChip,
  type ChipState,
  type GeoFix,
  type LngLat,
} from "../lib/field/geo";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// Local metres -> lng/lat around a Bristol origin.
const ORIGIN: LngLat = [-2.55, 51.46];
const M_LNG = 1 / (111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180));
const M_LAT = 1 / 110_540;
const at = (x: number, y: number): LngLat => [ORIGIN[0] + x * M_LNG, ORIGIN[1] + y * M_LAT];

// A street walked twice (east on one side, back west on the other), then a spur north.
const ROUTE: LngLat[] = [at(0, 0), at(200, 0), at(0, 0), at(0, 100)];
const index = buildRouteIndex(ROUTE);

// 1. Route index
check("buildRouteIndex(null) is null", buildRouteIndex(null) === null);
check("buildRouteIndex(one point) is null", buildRouteIndex([at(0, 0)]) === null);
check("route length is 500 m", index !== null && near(index.lengthM, 500, 1), `${index?.lengthM}`);

// 2. Distance
check("metresBetween 100 m east", near(metresBetween(at(0, 0), at(100, 0)), 100, 0.5));
check("metresBetween 100 m north", near(metresBetween(at(0, 0), at(0, 100)), 100, 0.5));

if (index) {
  // 3. Continuity picks the pass you are on
  const firstPass = snapToRoute(index, at(50, 5), 40);
  check("snap with previous 40 stays on pass 1 (~50 m)", near(firstPass.alongM, 50, 1), `${firstPass.alongM}`);
  check("snap offset ~5 m", near(firstPass.offsetM, 5, 0.5), `${firstPass.offsetM}`);
  const secondPass = snapToRoute(index, at(50, -5), 330);
  check("snap with previous 330 stays on pass 2 (~350 m)", near(secondPass.alongM, 350, 1), `${secondPass.alongM}`);
  const spur = snapToRoute(index, at(4, 60), null);
  check("spur fix snaps to ~460 m", near(spur.alongM, 460, 1), `${spur.alongM}`);

  // 4. Off route means off (Stage 16 rule 7)
  const far = snapToRoute(index, at(100, 300), null);
  check("fix 300 m from the route has offset > 100", far.offsetM > 100, `${far.offsetM}`);
  check("routeScalar is null off route", routeScalar(far) === null);
  check("routeScalar(null) is null", routeScalar(null) === null);
  const onRoute = routeScalar(snapToRoute(index, at(100, 5), 90));
  check("routeScalar on route ~100.0", onRoute !== null && near(onRoute, 100, 1), `${onRoute}`);

  // 5. Door alongs in walk order, settled by the route steps
  const doors: LngLat[] = [
    ...[20, 60, 100, 140, 180].map((x) => at(x, 8)),
    ...[180, 140, 100, 60, 20].map((x) => at(x, -8)),
    at(8, 40),
    at(8, 80),
  ];
  const steps = [
    { first_seq: 0, last_seq: 4, cumulative_m: 200 },
    { first_seq: 5, last_seq: 9, cumulative_m: 400 },
    { first_seq: 10, last_seq: 11, cumulative_m: 500 },
  ];
  const doorInput = doors.map((lngLat, position) => ({ lngLat, position }));
  const expected = [20, 60, 100, 140, 180, 220, 260, 300, 340, 380, 440, 480];
  const alongs = doorAlongs(index, doorInput, steps);
  check(
    "doorAlongs follow the walk (both passes + spur)",
    alongs.length === expected.length && alongs.every((a, i) => near(a, expected[i], 1.5)),
    alongs.map((a) => a.toFixed(0)).join(","),
  );
  const noSteps = doorAlongs(index, doorInput.slice(0, 5), []);
  check(
    "doorAlongs with no steps still walks forward",
    noSteps.every((a, i) => near(a, expected[i], 1.5)),
    noSteps.map((a) => a.toFixed(0)).join(","),
  );

  // 5b. Server metres: a 450 m server length scales every along
  const scaled = buildRouteIndex(ROUTE, 450);
  const scaledSnap = scaled ? snapToRoute(scaled, at(100, 5), 80) : null;
  check("server length 450 scales the index", scaled !== null && near(scaled.lengthM, 450, 0.5));
  check("server metres: 100 m local reads as 90", scaledSnap !== null && near(scaledSnap.alongM, 90, 1), `${scaledSnap?.alongM}`);

  // 5c. End of the street turns onto the return pass
  const turn = snapToRoute(index, at(190, -5), 195);
  check("turnaround at the street end picks the return pass (~210)", near(turn.alongM, 210, 1), `${turn.alongM}`);
  const recheck = snapToRoute(index, at(60, 5), 80);
  check("a short step back on the same side stays on that pass (~60)", near(recheck.alongM, 60, 1), `${recheck.alongM}`);

  // 6. Nearest door
  check("nearestDoorIndex(255) is door 6 (260 m)", nearestDoorIndex(alongs, 255) === 6);
  check("nearestDoorIndex on no doors is -1", nearestDoorIndex([], 10) === -1);
  check("nearestDoorIndex tie goes to the lower index", nearestDoorIndex([10, 20], 15) === 0);

  // 7b. Walking 3 doors moves the chip ~3 doors with no flicker, on both passes
  const walk = (from: number, to: number, y: number, start: number | null) => {
    let state: ChipState = CHIP_START;
    let previous: number | null = start;
    const shown: number[] = [];
    const stepX = from < to ? 5 : -5;
    for (let x = from; from < to ? x <= to : x >= to; x += stepX) {
      const jitter = x % 10 === 0 ? 3 : -3;
      const snap = snapToRoute(index, at(x, y + jitter), previous);
      previous = snap.alongM;
      state = stepChip(state, nearestDoorIndex(alongs, snap.alongM));
      if (state.shown !== null) shown.push(state.shown);
    }
    return { last: state.shown, shown };
  };
  const out = walk(20, 140, 6, null);
  check("walk east 20->140 m ends with the chip on door 3", out.last === 3, `${out.last}`);
  check("chip never moves backwards walking east", out.shown.every((v, i) => i === 0 || v >= out.shown[i - 1]), out.shown.join(","));
  const back = walk(200, 60, -6, 195);
  check("walk back west 200->60 m on the return pass ends on door 8", back.last === 8, `${back.last}`);
  check("chip never moves backwards walking back", back.shown.every((v, i) => i === 0 || v >= back.shown[i - 1]), back.shown.join(","));
}

// 7. Hysteresis
let s: ChipState = CHIP_START;
s = stepChip(s, 3);
check("one fix does not change the chip", s.shown === null);
s = stepChip(s, 3);
check("two agreeing fixes show the chip", s.shown === 3);
s = stepChip(s, 4);
s = stepChip(s, 3);
s = stepChip(s, 4);
check("alternating fixes never move the chip", s.shown === 3);
s = stepChip(s, null);
s = stepChip(s, null);
check("two off-route fixes hide the chip", s.shown === null);
{
  // GL-C: the chip steps on a string key ("9,28") for two doors.
  let pair: ChipState<string> = CHIP_START;
  pair = stepChip(pair, "9,28");
  pair = stepChip(pair, "9,28");
  check("a two-door key needs two agreeing fixes too", pair.shown === "9,28");
  pair = stepChip(pair, "9");
  check("one fix does not change a two-door key", pair.shown === "9,28");
}

// 8. Send throttle (U7-2)
const NOW = 1_800_000_000_000;
const fixAt = (x: number, y: number, ageMs = 0): GeoFix => {
  const [lng, lat] = at(x, y);
  return { lng, lat, accuracyM: 8, courseDeg: null, speedMps: null, at: NOW - ageMs };
};
const mark = (ageMs: number) => {
  const [lng, lat] = at(0, 0);
  return { at: NOW - ageMs, lng, lat };
};
check("first send goes", shouldSend(null, fixAt(0, 0), NOW));
check("under 30 s never sends", !shouldSend(mark(10_000), fixAt(50, 0), NOW));
check("40 s, moved 5 m: skipped", !shouldSend(mark(40_000), fixAt(5, 0), NOW));
check("40 s, moved 20 m: sends", shouldSend(mark(40_000), fixAt(20, 0), NOW));
check("130 s, not moved: heartbeat sends", shouldSend(mark(130_000), fixAt(0, 0), NOW));
check("a 200 s old fix is never sent", !shouldSend(null, fixAt(0, 0, 200_000), NOW));

// 9. Heading
check("iOS compass 350", compassHeading({ webkitCompassHeading: 350, alpha: 0, absolute: false }) === 350);
check("iOS compass 10 + screen 90 = 100", compassHeading({ webkitCompassHeading: 10, alpha: 0, absolute: false }, 90) === 100);
check("absolute alpha 90 -> 270", compassHeading({ alpha: 90, absolute: true }) === 270);
check("relative alpha -> null", compassHeading({ alpha: 90, absolute: false }) === null);
check("no reading -> null", compassHeading({ webkitCompassHeading: null, alpha: null, absolute: false }) === null);
check("course 90 at 1 m/s -> 90", courseHeading({ courseDeg: 90, speedMps: 1 }) === 90);
check("course at 0.2 m/s -> null", courseHeading({ courseDeg: 90, speedMps: 0.2 }) === null);
check("no course -> null", courseHeading({ courseDeg: null, speedMps: 2 }) === null);
check("course -90 -> 270", courseHeading({ courseDeg: -90, speedMps: 2 }) === 270);
check("normaliseDeg(-30) = 330", normaliseDeg(-30) === 330);
check("normaliseDeg(720) = 0", normaliseDeg(720) === 0);

// 10. Weak fix and accuracy ring
check("accuracy 30 m is not weak", !isWeakFix({ accuracyM: 30 }));
check("accuracy 31 m is weak", isWeakFix({ accuracyM: 31 }));
check("NaN accuracy is weak", isWeakFix({ accuracyM: Number.NaN }));
const px = accuracyPxAtZoom22(51.46, 10);
check("10 m at 51.46N is ~860 px at z22", px > 850 && px < 870, px.toFixed(1));

// 11. Partner distance (scalar only)
const recent = new Date(NOW - 10_000).toISOString();
const stale = new Date(NOW - 200_000).toISOString();
check("120 m ahead", partnerGapLabel(100, 220, recent, NOW) === "120 m ahead");
check("80 m behind", partnerGapLabel(300, 220, recent, NOW) === "80 m behind");
check("next to you", partnerGapLabel(100, 105, recent, NOW) === "next to you");
check("1.2 km ahead", partnerGapLabel(0, 1240, recent, NOW) === "1.2 km ahead");
check("stale partner -> null", partnerGapLabel(100, 220, stale, NOW) === null);
check("unknown mine -> null", partnerGapLabel(null, 220, recent, NOW) === null);

// 12. Map position
check("no fix -> no map position", mapPositionOf(null, 90, false) === null);
const mp = mapPositionOf({ lng: -2.5, lat: 51.4, accuracyM: 40, courseDeg: null, speedMps: null, at: NOW }, 90, true);
check("weak fix drops the heading", mp !== null && mp.heading === null && mp.weak);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll UI-7 geo checks passed.");
