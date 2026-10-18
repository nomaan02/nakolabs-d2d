"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { lastUserInputAt, useGeo } from "@/components/field/geo-provider";
import { SMOOTH_MAX_DOORS } from "@/lib/field/door-window";
import {
  FIND_WINDOW_MS,
  MOVED_SHOW_MS,
  isFreshSample,
  isJumpReopen,
  planJump,
  type PlaceSample,
  type Reopen,
} from "@/lib/field/geo-lock";

/**
 * GPS-LOCK GL-2 (owner G2, G3, G5, G6, 2026-10-18). The Logger's one
 * automatic cursor move: when the canvasser comes back to the app, wait up
 * to FIND_WINDOW_MS for good fixes, then jump to the door nearest them on
 * the route (`planJump`). Anything they do first wins:
 *   - any touch or key press after the reopen (on any tab, even before the
 *     Logger was showing) cancels it (G3);
 *   - the cursor moving for any other reason cancels it.
 * It never runs while the screen is in use, only right after a reopen.
 * One attempt per reopen, even if the Logger remounts.
 */

export type JumpState =
  | { kind: "idle" }
  | { kind: "finding" }
  | { kind: "moved"; from: number; to: number };

const IDLE: JumpState = { kind: "idle" };
/** A jump longer than the door scroll's smooth range lands this many doors short, then slides. */
const SLIDE_DOORS = 2;
const SLIDE_DELAY_MS = 90;

