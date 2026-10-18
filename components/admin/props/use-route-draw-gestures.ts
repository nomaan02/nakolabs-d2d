"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import { pavementDoors, startStroke, type StrokeModel, type StrokeTracker } from "@/lib/admin/route-stroke";
import type { XY } from "@/lib/geo/route-graph";

export type RouteDrawGestureHandlers = {
  /** A stroke (or a press) began. */
  onStrokeStart: () => void;
  /** Doors the stroke reached, in order. Called at most once a frame. */
  onDoors: (uprns: number[]) => void;
  /** The finger lifted (or a second finger landed). */
  onStrokeEnd: () => void;
  /** The doors of the pavement the stroke is following, for the highlight; null when none. */
  onPavement: (uprns: number[] | null) => void;
};

/** Screen margins (px) covered by the editor's own bars; edge auto-pan starts inside them. */
export type DrawInsets = { top: number; right: number; bottom: number; left: number };

/** Auto-pan starts this far (px) inside the visible map edge. */
const EDGE_ZONE_PX = 56;
/** Fastest auto-pan at the very edge, px per second (time-based, so a slow phone pans as far). */
const EDGE_SPEED_PX_S = 840;
/** Auto-pan waits until the stroke has travelled this far (px), so a stroke started near the edge doesn't move the map at once… */
const EDGE_ARM_PX = 24;
/** …and until the finger has stayed in the edge zone this long (ms). */
const EDGE_DWELL_MS = 150;

/**
 * RT-3 / RT-5 (owner 2026-10-13, 2026-10-17; Figma R2–R4, D1). Drawing a
 * route with a finger or a mouse:
 *
 *   - One finger, or a mouse drag, draws at any zoom. Each point of the
 *     stroke is put on a pavement and the stroke links the doors along it
 *     (`lib/admin/route-stroke.ts`). A press links the nearest door.
 *   - Near the edge of the map the map moves under the finger, so a long
 *     road is one stroke.
 *   - Two fingers move, zoom and turn the map (touch: MapLibre cooperative
 *     gestures, its message hidden). A second finger landing ends the stroke.
 *   - With a mouse, the map moves with Space held (Space never presses a
 *     focused toolbar button), and with the wheel.
 *
 * Pointer positions go straight to planar metres (`map.unproject`, then the
 * route graph's projection), so nothing is cached per stroke and auto-pan
 * needs no re-projection. Work per pointer event is a few grid lookups;
 * React hears about it at most once a frame.
 */
