"use client";

import { useCallback, useMemo } from "react";

import { useFieldData } from "@/components/field/field-data-provider";
import { useGeo } from "@/components/field/geo-provider";
import { useFillFloor } from "@/lib/field/fill-floor";
import { correctionSkipsFill, type PavementKey } from "@/lib/field/geo-lock";

/** What Undo needs to put a manual move back. */
export type CorrectionUndo = { fromIndex: number; previousFloor: number | null };

/**
 * GL-C (owner C1, C6; 2026-10-18). A manual move of the Logger's door: the
 * near-you chip, a door tapped on the mini map or the Map tab, a Survey pick.
 * To the other side of the road, or backwards, sets the fill floor so the
 * next Exceptions-only fill starts at the door moved to; a same-side forward
 * move fills as usual.
 *
 * The pavement of a door is its route work step (each pass of a stretch of
 * road is its own step); with no step, the distance test decides.
 */
export function useCorrectTo(): {
  correctTo: (toIndex: number) => CorrectionUndo | null;
  floorUprn: number | null;
  setFloorUprn: (uprn: number | null) => void;
  clearFloorIf: (uprn: number) => void;
} {
  const { phase, canvasserId, sequence, cursor, routeSteps } = useFieldData();
  const { doorAlongsM } = useGeo();
  const assignmentId = phase.kind === "ready" ? phase.assignment.assignment_id : null;
  const { floorUprn, setFloorUprn, clearFloorIf } = useFillFloor(assignmentId, canvasserId);
  const doorLngLats = useMemo(() => sequence.map((entry) => entry.lngLat), [sequence]);

  const pavementOf = useCallback(
    (index: number): PavementKey | null => {
      const entry = sequence[index];
      if (!entry) return null;
      const step = routeSteps.find(
        (row) =>
          row.first_seq !== null &&
          row.last_seq !== null &&
          entry.position >= row.first_seq &&
          entry.position <= row.last_seq,
      );
      if (!step || step.segment_id === null) return null;
      // `side` is the walker's hand, not a side of the road, so the pavement
      // is the work step itself: each pass of a stretch of road is its own step.
      return { street: `segment:${step.segment_id}`, side: `step:${step.step_index}` };
    },
    [sequence, routeSteps],
  );

  const correctTo = useCallback(
    (toIndex: number): CorrectionUndo | null => {
      const fromIndex = cursor.index;
      const target = sequence[toIndex];
      if (!target || toIndex === fromIndex) return null;
      const previousFloor = floorUprn;
      if (correctionSkipsFill({ fromIndex, toIndex, doorAlongsM, doorLngLats, pavementOf })) {
        setFloorUprn(target.uprn);
      }
      cursor.goTo(toIndex);
      return { fromIndex, previousFloor };
    },
    [cursor, sequence, floorUprn, setFloorUprn, doorAlongsM, doorLngLats, pavementOf],
  );

  return { correctTo, floorUprn, setFloorUprn, clearFloorIf };
}
