export const SLOTS = ["early", "mid", "late"] as const;
export type Slot = (typeof SLOTS)[number];
export type SweepDirection = "cw" | "ccw";

export type Rotation = {
  visitNumber: number;
  entryVertexIndex: number;
  sweepDirection: SweepDirection;
  slot: Slot;
};

/**
 * The Stage 5 rotation rule. Same `visitNumber` and vertex count always
 * produce the same entry vertex, direction and slot — no randomness.
 *
 * `visitNumber` is `territories.visit_count + 1` at allocation time.
 * This helper does not increment anything.
 */
export function rotationForVisit(visitNumber: number, vertexCount: number): Rotation {
  if (vertexCount < 3) {
    throw new Error("A prop needs at least three vertices to rotate around.");
  }
  return {
    visitNumber,
    entryVertexIndex: visitNumber % vertexCount,
    sweepDirection: visitNumber % 2 === 0 ? "cw" : "ccw",
    slot: SLOTS[visitNumber % 3],
  };
}

export function formatSweep(direction: SweepDirection): string {
  return direction === "cw" ? "clockwise" : "anticlockwise";
}

export function formatSlot(slot: Slot): string {
  if (slot === "early") return "early";
  if (slot === "mid") return "mid";
  return "late";
}
