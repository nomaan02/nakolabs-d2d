"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import type { RouteDrawPanelProps } from "@/components/admin/props/route-draw-panel";
import { useRouteDrawGestures, type DrawInsets } from "@/components/admin/props/use-route-draw-gestures";
import {
  MIN_ROUTE_DOORS,
  canRedoRoute,
  canUndoRoute,
  leftOutDoors,
  reconcileDrawing,
  redoRoute,
  startRouteDraw,
  strokeEdit,
  undoRoute,
  type RouteDrawHistory,
} from "@/lib/admin/route-draw";
import { ZOOMED_OUT_HINT_ZOOM, buildStrokeModel } from "@/lib/admin/route-stroke";
import type { RouteGraph } from "@/lib/geo/route-graph";
import type { Demand } from "@/lib/geo/walk/demand";
import { prepare } from "@/lib/geo/walk/generate";
import { fetchWalkInputs } from "@/lib/geo/walk/inputs";
import { buildManualVariant, buildManualVariants } from "@/lib/geo/walk/manual";
import { loadManualRoute, saveManualRoute, type ManualSaveSummary } from "@/lib/geo/walk/manual-save";
import type { WalkVariant } from "@/lib/geo/walk/types";
import type { MapMode } from "@/lib/map/map-palette";
import {
  ROUTE_DRAW_LAYER,
  applyRouteDoorStates,
  clearRouteDoorStates,
  ensureRouteDrawLayers,
  routeDoorStates,
  setRouteDrawDoors,
  setRouteDrawVisible,
  setRouteTrack,
  type RouteDoorState,
  type RouteDrawDoor,
} from "@/lib/map/route-draw-layers";
import { emptyRouteModel, paintRouteLayers, toRoutePaintModel, walkResultToPaintInput } from "@/lib/map/route-layers";
import { createClient } from "@/lib/supabase/client";

export type RouteDrawTarget = { propId: string; title: string };

export type RouteDrawSaved = { summary: ManualSaveSummary; manual: WalkVariant; linked: number; leftOut: number };

type Loaded = {
  graph: RouteGraph;
  demand: Demand;
  centroid: [number, number];
  doors: RouteDrawDoor[];
  /** Doors added since the drawing was last saved: shown with a warning ring until linked. */
  fresh: number[];
};

/** How long the "Door taken off the route" message stays. */
const SNACK_MS = 4000;
/** While a finger is down the live route is rebuilt at most this often (ms); door dots update every frame. */
const PREVIEW_MS = 120;

/** Where the editor's own bars sit over the map, for edge auto-pan (px). */
function drawInsets(): DrawInsets {
  const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
  return desktop ? { top: 72, right: 0, bottom: 52, left: 0 } : { top: 52, right: 0, bottom: 88, left: 0 };
}

/**
 * RT-5 (owner 2026-10-17): drawing works at any zoom; a stroke follows a
 * pavement (`lib/admin/route-stroke.ts`) and is one Undo step.
 *
 * RT-3 (owner 2026-10-13; R2–R5, R8, D1). The manual route editor on the
 * Props map: loads the prop's doors and roads (`route_walk_inputs`) and any
 * saved drawing, keeps the drawing's history, paints the doors and the live
 * route, and saves the drawing with both variants. The page owns the panel
 * placement; this hook owns everything else.
 */
