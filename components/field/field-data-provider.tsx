"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  cacheAssignment,
  clearCachedToday,
  getCachedToday,
  rememberCanvasser,
} from "@/lib/field/cache";
import { useCursor, type Cursor } from "@/lib/field/cursor";
import type { CachedAddress } from "@/lib/field/db";
import { ensureAddresses, readLabels, type DoorLabels } from "@/lib/field/labels";
import { useLocalOutcomes, type LocalOutcomes } from "@/lib/field/local-outcomes";
import { getSequence, type SequenceDoor } from "@/lib/field/sequence";
import {
  fetchTodaysAssignment,
  type TodaysAssignment,
  type TodaysAssignmentResult,
} from "@/lib/geo/todays-assignment";
import { createClient } from "@/lib/supabase/client";

/**
 * Loads the prop, the labels and the local outcome state ONCE for the whole
 * field shell, and hands them to all four tabs through context.
 *
 * Mounted from `app/(field)/layout.tsx`, which is shared by the four routes,
 * so navigating between tabs neither refetches the assignment nor re-reads
 * Dexie. `addresses_for_assignment` in particular runs at most once per prop:
 * it measured 748 ms cold on a 2,000-door prop, which is fine on open and
 * would not be fine per tab, let alone per door.
 */

export type FieldPhase =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; assignment: TodaysAssignment; fromCache: boolean };

export type LeadDraft = {
  clientEventId: string;
  bookedFor: string | null;
  notes: string;
};

type FieldData = {
  phase: FieldPhase;
  canvasserId: string | null;
  signedInAs: string;
  role: string;
  sequence: SequenceDoor[];
  labels: DoorLabels;
  outcomes: LocalOutcomes;
  cursor: Cursor;
  labelFor: (uprn: number) => CachedAddress | undefined;
  refreshLabels: () => void;
  /** Drafts survive a dismissed sheet and a tab switch; keyed on uprn. */
  leadDrafts: Map<number, LeadDraft>;
  setLeadDraft: (uprn: number, draft: LeadDraft | null) => void;
  noteDrafts: Map<number, string>;
  setNoteDraft: (uprn: number, note: string) => void;
};

const FieldDataContext = createContext<FieldData | null>(null);

export function useFieldData(): FieldData {
  const value = useContext(FieldDataContext);
  if (!value) throw new Error("useFieldData must be used inside FieldDataProvider");
  return value;
}

const LOAD_TIMEOUT_MS = 8_000;

export function FieldDataProvider({
  signedInAs,
  role,
  children,
}: {
  signedInAs: string;
  role: string;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<FieldPhase>({ kind: "loading" });
  const [canvasserId, setCanvasserId] = useState<string | null>(null);
  const [labels, setLabels] = useState<DoorLabels>(() => new Map());
  const [labelEpoch, setLabelEpoch] = useState(0);
  const [leadDrafts, setLeadDrafts] = useState<Map<number, LeadDraft>>(() => new Map());
  const [noteDrafts, setNoteDrafts] = useState<Map<number, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user.id ?? null;
      if (cancelled) return;
      setCanvasserId(uid);

      // No session (expired token, offline) falls back to the last canvasser
      // who loaded a prop on this device — see getCachedToday.
      const cached = await getCachedToday(uid).catch(() => undefined);
      if (cancelled) return;
      if (cached) {
        if (!uid) setCanvasserId(cached.canvasser_id);
        setPhase({ kind: "ready", assignment: cached.payload, fromCache: true });
      }

      const result = await Promise.race([
        fetchTodaysAssignment(supabase),
        new Promise<Extract<TodaysAssignmentResult, { ok: false }>>((resolve) => {
          window.setTimeout(
            () =>
              resolve({
                ok: false,
                message: "Today's prop could not be loaded. Check your connection and try again.",
              }),
            LOAD_TIMEOUT_MS,
          );
        }),
      ]);
      if (cancelled) return;

      if (result.ok && uid) await rememberCanvasser(uid).catch(() => undefined);

      if (result.ok && result.assignment) {
        if (uid) await cacheAssignment(result.assignment, uid).catch(() => undefined);
        if (cancelled) return;
        setPhase({ kind: "ready", assignment: result.assignment, fromCache: false });
        return;
      }

      if (result.ok && result.assignment === null) {
        if (uid) await clearCachedToday(uid).catch(() => undefined);
        if (cancelled) return;
        setPhase({ kind: "empty" });
        return;
      }

      if (!result.ok) {
        if (cached) {
          setPhase({ kind: "ready", assignment: cached.payload, fromCache: true });
          return;
        }
        setPhase({ kind: "error", message: result.message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const assignmentId = phase.kind === "ready" ? phase.assignment.assignment_id : null;

  const sequence = useMemo(
    () => (phase.kind === "ready" ? getSequence(phase.assignment.doors) : []),
    [phase],
  );

  // One RPC per prop, then Dexie for the rest of the day. Fails open: no
  // labels simply means dots without text.
  useEffect(() => {
    if (!assignmentId || sequence.length === 0) return;
    let cancelled = false;

    void (async () => {
      await ensureAddresses(createClient(), assignmentId).catch(() => false);
      if (cancelled) return;
      const map = await readLabels(sequence.map((door) => door.uprn));
      if (!cancelled) setLabels(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [assignmentId, sequence, labelEpoch]);

  const outcomes = useLocalOutcomes(assignmentId);
  const cursor = useCursor(sequence);

  const labelFor = useCallback((uprn: number) => labels.get(uprn), [labels]);
  const refreshLabels = useCallback(() => setLabelEpoch((n) => n + 1), []);

  const setLeadDraft = useCallback((uprn: number, draft: LeadDraft | null) => {
    setLeadDrafts((current) => {
      const next = new Map(current);
      if (draft) next.set(uprn, draft);
      else next.delete(uprn);
      return next;
    });
  }, []);

  const setNoteDraft = useCallback((uprn: number, note: string) => {
    setNoteDrafts((current) => {
      const next = new Map(current);
      if (note) next.set(uprn, note);
      else next.delete(uprn);
      return next;
    });
  }, []);

  const value = useMemo<FieldData>(
    () => ({
      phase,
      canvasserId,
      signedInAs,
      role,
      sequence,
      labels,
      outcomes,
      cursor,
      labelFor,
      refreshLabels,
      leadDrafts,
      setLeadDraft,
      noteDrafts,
      setNoteDraft,
    }),
    [
      phase,
      canvasserId,
      signedInAs,
      role,
      sequence,
      labels,
      outcomes,
      cursor,
      labelFor,
      refreshLabels,
      leadDrafts,
      setLeadDraft,
      noteDrafts,
      setNoteDraft,
    ],
  );

  return <FieldDataContext.Provider value={value}>{children}</FieldDataContext.Provider>;
}
