"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent, PointLike } from "maplibre-gl";

import { canClose, type DrawShape } from "@/lib/admin/draw-history";
import { DRAW_MID_LAYER, DRAW_VERTEX_LAYER, type DragState } from "@/components/admin/props/draw-layers";

export type DrawGestureHandlers = {
  onAdd: (point: [number, number]) => void;
  onClose: () => void;
  onMove: (index: number, point: [number, number]) => void;
  onInsert: (afterIndex: number, point: [number, number]) => void;
  /** The live drag (null when it ends), for drawing and the magnifier. */
  onDrag: (drag: DragState | null) => void;
};

/** Finger-sized on touch, pointer-sized with a mouse. */
const HIT_TOUCH = 22;
const HIT_MOUSE = 10;
/** Finger wobble under this many px is a tap, not a drag. */
const MOVE_SLOP = 4;

type Hit = { kind: "vertex"; index: number; at: [number, number] } | { kind: "mid"; afterIndex: number; at: [number, number] };

function isTouch(event: MapMouseEvent | MapTouchEvent): boolean {
  return event.type.startsWith("touch");
}

/**
 * UI-10 F2c (owner A19, A20, A21). Tap the map to drop a corner; tap corner 1
 * to close; drag any corner to move it; drag a midpoint to add a corner.
 * Pressing on a corner stops the map panning for that gesture only, so the
 * map still pans everywhere else. Double-tap zoom is off while drawing: two
 * quick taps are two corners.
 */
export function useDrawGestures(
  map: MapLibreMap | null,
  enabled: boolean,
  shape: DrawShape,
  handlers: DrawGestureHandlers,
): void {
  const shapeRef = useRef(shape);
  const handlersRef = useRef(handlers);
  shapeRef.current = shape;
  handlersRef.current = handlers;

  useEffect(() => {
    if (!map || !enabled) return;
    const canvas = map.getCanvas();
    let drag: DragState | null = null;
    let moved = false;
    let start = { x: 0, y: 0 };
    // Corner minus finger at the press, so the corner never jumps under the finger.
    let grab = { dx: 0, dy: 0 };
    // The press decides the hit size for the click that follows it.
    let lastPress = { touch: false, at: 0 };
    // A committed drag is never also a tap (some browsers still send a click).
    let ignoreClickUntil = 0;

    const hitAt = (point: { x: number; y: number }, touch: boolean): Hit | null => {
      const r = touch ? HIT_TOUCH : HIT_MOUSE;
      const box: [PointLike, PointLike] = [
        [point.x - r, point.y - r],
        [point.x + r, point.y + r],
      ];
      const layers = [DRAW_VERTEX_LAYER, DRAW_MID_LAYER].filter((id) => map.getLayer(id));
      if (layers.length === 0) return null;
      let best: Hit | null = null;
      let bestScore = Infinity;
      for (const feature of map.queryRenderedFeatures(box, { layers })) {
        if (feature.geometry.type !== "Point") continue;
        const at = feature.geometry.coordinates as [number, number];
        const screen = map.project(at);
        const kind = feature.properties?.kind;
        // A corner always beats a midpoint at the same distance.
        const score = Math.hypot(screen.x - point.x, screen.y - point.y) + (kind === "mid" ? 6 : 0);
        if (score >= bestScore) continue;
        if (kind === "vertex") {
          best = { kind: "vertex", index: Number(feature.properties?.index), at };
          bestScore = score;
        } else if (kind === "mid") {
          best = { kind: "mid", afterIndex: Number(feature.properties?.after), at };
          bestScore = score;
        }
      }
      return best;
    };

    const onDown = (event: MapMouseEvent | MapTouchEvent) => {
      if ("points" in event && event.points.length !== 1) return;
      const touch = isTouch(event);
      lastPress = { touch, at: event.originalEvent.timeStamp };
      const hit = hitAt(event.point, touch);
      if (!hit) return;
      event.preventDefault();
      moved = false;
      start = { x: event.point.x, y: event.point.y };
      const corner = map.project(hit.at);
      grab = { dx: corner.x - event.point.x, dy: corner.y - event.point.y };
      drag =
        hit.kind === "vertex"
          ? { kind: "vertex", index: hit.index, point: hit.at }
          : { kind: "mid", afterIndex: hit.afterIndex, point: hit.at };
      canvas.style.cursor = "grabbing";
      // MapLibre only reports a mouseup over the map itself; a release over a
      // toolbar or outside the window must still end the drag.
      if (!touch) window.addEventListener("mouseup", onUp, { once: true });
      handlersRef.current.onDrag(drag);
    };

    const onMoveEvent = (event: MapMouseEvent | MapTouchEvent) => {
      if (!drag) {
        if (!isTouch(event)) {
          canvas.style.cursor = hitAt(event.point, false) ? "grab" : shapeRef.current.closed ? "" : "crosshair";
        }
        return;
      }
      if (!moved && Math.hypot(event.point.x - start.x, event.point.y - start.y) < MOVE_SLOP) return;
      moved = true;
      const at = map.unproject([event.point.x + grab.dx, event.point.y + grab.dy]);
      drag = { ...drag, point: [at.lng, at.lat] };
      handlersRef.current.onDrag(drag);
    };

    function onUp() {
      window.removeEventListener("mouseup", onUp);
      if (!drag) return;
      const finished = drag;
      drag = null;
      canvas.style.cursor = "";
      handlersRef.current.onDrag(null);
      if (!moved) return;
      ignoreClickUntil = performance.now() + 400;
      if (finished.kind === "vertex") handlersRef.current.onMove(finished.index, finished.point);
      else handlersRef.current.onInsert(finished.afterIndex, finished.point);
    }

    const onBlur = () => onUp();

    const onClick = (event: MapMouseEvent) => {
      if (performance.now() < ignoreClickUntil) return;
      const current = shapeRef.current;
      const recent = event.originalEvent.timeStamp - lastPress.at < 1000;
      const touch = recent ? lastPress.touch : window.matchMedia("(pointer: coarse)").matches;
      const hit = hitAt(event.point, touch);
      if (hit) {
        if (hit.kind === "vertex" && hit.index === 0 && canClose(current)) handlersRef.current.onClose();
        return;
      }
      if (!current.closed) handlersRef.current.onAdd([event.lngLat.lng, event.lngLat.lat]);
    };

    map.doubleClickZoom.disable();
    if (!shapeRef.current.closed) canvas.style.cursor = "crosshair";
    map.on("mousedown", onDown);
    map.on("touchstart", onDown);
    map.on("mousemove", onMoveEvent);
    map.on("touchmove", onMoveEvent);
    map.on("mouseup", onUp);
    map.on("touchend", onUp);
    map.on("touchcancel", onUp);
    map.on("click", onClick);
    window.addEventListener("blur", onBlur);

    return () => {
      map.off("mousedown", onDown);
      map.off("touchstart", onDown);
      map.off("mousemove", onMoveEvent);
      map.off("touchmove", onMoveEvent);
      map.off("mouseup", onUp);
      map.off("touchend", onUp);
      map.off("touchcancel", onUp);
      map.off("click", onClick);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mouseup", onUp);
      map.doubleClickZoom.enable();
      canvas.style.cursor = "";
      if (drag) handlersRef.current.onDrag(null);
    };
  }, [map, enabled]);
}
