/**
 * UI-7 C1a (owner decisions H3, H5, U7-1..U7-5, 2026-10-04). Position maths
 * for /field: route snapping, distance along the route, the near-you chip's
 * hysteresis, the send throttle and the heading.
 *
 * Pure: no React, no browser APIs, no network, no storage, so it runs under
 * tsx and is checked by `npm run verify:ui7`. Nothing in this file stores or
 * sends a coordinate. See the brief's invariant 7 / Stage 16 amendments.
 */

export type LngLat = [number, number];

/** One GPS fix. Held in React state only, never stored. */
export type GeoFix = {
  lng: number;
  lat: number;
  /** Metres, from `coords.accuracy`. */
  accuracyM: number;
  /** Course over ground, `coords.heading`, degrees. Null when unknown. */
  courseDeg: number | null;
  /** `coords.speed`, metres per second. Null when unknown. */
  speedMps: number | null;
  /** `position.timestamp`, ms since epoch. */
  at: number;
};

/** A fix worse than this is "weak": dimmed, and never used for recentre, the chip or the scalar. */
export const WEAK_ACCURACY_M = 30;
/** Stage 16 rule 7: further than this from the route, the scalar is null. */
export const OFF_ROUTE_M = 100;
/** Snaps within this much of the closest one compete on continuity. */
export const CONTINUITY_SLACK_M = 15;
/** U7-2: at most one send per 30 s… */
export const SEND_INTERVAL_MS = 30_000;
/** …skipped when the canvasser moved less than this… */
export const MOVE_THRESHOLD_M = 10;
/** …except a heartbeat this often. */
export const HEARTBEAT_MS = 120_000;
/** A fix older than this is never sent. */
export const STALE_FIX_MS = 120_000;
/** The near-you chip changes only after this many agreeing fixes. */
export const CHIP_AGREE = 2;
/** GPS course is trusted as a heading only above walking-shuffle speed. */
export const COURSE_MIN_SPEED_MPS = 0.5;

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQUATOR = 111_320;

export function isWeakFix(fix: Pick<GeoFix, "accuracyM">): boolean {
  return !Number.isFinite(fix.accuracyM) || fix.accuracyM > WEAK_ACCURACY_M;
}

/** Any angle into [0, 360). */
export function normaliseDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d === 0 ? 0 : d;
}

/** Cheap equirectangular metres. Well under 1 % error across a prop. */
export function metresBetween(a: readonly number[], b: readonly number[]): number {
  const lat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const x = (b[0] - a[0]) * Math.cos(lat) * M_PER_DEG_LNG_EQUATOR;
  const y = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.hypot(x, y);
}

type XY = [number, number];

/**
 * The route line projected to local metres once, with cumulative length per
 * vertex. Every "along" this file returns is in SERVER metres
 * (`route_steps.cumulative_m` / `assignments.route_length_m`): the local
 * length is scaled to the server's, so door ranges, the partner scalar and
 * the RPC's range check all agree.
 */
export type RouteIndex = {
  origin: LngLat;
  cosLat: number;
  points: XY[];
  /** Local metres from the start to each vertex. `cum[0]` is 0. */
  cum: number[];
  /** Server metres per local metre. 1 when no server length is known. */
  scale: number;
  /** Route length in server metres. */
  lengthM: number;
};

function toXY(origin: LngLat, cosLat: number, p: readonly number[]): XY {
  return [
    (p[0] - origin[0]) * cosLat * M_PER_DEG_LNG_EQUATOR,
    (p[1] - origin[1]) * M_PER_DEG_LAT,
  ];
}

/**
 * Null for a missing line or one with fewer than two points (an unrouted
 * prop). `serverLengthM` is the last step's `cumulative_m`; omit it to keep
 * local metres.
 */
export function buildRouteIndex(
  line: ReadonlyArray<readonly number[]> | null | undefined,
  serverLengthM?: number | null,
): RouteIndex | null {
  if (!line || line.length < 2) return null;
  const origin: LngLat = [line[0][0], line[0][1]];
  const cosLat = Math.cos((origin[1] * Math.PI) / 180);
  const points = line.map((p) => toXY(origin, cosLat, p));
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const local = cum[cum.length - 1];
  const scale =
    typeof serverLengthM === "number" && serverLengthM > 0 && local > 0 ? serverLengthM / local : 1;
  return { origin, cosLat, points, cum, scale, lengthM: local * scale };
}

export type RouteSnap = {
  /** Server metres from the start of the route to the snapped point. */
  alongM: number;
  /** Metres from the point to the route line. */
  offsetM: number;
};

/** Going backwards along the route costs this many times more than going forwards. */
export const BACKWARD_COST = 4;

