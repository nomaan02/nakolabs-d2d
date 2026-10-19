"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * GL-C (owner C1, 2026-10-18). The fill floor: after a manual correction to
 * the other side of the road, or backwards, the next Exceptions-only fill
 * starts at the door moved to (`lib/field/inference.ts`, `floorIndex`).
 *
 * Held per prop and canvasser in localStorage, so a reload or a cold start
 * between the correction and the next log still skips the fill. Only a UPRN
 * is kept; nothing here reaches Supabase.
 */

const key = (assignmentId: string, canvasserId: string) => `d2d.fillFloor:${assignmentId}:${canvasserId}`;

function read(assignmentId: string | null, canvasserId: string | null): number | null {
  if (!assignmentId || !canvasserId) return null;
  try {
    const raw = localStorage.getItem(key(assignmentId, canvasserId));
    const uprn = raw === null ? NaN : Number(raw);
    return Number.isSafeInteger(uprn) && uprn > 0 ? uprn : null;
  } catch {
    return null;
  }
}

function write(assignmentId: string | null, canvasserId: string | null, uprn: number | null): void {
  if (!assignmentId || !canvasserId) return;
  try {
    if (uprn === null) localStorage.removeItem(key(assignmentId, canvasserId));
    else localStorage.setItem(key(assignmentId, canvasserId), String(uprn));
  } catch {
    // Storage blocked: the floor lasts for this page only.
  }
}

export function useFillFloor(
  assignmentId: string | null,
  canvasserId: string | null,
): {
  floorUprn: number | null;
  setFloorUprn: (uprn: number | null) => void;
  /** Clears the floor only if it is still `uprn` (a newer correction is kept). */
  clearFloorIf: (uprn: number) => void;
} {
  const [state, setState] = useState<{ owner: string; uprn: number | null }>({ owner: "", uprn: null });
  const owner = `${assignmentId ?? ""}:${canvasserId ?? ""}`;
  /** The live floor, for `clearFloorIf` called after an await. */
  const live = useRef<{ owner: string; uprn: number | null }>({ owner: "", uprn: null });

  // A new prop or canvasser reads its own floor.
  useEffect(() => {
    const next = { owner, uprn: read(assignmentId, canvasserId) };
    live.current = next;
    setState(next);
  }, [owner, assignmentId, canvasserId]);

  const setFloorUprn = useCallback(
    (uprn: number | null) => {
      write(assignmentId, canvasserId, uprn);
      live.current = { owner, uprn };
      setState({ owner, uprn });
    },
    [owner, assignmentId, canvasserId],
  );

  const clearFloorIf = useCallback(
    (uprn: number) => {
      const current = live.current.owner === owner ? live.current.uprn : read(assignmentId, canvasserId);
      if (current === uprn) setFloorUprn(null);
    },
    [owner, assignmentId, canvasserId, setFloorUprn],
  );

  // Until the read above has run for this owner, fall back to storage directly.
  const floorUprn = state.owner === owner ? state.uprn : read(assignmentId, canvasserId);
  return { floorUprn, setFloorUprn, clearFloorIf };
}