/** The reopen last acted on, by time, so a remounted Logger never acts on it twice. */
let lastHandledAt = 0;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function useJumpOnReopen(input: {
  /** The door, the route places and the cursor are loaded. Until then a reopen waits. */
  ready: boolean;
  /** The setting is on, the Logging view is showing and no sheet is open. */
  allowed: boolean;
  cursorIndex: number;
  anchorIndex: number;
  isOpen: (index: number) => boolean;
  goTo: (index: number) => void;
}): { state: JumpState; undo: () => void } {
  const { reopen, routePlace, doorAlongsM, status } = useGeo();
  const [state, setState] = useState<JumpState>(IDLE);
  const active = useRef<Reopen | null>(null);
  const samples = useRef<PlaceSample[]>([]);
  const ownTargets = useRef<Set<number>>(new Set());
  const deadline = useRef(0);
  const lastConsideredAt = useRef<number | null>(null);
  const sliding = useRef(false);
  const timers = useRef<number[]>([]);
  const latest = useRef(input);
  latest.current = input;
  const latestPlace = useRef(routePlace);
  latestPlace.current = routePlace;
  const latestAlongs = useRef(doorAlongsM);
  latestAlongs.current = doorAlongsM;

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    sliding.current = false;
    active.current = null;
    samples.current = [];
    ownTargets.current = new Set();
    setState(IDLE);
  }, [clearTimers]);

  const later = useCallback((ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  }, []);

  const jump = useCallback(
    (to: number) => {
      const { cursorIndex: from, goTo } = latest.current;
      active.current = null;
      clearTimers();
      setState({ kind: "moved", from, to });
      const gap = to - from;
      if (Math.abs(gap) <= SMOOTH_MAX_DOORS || reducedMotion()) {
        ownTargets.current = new Set([to]);
        goTo(to);
      } else {
        // The door scroll renders a window of doors and snaps beyond 3, so a
        // long jump lands just short and slides the last two doors.
        const near = to - Math.sign(gap) * SLIDE_DOORS;
        ownTargets.current = new Set([near, to]);
        goTo(near);
        sliding.current = true;
        later(SLIDE_DELAY_MS, () => {
          sliding.current = false;
          latest.current.goTo(to);
        });
      }
    },
    [clearTimers, later],
  );

  // Add one snapped fix and decide: wait, jump, or leave it to the chip.
  const consider = useCallback(
    (place: PlaceSample) => {
      const current = active.current;
      if (!current || !isFreshSample(place, current.at) || place.at === lastConsideredAt.current) return;
      lastConsideredAt.current = place.at;
      samples.current = [...samples.current, place];
      const { cursorIndex, anchorIndex, isOpen } = latest.current;
      const plan = planJump({
        samples: samples.current,
        doorAlongsM: latestAlongs.current,
        cursorIndex,
        anchorIndex,
        hiddenMs: current.hiddenMs,
        placeBeforeM: current.placeBeforeM,
        isOpen,
      });
      if (plan.kind === "jump") jump(plan.index);
      else if (plan.kind !== "wait") stop();
    },
    [jump, stop],
  );

  // A new reopen: start finding, or let it pass.
  const { ready, allowed } = input;
  useEffect(() => {
    if (!reopen || reopen.at <= lastHandledAt || !ready) return;
    lastHandledAt = reopen.at;
    clearTimers();
    samples.current = [];
    const now = Date.now();
    // A cold start's window opens when the Logger is ready (loading eats into
    // it otherwise); a reopen's opens when the app came back.
    const opensAt = reopen.hiddenMs === null ? now : reopen.at;
    const touched = lastUserInputAt() > reopen.at;
    // No location on this phone at all: nothing to wait for.
    const noLocation = status === "denied" || (status === "unavailable" && latestPlace.current === null);
    if (!allowed || !isJumpReopen(reopen) || touched || now - opensAt >= FIND_WINDOW_MS || noLocation) {
      active.current = null;
      setState(IDLE);
      return;
    }
    active.current = reopen;
    ownTargets.current = new Set();
    lastConsideredAt.current = null;
    deadline.current = opensAt + FIND_WINDOW_MS;
    setState({ kind: "finding" });
    // A good fix may have arrived before the Logger was ready.
    if (latestPlace.current) consider(latestPlace.current);
  }, [reopen, ready, allowed, status, clearTimers, consider]);

  // "Finding you…" lasts until the window closes; "Moved" for MOVED_SHOW_MS.
  // A new state object (a new reopen or jump) restarts the clock.
  useEffect(() => {
    if (state.kind === "idle") return;
    const ms = state.kind === "finding" ? Math.max(0, deadline.current - Date.now()) : MOVED_SHOW_MS;
    const id = window.setTimeout(stop, ms);
    return () => window.clearTimeout(id);
  }, [state, stop]);

  // Each snapped fix while finding.
  const placeAt = routePlace?.at ?? null;
  useEffect(() => {
    if (routePlace) consider(routePlace);
    // One step per fix: `placeAt` changes once per snapped fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeAt]);

  // G3: the canvasser's own touch, or a key, always wins over the jump.
  // A touch while the slide is still on its way stops it where it is and
  // drops "Moved", so the chip never names a door the Logger is not on.
  const finding = state.kind === "finding";
  const moving = state.kind === "moved";
  useEffect(() => {
    if (!moving) return;
    const halt = () => {
      if (sliding.current) stop();
    };
    window.addEventListener("pointerdown", halt, true);
    return () => window.removeEventListener("pointerdown", halt, true);
  }, [moving, stop]);
  useEffect(() => {
    if (!finding) return;
    const cancel = () => stop();
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, [finding, stop]);

  // Anything else that moves the cursor ends finding, or retires "Moved".
  const { cursorIndex } = input;
  useEffect(() => {
    if (state.kind === "idle" || ownTargets.current.has(cursorIndex)) return;
    stop();
    // Only a cursor change decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex]);

  // Losing permission, or the setting going off, ends it too.
  useEffect(() => {
    if (state.kind !== "idle" && (!allowed || status === "denied")) stop();
  }, [allowed, status, state.kind, stop]);

  useEffect(() => clearTimers, [clearTimers]);

  const undo = useCallback(() => {
    if (state.kind !== "moved") return;
    const { from } = state;
    stop();
    latest.current.goTo(from);
  }, [state, stop]);

  return { state, undo };
}