/**
 * Snap a point onto the route. `route_geom` walks most streets twice (once
 * per side), so the closest point is ambiguous. Every snap within
 * CONTINUITY_SLACK_M of the closest one is a candidate:
 *   - with no `previousAlongM`, the closest wins;
 *   - otherwise the cheapest move from `previousAlongM` wins, where a
 *     backward move costs BACKWARD_COST times a forward one, so the end of a
 *     street (where both passes meet) turns onto the return pass.
 * `range` (server metres) limits the search to one route step; it is ignored
 * when no segment overlaps it.
 */
export function snapToRoute(
  index: RouteIndex,
  point: readonly number[],
  previousAlongM: number | null,
  range?: readonly [number, number],
): RouteSnap {
  const restricted = range ? scan(index, point, range) : [];
  const candidates = restricted.length > 0 ? restricted : scan(index, point, null);
  let closest = Infinity;
  for (const candidate of candidates) closest = Math.min(closest, candidate.offsetM);
  let chosen: RouteSnap | null = null;
  let chosenCost = Infinity;
  for (const candidate of candidates) {
    if (candidate.offsetM > closest + CONTINUITY_SLACK_M) continue;
    let cost: number;
    if (previousAlongM === null) {
      cost = candidate.offsetM;
    } else {
      const move = candidate.alongM - previousAlongM;
      cost = move >= 0 ? move : -move * BACKWARD_COST;
    }
    if (cost < chosenCost) {
      chosen = candidate;
      chosenCost = cost;
    }
  }
  return chosen ?? { alongM: 0, offsetM: Infinity };
}

function scan(
  index: RouteIndex,
  point: readonly number[],
  range: readonly [number, number] | null,
): RouteSnap[] {
  const [px, py] = toXY(index.origin, index.cosLat, point);
  const out: RouteSnap[] = [];
  for (let i = 1; i < index.points.length; i++) {
    const [ax, ay] = index.points[i - 1];
    const [bx, by] = index.points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let tMin = 0;
    let tMax = 1;
    if (range) {
      const startM = index.cum[i - 1] * index.scale;
      const endM = index.cum[i] * index.scale;
      if (endM < range[0] || startM > range[1]) continue;
      if (len > 0) {
        tMin = Math.max(0, (range[0] - startM) / (len * index.scale));
        tMax = Math.min(1, (range[1] - startM) / (len * index.scale));
      }
    }
    const raw = len === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / (len * len);
    const t = Math.max(tMin, Math.min(tMax, raw));
    const offsetM = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    out.push({ alongM: (index.cum[i - 1] + t * len) * index.scale, offsetM });
  }
  return out;
}

/** The partner scalar in metres (1 dp), or null more than OFF_ROUTE_M from the route. */
export function routeScalar(snap: RouteSnap | null): number | null {
  if (!snap || !Number.isFinite(snap.offsetM) || snap.offsetM > OFF_ROUTE_M) return null;
  return Math.round(snap.alongM * 10) / 10;
}

/** The fields of a route step `doorAlongs` needs (`FieldRouteStep` has them). */
export type AlongStep = {
  first_seq: number | null;
  last_seq: number | null;
  /** Server metres at the END of the step. */
  cumulative_m: number;
};

/** A door in walk order: its coordinate and its snapshot position (`SequenceDoor.position`). */
export type AlongDoor = { lngLat: readonly number[]; position: number };

/**
 * Each door's distance along the route (server metres), in walk order.
 * A door inside a step's `first_seq..last_seq` is snapped within that step's
 * stretch of the route only, which settles which pass of the street it is on.
 * A door with no step (old-engine route, stranded tail) is snapped forward
 * from the previous door.
 */
export function doorAlongs(
  index: RouteIndex,
  doors: ReadonlyArray<AlongDoor>,
  steps: ReadonlyArray<AlongStep>,
): number[] {
  const ranges: { first: number; last: number; from: number; to: number }[] = [];
  let start = 0;
  for (const step of steps) {
    if (step.first_seq !== null && step.last_seq !== null) {
      ranges.push({ first: step.first_seq, last: step.last_seq, from: start, to: step.cumulative_m });
    }
    start = step.cumulative_m;
  }
  const out: number[] = [];
  let previous: number | null = null;
  for (const door of doors) {
    const owner = ranges.find((r) => door.position >= r.first && door.position <= r.last);
    const snap = owner
      ? snapToRoute(index, door.lngLat, null, [owner.from, owner.to])
      : snapToRoute(index, door.lngLat, previous);
    const along: number = Number.isFinite(snap.offsetM) ? snap.alongM : (previous ?? 0);
    out.push(along);
    previous = along;
  }
  return out;
}