export function useRouteDraw(
  map: MapLibreMap | null,
  mode: MapMode,
  target: RouteDrawTarget | null,
  /** Frames the doors. */
  fit: (box: [[number, number], [number, number]]) => void,
  onSaved: (saved: RouteDrawSaved) => void,
  /** A dialog is over the editor: no drawing. */
  paused = false,
) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<RouteDrawHistory>(() => startRouteDraw());
  const [erasing, setErasing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const applied = useRef<ReadonlyMap<number, RouteDoorState>>(new Map());
  const fitRef = useRef(fit);
  fitRef.current = fit;
  /** Bumped whenever the editor opens, closes or reloads: a save that returns after that is ignored. */
  const sessionRef = useRef(0);
  /** The stroke under way: link or erase (fixed when it starts), whether its Undo step is open yet, doors erased. */
  const strokeRef = useRef<{ kind: "link" | "erase"; open: boolean; erased: number } | null>(null);
  /** Doors under the "following this pavement" highlight. */
  const trackRef = useRef<readonly number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const propId = target?.propId ?? null;

  // ---- load ----------------------------------------------------------------

  useEffect(() => {
    sessionRef.current += 1;
    strokeRef.current = null;
    setDrawing(false);
    setSaving(false);
    if (!propId) {
      setStatus("loading");
      setLoaded(null);
      setHistory(startRouteDraw());
      return;
    }
    let live = true;
    setStatus("loading");
    setLoadError(null);
    setLoaded(null);
    setHistory(startRouteDraw());
    setErasing(false);
    setConfirming(false);
    setError(null);
    setSnack(null);
    const supabase = createClient();
    void Promise.all([fetchWalkInputs(supabase, propId), loadManualRoute(supabase, propId)]).then(([inputs, manual]) => {
      if (!live) return;
      if (!inputs.ok) {
        setStatus("failed");
        setLoadError(inputs.message);
        return;
      }
      if (!manual.ok) {
        setStatus("failed");
        setLoadError(manual.message);
        return;
      }
      const doors = inputs.inputs.route.doors;
      if (doors.length < MIN_ROUTE_DOORS) {
        setStatus("failed");
        setLoadError("This prop has too few doors to draw a route through.");
        return;
      }
      const { graph, demand } = prepare(inputs.inputs);
      const drawing = manual.record.drawing;
      const current = doors.map((d) => d.uprn);
      const reconciled = drawing ? reconcileDrawing(drawing, current) : null;
      setLoaded({
        graph,
        demand,
        centroid: inputs.inputs.route.centroid,
        doors,
        fresh: reconciled ? reconciled.newDoors : [],
      });
      setHistory(startRouteDraw(reconciled ? reconciled.chain : []));
      setStatus("ready");
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;
      for (const d of doors) {
        minLon = Math.min(minLon, d.lon);
        minLat = Math.min(minLat, d.lat);
        maxLon = Math.max(maxLon, d.lon);
        maxLat = Math.max(maxLat, d.lat);
      }
      // The whole prop: drawing works at any zoom.
      fitRef.current([
        [minLon, minLat],
        [maxLon, maxLat],
      ]);
    });
    return () => {
      live = false;
    };
  }, [propId, attempt]);

  // ---- map layers ------------------------------------------------------------

  useEffect(() => {
    if (!map || !propId) return;
    ensureRouteDrawLayers(map, mode);
    clearRouteDoorStates(map);
    applied.current = new Map();
    trackRef.current = [];
    setRouteDrawDoors(map, loaded?.doors ?? null);
    setRouteDrawVisible(map, true);
    return () => {
      clearRouteDoorStates(map);
      setRouteDrawDoors(map, null);
      setRouteDrawVisible(map, false);
      paintRouteLayers(map, emptyRouteModel(), "", undefined, null, mode);
      applied.current = new Map();
      trackRef.current = [];
    };
  }, [map, mode, propId, loaded]);

  const strokeModel = useMemo(() => (loaded ? buildStrokeModel(loaded.graph, loaded.demand) : null), [loaded]);
  const chain = history.present;
  const allUprns = useMemo(() => (loaded ? loaded.doors.map((d) => d.uprn) : []), [loaded]);
  const leftOut = useMemo(() => leftOutDoors(chain, allUprns), [chain, allUprns]);

  useEffect(() => {
    if (!map || !loaded) return;
    const linked = new Set(chain);
    const next = routeDoorStates({
      chain,
      left: confirming ? leftOut : [],
      fresh: loaded.fresh.filter((u) => !linked.has(u)),
      showEnd: !confirming,
    });
    applied.current = applyRouteDoorStates(map, applied.current, next);
    // `mode`: the layers effect clears every state on a theme change; this puts them back.
  }, [map, mode, loaded, chain, leftOut, confirming]);

  // The live route: at most once a frame, and while a finger is down at most
  // every PREVIEW_MS, so a long stroke stays smooth on a phone.
  const [preview, setPreview] = useState<WalkVariant | null>(null);
  const builtAt = useRef(0);
  useEffect(() => {
    if (!map || !loaded) return;
    let frame = 0;
    const wait = drawing ? Math.max(0, PREVIEW_MS - (performance.now() - builtAt.current)) : 0;
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(() => {
        builtAt.current = performance.now();
      const built = chain.length >= MIN_ROUTE_DOORS ? buildManualVariant(loaded.graph, loaded.demand, chain, "manual", loaded.centroid) : null;
      const variant = built && built.ok ? built.variant : null;
      setPreview(variant);
      const model = variant ? toRoutePaintModel(walkResultToPaintInput({ variants: [variant] })) : emptyRouteModel();
      paintRouteLayers(map, model, "manual", ROUTE_DRAW_LAYER, null, mode);
      });
    }, wait);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [map, mode, loaded, chain, drawing]);

  // Zoomed out: the hint says a stroke follows the nearest pavement.
  useEffect(() => {
    if (!map || !propId) return;
    const check = () => setZoomedOut(map.getZoom() < ZOOMED_OUT_HINT_ZOOM);
    check();
    map.on("zoomend", check);
    return () => {
      map.off("zoomend", check);
    };
  }, [map, propId]);

  useEffect(() => {
    if (!snack) return;
    const timer = window.setTimeout(() => setSnack(null), SNACK_MS);
    return () => window.clearTimeout(timer);
  }, [snack]);

  // ---- editing -----------------------------------------------------------------

  const change = useCallback((next: (h: RouteDrawHistory) => RouteDrawHistory) => {
    setError(null);
    setHistory(next);
  }, []);

  const presentRef = useRef(history.present);
  presentRef.current = history.present;

  const erasingRef = useRef(erasing);
  erasingRef.current = erasing;

  useRouteDrawGestures(map, propId !== null && status === "ready" && !confirming && !saving && !paused, strokeModel, drawInsets, {
    onStrokeStart: () => {
      // One stroke = one Undo step (owner 2026-10-17). A new stroke ends the last erase message.
      strokeRef.current = { kind: erasingRef.current ? "erase" : "link", open: false, erased: 0 };
      setSnack(null);
      setDrawing(true);
    },
    onDoors: (uprns) => {
      const stroke = strokeRef.current;
      if (!stroke) return;
      const on = new Set(presentRef.current);
      const doors = stroke.kind === "link" ? uprns.filter((u) => !on.has(u)) : uprns.filter((u) => on.has(u));
      if (doors.length === 0) return;
      const open = stroke.open;
      stroke.open = true;
      presentRef.current = stroke.kind === "link" ? [...presentRef.current, ...doors] : presentRef.current.filter((u) => !doors.includes(u));
      change((h) => strokeEdit(h, stroke.kind, doors, open));
      if (stroke.kind === "erase") {
        stroke.erased += doors.length;
        setSnack(stroke.erased === 1 ? "Door taken off the route" : `${stroke.erased} doors taken off the route`);
      }
    },
    onStrokeEnd: () => {
      strokeRef.current = null;
      setDrawing(false);
    },
    onPavement: (uprns) => {
      if (map) trackRef.current = setRouteTrack(map, trackRef.current, uprns ?? []);
    },
  });

  const undo = useCallback(() => {
    // Mid-stroke, Undo waits for the finger to lift.
    if (strokeRef.current) return;
    setSnack(null);
    change(undoRoute);
  }, [change]);
  const redo = useCallback(() => {
    if (strokeRef.current) return;
    setSnack(null);
    change(redoRoute);
  }, [change]);
  const toggleErase = useCallback(() => setErasing((on) => !on), []);

  const canSave = status === "ready" && chain.length >= MIN_ROUTE_DOORS && preview !== null;

  const doSave = useCallback(async () => {
    if (!loaded || !propId || saving) return;
    const session = sessionRef.current;
    setSaving(true);
    setError(null);
    const built = buildManualVariants(loaded.graph, loaded.demand, chain, loaded.centroid);
    if (!built.ok) {
      setSaving(false);
      setError(built.message);
      return;
    }
    const result = await saveManualRoute(createClient(), propId, chain, leftOut, { manual: built.manual, reversed: built.reversed });
    // The editor was closed or reopened meanwhile: that session's screen is gone.
    if (session !== sessionRef.current) return;
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirming(false);
    onSaved({ summary: result.summary, manual: built.manual, linked: chain.length, leftOut: leftOut.length });
  }, [loaded, propId, saving, chain, leftOut, onSaved]);

  const save = useCallback(() => {
    if (!canSave) return;
    setErasing(false);
    setSnack(null);
    if (leftOut.length > 0) setConfirming(true);
    else void doSave();
  }, [canSave, leftOut.length, doSave]);

  const panel: Omit<RouteDrawPanelProps, "title" | "onCancel"> = {
    status,
    loadError,
    linked: chain.length,
    total: allUprns.length,
    canUndo: canUndoRoute(history),
    canRedo: canRedoRoute(history),
    canSave,
    erasing,
    zoomedOut,
    confirming,
    saving,
    error,
    snack,
    onUndo: undo,
    onUndoErase: undo,
    onRedo: redo,
    onToggleErase: toggleErase,
    onSave: save,
    onConfirmSave: () => void doSave(),
    onKeepDrawing: () => setConfirming(false),
    onRetry: () => setAttempt((n) => n + 1),
  };

  return {
    panel,
    /** Anything drawn or erased since the editor opened. */
    dirty: history.past.length > 0,
    confirming,
    saving,
    ready: status === "ready",
    undo,
    redo,
    toggleErase,
    closeConfirm: () => setConfirming(false),
  };
}
