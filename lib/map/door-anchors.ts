/**
 * Door anchors (UI item 2, owner decision 2026-10-01): a door's DISPLAY
 * point is its position projected onto the pavement walkline of the route
 * step that works it, so a street reads as one even row of dots in door
 * order. Display only: the UPRN, the source data and every write are
 * unchanged. Doors with no work step keep their own point.
 */
export type AnchorStep = {
  kind: string | null;
  first_seq: number | null;
  last_seq: number | null;
  walk: [number, number][] | null;
};
export type AnchorDoor = { uprn: number; sequence: number; coordinates: [number, number] };
export type Anchored = AnchorDoor & { anchored: boolean };

/** Minimum gap between two neighbouring dots on one walkline, metres. */
export const MIN_GAP_M = 2.5;
/** Keep dots this far in from each end of a walkline, metres. */
export const END_INSET_M = 1.0;

type XY = [number, number];

function projector(lat0: number, lng0: number) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return {
    to: ([lng, lat]: [number, number]): XY => [(lng - lng0) * kx, (lat - lat0) * ky],
    from: ([x, y]: XY): [number, number] => [x / kx + lng0, y / ky + lat0],
  };
}

/** Distance along the polyline of the nearest point to p. */
function locate(line: XY[], cum: number[], p: XY): number {
  let best = Infinity;
  let along = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d = (p[0] - qx) ** 2 + (p[1] - qy) ** 2;
    if (d < best) {
      best = d;
      along = cum[i]! + t * Math.sqrt(len2);
    }
  }
  return along;
}

function pointAt(line: XY[], cum: number[], s: number): XY {
  for (let i = 0; i < line.length - 1; i++) {
    if (s <= cum[i + 1]! || i === line.length - 2) {
      const seg = cum[i + 1]! - cum[i]!;
      const t = seg === 0 ? 0 : Math.max(0, Math.min(1, (s - cum[i]!) / seg));
      const [ax, ay] = line[i]!;
      const [bx, by] = line[i + 1]!;
      return [ax + t * (bx - ax), ay + t * (by - ay)];
    }
  }
  return line[0]!;
}

/**
 * Place `along` values (already in door order) as close as possible to
 * where they are, with neighbours at least `gap` apart, all inside
 * [lo, hi], order preserved. Least-squares under the gap constraint:
 * substitute y_i = x_i - i*gap, which makes the constraint "y is
 * non-decreasing", and solve that with pool-adjacent-violators. A stack of
 * identical points (flats) therefore spreads evenly AROUND its shared
 * position, not off to one side. If the line is too short for the gap,
 * the doors are spaced evenly across it.
 */
export function spread(along: number[], lo: number, hi: number, gap: number): number[] {
  const n = along.length;
  if (n === 0) return [];
  if (hi < lo) return along.map(() => (lo + hi) / 2);
  if ((n - 1) * gap > hi - lo) {
    if (n === 1) return [(lo + hi) / 2];
    const step = (hi - lo) / (n - 1);
    return along.map((_, i) => lo + i * step);
  }
  // Pool-adjacent-violators on y_i = a_i - i*gap.
  const blocks: { sum: number; count: number }[] = [];
  along.forEach((a, i) => {
    blocks.push({ sum: a - i * gap, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.count <= last.sum / last.count) break;
      prev.sum += last.sum;
      prev.count += last.count;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const block of blocks) {
    const mean = block.sum / block.count;
    for (let k = 0; k < block.count; k++) out.push(mean + out.length * gap);
  }
  // Clamp into [lo, hi]. Both bounds rise by exactly `gap` per door, so the
  // gaps survive the clamp.
  return out.map((x, i) => Math.min(hi - (n - 1 - i) * gap, Math.max(lo + i * gap, x)));
}

export function anchorDoors(doors: AnchorDoor[], steps: AnchorStep[]): Anchored[] {
  if (doors.length === 0) return [];
  const lat0 = doors.reduce((s, d) => s + d.coordinates[1], 0) / doors.length;
  const lng0 = doors.reduce((s, d) => s + d.coordinates[0], 0) / doors.length;
  const pr = projector(lat0, lng0);
  const out = new Map<number, Anchored>();

  for (const step of steps) {
    if (step.kind !== "work" || step.first_seq === null || step.last_seq === null) continue;
    if (!step.walk || step.walk.length < 2) continue;
    const line = step.walk.map(pr.to);
    const cum = [0];
    for (let i = 1; i < line.length; i++) {
      cum.push(cum[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
    }
    const total = cum[cum.length - 1]!;
    if (total <= 0) continue;
    const mine = doors
      .filter((d) => d.sequence >= step.first_seq! && d.sequence <= step.last_seq!)
      .sort((a, b) => a.sequence - b.sequence);
    if (mine.length === 0) continue;
    const raw = mine.map((d) => locate(line, cum, pr.to(d.coordinates)));
    const inset = Math.min(END_INSET_M, total / 4);
    const placed = spread(raw, inset, total - inset, MIN_GAP_M);
    mine.forEach((d, i) => {
      out.set(d.uprn, { ...d, coordinates: pr.from(pointAt(line, cum, placed[i]!)), anchored: true });
    });
  }
  return doors.map((d) => out.get(d.uprn) ?? { ...d, anchored: false });
}