export function useRouteDrawGestures(
  map: MapLibreMap | null,
  enabled: boolean,
  model: StrokeModel | null,
  /** Read when a stroke is near the edge (layouts differ by breakpoint). */
  insets: () => DrawInsets,
  handlers: RouteDrawGestureHandlers,
): void {
  const modelRef = useRef(model);
  const insetsRef = useRef(insets);
  const handlersRef = useRef(handlers);
  modelRef.current = model;
  insetsRef.current = insets;
  handlersRef.current = handlers;

  useEffect(() => {
    if (!map || !enabled) return;
    const container = map.getCanvasContainer();
    // Phone or tablet: cooperative gestures throughout (two fingers move the map).
    // Mouse only: drag-pan off (Space turns it on). A touch laptop has both: drag-pan
    // stays on (a drawing stroke's pointerdown is default-prevented, so a mouse
    // stroke never pans) and cooperative gestures follow the pointer in use, so
    // the wheel still zooms without Ctrl.
    const touchFirst = window.matchMedia("(pointer: coarse)").matches;
    const anyTouch = touchFirst || window.matchMedia("(any-pointer: coarse)").matches;
    const mouseOnly = !anyTouch;
    const hybrid = anyTouch && !touchFirst;
    const pointers = new Map<number, { x: number; y: number }>();
    let stroke: {
      id: number;
      tracker: StrokeTracker;
      screen: { x: number; y: number };
      start: { x: number; y: number };
      armed: boolean;
      inZoneSince: number;
      lastTick: number;
      /** The editor's bars, read once per stroke. */
      insets: DrawInsets;
      pavementKey: number;
    } | null = null;
    let pending: number[] = [];
    let frame = 0;
    let spaceHeld = false;

    const local = (event: { clientX: number; clientY: number }) => {
      const rect = map.getContainer().getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const toXY = (m: StrokeModel, p: { x: number; y: number }): XY => {
      const ll = map.unproject([p.x, p.y]);
      return m.graph.project([ll.lng, ll.lat]);
    };

    const flush = () => {
      if (pending.length > 0) {
        const out = pending;
        pending = [];
        handlersRef.current.onDoors(out);
      }
      const m = modelRef.current;
      if (stroke && m) {
        const pv = stroke.tracker.pavement();
        const key = pv ? pv.segment * 2 + pv.side : -1;
        if (key !== stroke.pavementKey) {
          stroke.pavementKey = key;
          handlersRef.current.onPavement(pv ? pavementDoors(m, pv) : null);
        }
      }
    };

    /** Auto-pan near the edge, then a flush: one map move and one React update per frame. */
    const tick = () => {
      frame = 0;
      if (stroke) {
        // The map's own box: the canvas container has no height of its own.
        const rect = map.getContainer().getBoundingClientRect();
        const box = stroke.insets;
        const now = performance.now();
        const dt = Math.min(100, stroke.lastTick === 0 ? 16 : now - stroke.lastTick) / 1000;
        stroke.lastTick = now;
        const depth = (inside: number) => Math.max(0, Math.min(1, (EDGE_ZONE_PX - inside) / EDGE_ZONE_PX));
        const speed = (d: number) => EDGE_SPEED_PX_S * dt * d * d;
        const { x, y } = stroke.screen;
        if (!stroke.armed && Math.hypot(x - stroke.start.x, y - stroke.start.y) >= EDGE_ARM_PX) stroke.armed = true;
        const dx = speed(depth(rect.width - box.right - x)) - speed(depth(x - box.left));
        const dy = speed(depth(rect.height - box.bottom - y)) - speed(depth(y - box.top));
        const inZone = stroke.armed && (dx !== 0 || dy !== 0);
        if (!inZone) stroke.inZoneSince = 0;
        else if (stroke.inZoneSince === 0) stroke.inZoneSince = now;
        const m = modelRef.current;
        if (inZone && now - stroke.inZoneSince >= EDGE_DWELL_MS && m && Math.hypot(dx, dy) >= 0.5) {
          map.panBy([dx, dy], { duration: 0 });
          // The map moved under a still finger: the finger is now further along.
          pending.push(...stroke.tracker.moveTo(toXY(m, stroke.screen)));
        }
      }
      flush();
      if (stroke) frame = requestAnimationFrame(tick);
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(tick);
    };

    const endStroke = () => {
      if (!stroke) return;
      if (container.hasPointerCapture?.(stroke.id)) container.releasePointerCapture(stroke.id);
      stroke = null;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      flush();
      handlersRef.current.onPavement(null);
      handlersRef.current.onStrokeEnd();
    };

    const onDown = (event: PointerEvent) => {
      if (hybrid) {
        if (event.pointerType === "touch") map.cooperativeGestures.enable();
        else map.cooperativeGestures.disable();
      }
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const at = local(event);
      pointers.set(event.pointerId, at);
      if (pointers.size > 1) {
        // Two fingers: the map is moving. Whatever was linked stays linked.
        endStroke();
        return;
      }
      if (event.pointerType === "mouse" && spaceHeld) return;
      const m = modelRef.current;
      if (!m) return;
      const start = toXY(m, at);
      const below = toXY(m, { x: at.x, y: at.y + 100 });
      const metresPerPx = Math.hypot(below.x - start.x, below.y - start.y) / 100;
      const { hits, tracker } = startStroke(m, start, { metresPerPx, pointer: event.pointerType === "mouse" ? "mouse" : "touch" });
      stroke = { id: event.pointerId, tracker, screen: at, start: at, armed: false, inZoneSince: 0, lastTick: 0, insets: insetsRef.current(), pavementKey: -2 };
      container.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      handlersRef.current.onStrokeStart();
      pending.push(...hits);
      schedule();
    };

    const onMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, local(event));
      if (!stroke || event.pointerId !== stroke.id || pointers.size > 1) return;
      const m = modelRef.current;
      if (!m) return;
      // Coalesced samples, when the browser gives them, follow a fast finger more closely.
      const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      const samples = coalesced.length > 0 ? coalesced.map(local) : [local(event)];
      for (const point of samples) pending.push(...stroke.tracker.moveTo(toXY(m, point)));
      stroke.screen = samples[samples.length - 1];
      event.preventDefault();
      schedule();
    };

    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (stroke && event.pointerId === stroke.id) endStroke();
    };

    // Space is the map's when the focus is on the page, the map or the drawing
    // toolbar (a focused toolbar button would otherwise be pressed). Anywhere
    // else (Cancel, the snackbar, a dialog) Space presses the button as usual.
    const forMap = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target === document.body || target === document.documentElement) return true;
      if (container.contains(target)) return true;
      return target.closest("[data-route-draw-tools]") !== null;
    };
    const onWheel = () => {
      if (hybrid) map.cooperativeGestures.disable();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !forMap(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      spaceHeld = true;
      endStroke();
      if (mouseOnly) map.dragPan.enable();
      container.style.cursor = "grab";
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !forMap(event)) return;
      event.preventDefault();
      spaceHeld = false;
      if (mouseOnly) map.dragPan.disable();
      container.style.cursor = "crosshair";
    };
    const onBlur = () => {
      pointers.clear();
      endStroke();
      if (spaceHeld && mouseOnly) map.dragPan.disable();
      spaceHeld = false;
    };

    const dragPanWas = map.dragPan.isEnabled();
    const cooperativeWas = map.cooperativeGestures.isEnabled();
    const touchActionWas = container.style.touchAction;
    map.doubleClickZoom.disable();
    if (anyTouch) {
      if (touchFirst) map.cooperativeGestures.enable();
      container.classList.add("admin-route-draw");
      container.style.touchAction = "none";
    } else {
      map.dragPan.disable();
    }
    container.style.cursor = "crosshair";
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("wheel", onWheel, { capture: true, passive: true });
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);

    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("wheel", onWheel, { capture: true });
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      endStroke();
      if (!cooperativeWas) map.cooperativeGestures.disable();
      if (dragPanWas) map.dragPan.enable();
      container.classList.remove("admin-route-draw");
      container.style.touchAction = touchActionWas;
      container.style.cursor = "";
      map.doubleClickZoom.enable();
    };
  }, [map, enabled]);
}
