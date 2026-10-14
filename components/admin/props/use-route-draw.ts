"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import type { RouteDrawPanelProps } from "@/components/admin/props/route-draw-panel";
import { useRouteDrawGestures } from "@/components/admin/props/use-route-draw-gestures";
import {
  MIN_DRAW_ZOOM,
  MIN_ROUTE_DOORS,
  canRedoRoute,
  canUndoRoute,
  eraseDoors,
  leftOutDoors,
  linkDoors,
  reconcileDrawing,
  redoRoute,
  startRouteDraw,
  undoRoute,
  type RouteDrawHistory,
} from "@/lib/admin/route-draw";
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

/**
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
  /** Frames the doors; `focus` is where to centre when the box needs a zoom too far out to draw at. */
  fit: (box: [[number, number], [number, number]], focus: [number, number]) => void,
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
  /** The erase stroke under way: history steps and doors, so the snackbar's Undo puts back the whole stroke. */
  const eraseRun = useRef({ steps: 0, doors: 0 });
  const propId = target?.propId ?? null;

  // ---- load ----------------------------------------------------------------

  useEffect(() => {
    sessionRef.current += 1;
    eraseRun.current = { steps: 0, doors: 0 };
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
      // Fit the doors, but never further out than drawing allows: with a saved
      // drawing, carry on from its last door; otherwise from the middle.
      const last = reconciled && reconciled.chain.length > 0 ? doors.find((d) => d.uprn === reconciled.chain[reconciled.chain.length - 1]) : undefined;
      fitRef.current(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        last ? [last.lon, last.lat] : [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
      );
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
    setRouteDrawDoors(map, loaded?.doors ?? null);
    setRouteDrawVisible(map, true);
    return () => {
      clearRouteDoorStates(map);
      setRouteDrawDoors(map, null);
      setRouteDrawVisible(map, false);
      paintRouteLayers(map, emptyRouteModel(), "", undefined, null, mode);
      applied.current = new Map();
    };
  }, [map, mode, propId, loaded]);

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

  // The live route, built at most once a frame.
  const [preview, setPreview] = useState<WalkVariant | null>(null);
  useEffect(() => {
    if (!map || !loaded) return;
    const frame = requestAnimationFrame(() => {
      const built = chain.length >= MIN_ROUTE_DOORS ? buildManualVariant(loaded.graph, loaded.demand, chain, "manual", loaded.centroid) : null;
      const variant = built && built.ok ? built.variant : null;
      setPreview(variant);
      const model = variant ? toRoutePaintModel(walkResultToPaintInput({ variants: [variant] })) : emptyRouteModel();
      paintRouteLayers(map, model, "manual", ROUTE_DRAW_LAYER, null, mode);
    });
    return () => cancelAnimationFrame(frame);
  }, [map, mode, loaded, chain]);

  // "Zoom in to draw".
  useEffect(() => {
    if (!map || !propId) return;
    const check = () => setZoomedOut(map.getZoom() < MIN_DRAW_ZOOM - 0.01);
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

  useRouteDrawGestures(map, propId !== null && status === "ready" && !confirming && !saving && !paused, loaded?.doors ?? [], erasing, {
    onStrokeStart: () => {
      // A new stroke ends the last erase run, and its snackbar with it.
      eraseRun.current = { steps: 0, doors: 0 };
      setSnack(null);
    },
    onLink: (uprns) => change((h) => linkDoors(h, uprns)),
    onErase: (uprns) => {
      const on = new Set(presentRef.current);
      const off = uprns.filter((u) => on.has(u));
      if (off.length === 0) return;
      // One step per door (eraseDoors), so the run counts both.
      presentRef.current = presentRef.current.filter((u) => !off.includes(u));
      eraseRun.current = { steps: eraseRun.current.steps + off.length, doors: eraseRun.current.doors + off.length };
      change((h) => eraseDoors(h, off));
      const n = eraseRun.current.doors;
      setSnack(n === 1 ? "Door taken off the route" : `${n} doors taken off the route`);
    },
    onTooFar: () => setZoomedOut(true),
  });

  const undo = useCallback(() => {
    setSnack(null);
    eraseRun.current = { steps: 0, doors: 0 };
    change(undoRoute);
  }, [change]);

  /** The snackbar's Undo: the whole erase stroke comes back. */
  const undoErase = useCallback(() => {
    const steps = eraseRun.current.steps;
    eraseRun.current = { steps: 0, doors: 0 };
    setSnack(null);
    change((h) => {
      let next = h;
      for (let i = 0; i < steps; i += 1) next = undoRoute(next);
      return next;
    });
  }, [change]);
  const redo = useCallback(() => {
    setSnack(null);
    eraseRun.current = { steps: 0, doors: 0 };
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
    onUndoErase: undoErase,
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