/** The door nearest `alongM` along the route. -1 when there are no doors. Ties go to the lower index. */
export function nearestDoorIndex(alongs: ReadonlyArray<number>, alongM: number): number {
  let bestIndex = -1;
  let bestGap = Infinity;
  for (let i = 0; i < alongs.length; i++) {
    const gap = Math.abs(alongs[i] - alongM);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** Near-you chip hysteresis: `shown` changes only after CHIP_AGREE agreeing fixes. */
export type ChipState = { shown: number | null; candidate: number | null; streak: number };

export const CHIP_START: ChipState = { shown: null, candidate: null, streak: 0 };

export function stepChip(state: ChipState, next: number | null): ChipState {
  if (next === state.shown) return { shown: state.shown, candidate: null, streak: 0 };
  const streak = next === state.candidate ? state.streak + 1 : 1;
  if (streak >= CHIP_AGREE) return { shown: next, candidate: null, streak: 0 };
  return { shown: state.shown, candidate: next, streak };
}

/** The last fix that was sent. Memory only. */
export type SentMark = { at: number; lng: number; lat: number };

/** U7-2: at most every 30 s, skipped under 10 m of movement, heartbeat every 2 min, never a stale fix. */
export function shouldSend(last: SentMark | null, fix: GeoFix, now: number): boolean {
  if (now - fix.at > STALE_FIX_MS) return false;
  if (!last) return true;
  const elapsed = now - last.at;
  if (elapsed < SEND_INTERVAL_MS) return false;
  if (elapsed >= HEARTBEAT_MS) return true;
  return metresBetween([last.lng, last.lat], [fix.lng, fix.lat]) >= MOVE_THRESHOLD_M;
}

/** The fields of a DeviceOrientationEvent this file needs. */
export type OrientationReading = {
  /** iOS Safari only: degrees clockwise from true north. */
  webkitCompassHeading?: number | null;
  alpha: number | null;
  absolute: boolean;
};

/** Compass heading, clockwise from north. Null when the reading has no absolute reference. */
export function compassHeading(reading: OrientationReading, screenAngleDeg = 0): number | null {
  const ios = reading.webkitCompassHeading;
  if (typeof ios === "number" && Number.isFinite(ios)) return normaliseDeg(ios + screenAngleDeg);
  if (reading.absolute && typeof reading.alpha === "number" && Number.isFinite(reading.alpha)) {
    return normaliseDeg(360 - reading.alpha + screenAngleDeg);
  }
  return null;
}

/** GPS course as a heading, only when moving faster than COURSE_MIN_SPEED_MPS. */
export function courseHeading(fix: Pick<GeoFix, "courseDeg" | "speedMps">): number | null {
  if (fix.courseDeg === null || !Number.isFinite(fix.courseDeg)) return null;
  if (fix.speedMps === null || !(fix.speedMps > COURSE_MIN_SPEED_MPS)) return null;
  return normaliseDeg(fix.courseDeg);
}

/**
 * A radius in metres as pixels at zoom 22 (512 px tiles) at this latitude.
 * The map halves it per zoom level with an exponential-2 interpolate.
 */
export function accuracyPxAtZoom22(lat: number, accuracyM: number): number {
  const metresPerPx = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** 22);
  return accuracyM / metresPerPx;
}

/** "120 m ahead" / "80 m behind" / "next to you" / "1.2 km ahead"; null when either side is unknown or theirs is stale. */
export function partnerGapLabel(
  mineM: number | null,
  theirM: number | null,
  theirAt: string | null,
  now: number,
): string | null {
  if (mineM === null || theirM === null || theirAt === null) return null;
  const at = Date.parse(theirAt);
  if (!Number.isFinite(at) || now - at > HEARTBEAT_MS + SEND_INTERVAL_MS) return null;
  const gap = theirM - mineM;
  const size = Math.abs(gap);
  if (size < 15) return "next to you";
  const text = size >= 1000 ? `${(size / 1000).toFixed(1)} km` : `${Math.round(size / 10) * 10} m`;
  return `${text} ${gap > 0 ? "ahead" : "behind"}`;
}

/** What the maps draw for "you". Memory only. */
export type MapPosition = {
  lng: number;
  lat: number;
  accuracyM: number;
  /** Null when unknown, and always null for a weak fix (no cone). */
  heading: number | null;
  weak: boolean;
};

export function mapPositionOf(fix: GeoFix | null, heading: number | null, weak: boolean): MapPosition | null {
  if (!fix) return null;
  return { lng: fix.lng, lat: fix.lat, accuracyM: fix.accuracyM, heading: weak ? null : heading, weak };
}
