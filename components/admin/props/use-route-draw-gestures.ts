"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import { MIN_DRAW_ZOOM, ROUTE_HIT_MOUSE, ROUTE_HIT_TOUCH, doorsAlongStroke, type ScreenDoor } from "@/lib/admin/route-draw";
import type { RouteDrawDoor } from "@/lib/map/route-draw-layers";

export type RouteDrawGestureHandlers = {
  /** Doors the stroke passed over, in order (already-linked ones included; the caller skips them). */
  onLink: (uprns: number[]) => void;
  /** Doors the erase stroke or tap touched. */
  onErase: (uprns: number[]) => void;
  /** A stroke started below the drawing zoom. */
  onTooFar: () => void;
  /** A new stroke (or tap) began. */
  onStrokeStart: () => void;
};

/**
 * RT-3 (owner O2; Figma R2–R4, D1). Drawing a route with a finger or a mouse:
 *
 *   - One finger, or a mouse drag, draws: every door the stroke passes over
 *     is linked in order. A tap links the nearest door. Lift and carry on.
 *   - Two fingers move, zoom and turn the map (touch devices: MapLibre's
 *     cooperative gestures, with its "use two fingers" message hidden).
 *     A second finger landing ends the stroke.
 *   - With a mouse, the map moves with Space held, and with the wheel.
 *     (Space never presses a focused toolbar button while drawing.)
 *   - Erase on: the stroke or tap takes doors off instead.
 *
 * Screen positions of the doors are taken once per stroke: the map does not
 * move while one finger draws. Pointer samples are joined and checked every
 * few pixels (`doorsAlongStroke`), so a fast stroke skips no door.
 */
export function useRouteDrawGestures(
  map: MapLibreMap | null,
  enabled: boolean,
  doors: readonly RouteDrawDoor[],
  erasing: boolean,
  handlers: RouteDrawGestureHandlers,
): void {
  const doorsRef = useRef(doors);
  const erasingRef = useRef(erasing);
  const handlersRef = useRef(handlers);
  doorsRef.current = doors;
  erasingRef.current = erasing;
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
    let stroke: { id: number; last: { x: number; y: number }; screen: ScreenDoor[]; radius: number } | null = null;
    let spaceHeld = false;

    const local = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const apply = (uprns: number[]) => {
      if (uprns.length === 0) return;
      if (erasingRef.current) handlersRef.current.onErase(uprns);
      else handlersRef.current.onLink(uprns);
    };

    const endStroke = () => {
      if (stroke && container.hasPointerCapture?.(stroke.id)) container.releasePointerCapture(stroke.id);
      stroke = null;
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
      if (map.getZoom() < MIN_DRAW_ZOOM - 0.01) {
        handlersRef.current.onTooFar();
        return;
      }
      const radius = event.pointerType === "mouse" ? ROUTE_HIT_MOUSE : ROUTE_HIT_TOUCH;
      const screen: ScreenDoor[] = doorsRef.current.map((door) => {
        const p = map.project([door.lon, door.lat]);
        return { uprn: door.uprn, x: p.x, y: p.y };
      });
      stroke = { id: event.pointerId, last: at, screen, radius };
      container.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      handlersRef.current.onStrokeStart();
      apply(doorsAlongStroke(screen, at, at, radius));
    };

    const onMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, local(event));
      if (!stroke || event.pointerId !== stroke.id || pointers.size > 1) return;
      const at = local(event);
      // Coalesced samples, when the browser gives them, follow a fast finger more closely.
      const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents().map(local) : [at];
      const hits: number[] = [];
      for (const point of samples.length > 0 ? samples : [at]) {
        hits.push(...doorsAlongStroke(stroke.screen, stroke.last, point, stroke.radius));
        stroke.last = point;
      }
      event.preventDefault();
      apply(hits);
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
