"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MapLayerMouseEvent, PaddingOptions } from "maplibre-gl";

import { MapSheet } from "@/components/admin/map/map-sheet";
import { useAdminMap } from "@/components/admin/map/use-admin-map";
import { useIsDesktop } from "@/components/admin/map/use-is-desktop";
import { DrawMagnifier } from "@/components/admin/props/draw-magnifier";
import { DrawPanel } from "@/components/admin/props/draw-panel";
import { ensureDrawLayers, setDrawShape, type DragState } from "@/components/admin/props/draw-layers";
import { ensureCrmLayers, setCrmDoors, setCrmVisibility } from "@/components/admin/map/crm-layers";
import { LayersPopover } from "@/components/admin/props/layers-popover";
import { PropDetail } from "@/components/admin/props/prop-detail";
import {
  DEFAULT_LAYERS,
  DOORS_LAYER,
  PROPS_FILL,
  applyLayerVisibility,
  ensurePropLayers,
  setDrawDoors,
  setLeadPins,
  setNcczZones,
  setOutcomeDoors,
  setProps,
  setSelectedProp,
  type MapLayers,
  type MapProp,
} from "@/components/admin/props/prop-layers";
import { PropsList, PropsListHeader } from "@/components/admin/props/props-list";
import { RouteDrawPanel } from "@/components/admin/props/route-draw-panel";
import { RoutePanel, type DrawnRoute, type RoutePhase } from "@/components/admin/props/route-panel";
import { useDrawGestures } from "@/components/admin/props/use-draw-gestures";
import { useRouteDraw, type RouteDrawSaved, type RouteDrawTarget } from "@/components/admin/props/use-route-draw";
import { useShapeCount } from "@/components/admin/props/use-shape-count";
import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { IconButton } from "@/components/admin/ui/icon-button";
import { FitIcon, LayersIcon, MinusIcon, PlusIcon, SearchIcon } from "@/components/field/icons";
import { fetchCoverageMap, type CoveragePayload } from "@/lib/admin/coverage";
import { doorsLine } from "@/lib/admin/draw-copy";
import {
  addPoint,
  canRedo,
  canUndo,
  closeShape,
  insertPoint,
  movePoint,
  redo,
  ringKey,
  ringOfShape,
  shapeFromRing,
  startHistory,
  undo,
  type DrawHistory,
} from "@/lib/admin/draw-history";
import { loadCrmDoors } from "@/lib/admin/crm-data";
import { filterCrmDoors, type CrmDoor, type CrmDoorFilter } from "@/lib/admin/crm-map";
import { loadLeadPins } from "@/lib/admin/lead-pins";
import { boxOf, boxOfRing, outerRing, type LngLatBox } from "@/lib/admin/map-fit";
import { coverageHref, visitHref } from "@/lib/admin/nav";
import { loadVisitStats } from "@/lib/admin/prop-visit-stats";
import {
  filterCounts,
  frozenVisitNote,
  matchesFilter,
  matchesQuery,
  propState,
  sortProps,
  type LeadPin,
  type PropFilter,
  type PropRow,
  type VisitStats,
} from "@/lib/admin/props";
import { drawnRouteLine } from "@/lib/admin/route-draw";
import { detentHeights, type Detent } from "@/lib/admin/sheet-detents";
import { useResolvedTheme } from "@/lib/field/theme";
import { countKnockable, type KnockableCount } from "@/lib/geo/count-knockable";
import { fetchNcczZones } from "@/lib/geo/nccz-zones";
import { freezeAssignmentRoute } from "@/lib/geo/walk/freeze";
import { loadManualRoute, setRouteMode, type RouteMode } from "@/lib/geo/walk/manual-save";
import { saveTerritoryRoutes } from "@/lib/geo/walk/save";
import { describeGeometryIssues } from "@/lib/geo/walk/validate";
import { loadAssignmentRouteModel, loadTerritoryRouteModel } from "@/lib/map/route-load";
import {
  emptyRouteModel,
  paintRouteLayers,
  routeBounds,
  toRoutePaintModel,
  walkResultToPaintInput,
  type RoutePaintModel,
} from "@/lib/map/route-layers";
import { saveProp, updatePropRing } from "@/lib/props/actions";
import { clearPropRoutes, renameProp, setPropArchived } from "@/lib/props/manage";
import { createClient } from "@/lib/supabase/client";

const VIEW_KEY = "d2d.admin.props-view";

type DrawSession = {
  kind: "new" | "edit";
  propId: string | null;
  history: DrawHistory;
  /** Edit shape: the saved ring, to tell whether anything changed. */
  originalKey: string;
  naming: boolean;
  name: string;
  baselineDoors: number | null;
  note: string | null;
};

type RouteStep = {
  propId: string;
  title: string;
  savedLine: string;
  edit: boolean;
  phase: RoutePhase;
  previewKey: string | null;
  model: RoutePaintModel | null;
  /** RT-3: the prop's drawn route (R6), or null (R1). */
  drawn: DrawnRoute | null;
  modeBusy: boolean;
  /** RT-3: "hub" when opened from the prop menu (Try again re-reads), "made" after Save (Try again makes the routes again). */
  source: "hub" | "made";
};

/** The model with one variant's steps and points replaced by another model's. */
function withVariant(model: RoutePaintModel | null, key: string, extra: RoutePaintModel): RoutePaintModel {
  const base = model ?? emptyRouteModel();
  return {
    steps: [...base.steps.filter((step) => step.variantKey !== key), ...extra.steps.filter((step) => step.variantKey === key)],
    points: [...base.points.filter((point) => point.variantKey !== key), ...extra.points.filter((point) => point.variantKey === key)],
  };
}

function visitsWord(n: number): string {
  return n === 1 ? "1 upcoming visit" : `${n} upcoming visits`;
}

function onlyVariant(model: RoutePaintModel, key: string): RoutePaintModel {
  return {
    steps: model.steps.filter((step) => step.variantKey === key),
    points: model.points.filter((point) => point.variantKey === key),
  };
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** Enter on a focused button or link activates it; it must not also close the shape. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, [role=switch], [role=menuitem]") !== null;
}

/**
 * UI-10 F2 (owner A19-A23, A25, M2; frames 03-13, D2-D3). Props: one
 * full-screen map with a sheet (phone) or floating panel (desktop) listing
 * every prop, its detail, and Draw / Edit shape as modes of the same map.
 */
export function PropsScreen({
  today,
  rows,
  doorCounts,
  initialPropId,
}: {
  today: string;
  rows: PropRow[];
  doorCounts: Promise<Record<string, number>>;
  initialPropId: string | null;
}) {
  const router = useRouter();
  const mode = useResolvedTheme();
  const desktop = useIsDesktop();
  const root = useRef<HTMLDivElement | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { map, error: mapError } = useAdminMap(container, mode, VIEW_KEY);

  const [filter, setFilter] = useState<PropFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPropId && rows.some((row) => row.id === initialPropId) ? initialPropId : null,
  );
  const [detent, setDetent] = useState<Detent>(initialPropId ? "half" : "peek");
  const [available, setAvailable] = useState(720);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [layersOpen, setLayersOpen] = useState(false);
  // CRM-2 D (owner 2026-10-10): every CRM door by latest result, filterable. Read the first time it is switched on.
  const [crmOn, setCrmOn] = useState(false);
  const [crmFilter, setCrmFilter] = useState<CrmDoorFilter>("all");
  const [crmDoors, setCrmDoorRows] = useState<CrmDoor[] | null>(null);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [doors, setDoors] = useState<Record<string, number>>({});
  const [coverage, setCoverage] = useState<CoveragePayload | null>(null);
  const [pins, setPins] = useState<Map<number, LeadPin> | null>(null);
  const [detailCount, setDetailCount] = useState<{ id: string; count: KnockableCount } | null>(null);
  const [stats, setStats] = useState<{ id: string; stats: Map<string, VisitStats> } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [session, setSession] = useState<DrawSession | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [routeStep, setRouteStep] = useState<RouteStep | null>(null);
  // The prop whose routes are on screen. A slower, older generation never lands on another prop.
  const routeFor = useRef<string | null>(null);
  // RT-3: the manual route editor (R2–R5, D1), opened from the Routes panel.
  const [routeDraw, setRouteDraw] = useState<RouteDrawTarget | null>(null);
  const [routeDiscardOpen, setRouteDiscardOpen] = useState(false);

  const browsing = session === null && routeStep === null && routeDraw === null;
  const browsingRef = useRef(browsing);
  browsingRef.current = browsing;

  // ---- data -------------------------------------------------------------

  useEffect(() => {
    let live = true;
    void doorCounts.then((counts) => {
      if (live) setDoors(counts);
    });
    return () => {
      live = false;
    };
  }, [doorCounts]);

  const items = useMemo(
    () => sortProps(rows.map((row) => ({ row, state: propState(row, today), doors: doors[row.id] ?? null }))),
    [rows, today, doors],
  );
  const counts = useMemo(() => filterCounts(items.map((item) => item.state)), [items]);
  const visible = items.filter((item) => matchesFilter(item.state, filter) && matchesQuery(item.row.name, query));
  const selected = items.find((item) => item.row.id === selectedId) ?? null;

  const emptyText =
    rows.length === 0
      ? "No props yet. Draw the first one."
      : query.trim()
        ? `No props match “${query.trim()}”.`
        : filter === "due"
          ? "Nothing is due."
          : filter === "today"
            ? "No one is out today."
            : filter === "archived"
              ? "No archived props."
              : "No props.";

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(Math.round(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---- map: layers and data -------------------------------------------

  const padding = useCallback(
    (bottom?: number): PaddingOptions => {
      if (desktop) return { top: 72, right: 72, bottom: 48, left: (browsingRef.current || routeStep) && !routeDraw ? 400 : 72 };
      if (!browsingRef.current && !routeStep) return { top: 120, right: 32, bottom: 120, left: 32 };
      return { top: 72, right: 32, bottom: (bottom ?? sheetHeight) + 24, left: 32 };
    },
    [desktop, routeStep, routeDraw, sheetHeight],
  );

  const fitBox = useCallback(
    (box: LngLatBox | null, bottom?: number) => {
      if (!map || !box) return;
      map.fitBounds(box, { padding: padding(bottom), maxZoom: 17, duration: 400 });
    },
    [map, padding],
  );

  useEffect(() => {
    if (!map) return;
    ensurePropLayers(map, mode);
    ensureDrawLayers(map, mode);
    const onPropClick = (event: MapLayerMouseEvent) => {
      if (!browsingRef.current) return;
      const id = event.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      setSelectedId(id);
      setDetent((current) => (current === "peek" ? "half" : current));
    };
    const onEnter = () => {
      if (browsingRef.current) map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      if (browsingRef.current) map.getCanvas().style.cursor = "";
    };
    map.on("click", PROPS_FILL, onPropClick);
    map.on("mouseenter", PROPS_FILL, onEnter);
    map.on("mouseleave", PROPS_FILL, onLeave);
    void fetchNcczZones(createClient()).then((zones) => setNcczZones(map, zones));
    return () => {
      map.off("click", PROPS_FILL, onPropClick);
      map.off("mouseenter", PROPS_FILL, onEnter);
      map.off("mouseleave", PROPS_FILL, onLeave);
    };
  }, [map, mode]);

  useEffect(() => {
    let live = true;
    void fetchCoverageMap(createClient()).then((result) => {
      if (live && result.ok) setCoverage(result.payload);
    });
    void loadLeadPins(createClient()).then((result) => {
      if (live && result.ok) setPins(result.pins);
    });
    return () => {
      live = false;
    };
  }, [rows]);

  const mapProps = useMemo<MapProp[]>(
    () =>
      rows.flatMap((row) => {
        if (!row.geometry) return [];
        const archived = row.archivedAt !== null;
        const show = row.id === selectedId || (filter === "archived" ? archived : !archived);
        return show ? [{ id: row.id, name: row.name, archived, geometry: row.geometry }] : [];
      }),
    [rows, filter, selectedId],
  );

  useEffect(() => {
    if (!map) return;
    setProps(map, mapProps);
    setSelectedProp(map, selectedId);
  }, [map, mapProps, selectedId]);

  useEffect(() => {
    if (!map || !coverage) return;
    setOutcomeDoors(map, coverage.doors, coverage.outcomes);
    if (pins) setLeadPins(map, coverage.doors, pins);
  }, [map, coverage, pins]);

  useEffect(() => {
    if (map) applyLayerVisibility(map, layers, session !== null);
  }, [map, layers, session]);

  useEffect(() => {
    if (!crmOn || crmDoors !== null) return;
    let live = true;
    void loadCrmDoors(createClient()).then((result) => {
      if (!live) return;
      if (result.ok) setCrmDoorRows(result.data);
      else setCrmError(result.message);
    });
    return () => {
      live = false;
    };
  }, [crmOn, crmDoors]);

  useEffect(() => {
    if (!map) return;
    ensureCrmLayers(map, mode);
    setCrmDoors(map, crmOn && crmDoors ? filterCrmDoors(crmDoors, crmFilter) : []);
    setCrmVisibility(map, { heat: false, doors: crmOn && session === null });
  }, [map, mode, crmOn, crmDoors, crmFilter, session]);

  // First view: the remembered one, else every live prop.
  const framed = useRef(false);
  useEffect(() => {
    if (!map || framed.current) return;
    framed.current = true;
    if (selected?.row.geometry) {
      fitBox(boxOf([selected.row.geometry]), detentHeights(available).half);
      return;
    }
    let remembered = false;
    try {
      remembered = sessionStorage.getItem(VIEW_KEY) !== null;
    } catch {
      remembered = false;
    }
    if (!remembered) fitBox(boxOf(rows.filter((row) => !row.archivedAt).map((row) => row.geometry)));
  }, [map, selected, rows, available, fitBox]);

  // ---- prop detail ------------------------------------------------------

  useEffect(() => {
    if (!selected) return;
    setNotice(null);
    const ring = outerRing(selected.row.geometry);
    const supabase = createClient();
    let live = true;
    if (ring) {
      void countKnockable(supabase, ring).then((result) => {
        if (live && result.ok) setDetailCount({ id: selected.row.id, count: result.count });
      });
    }
    const current =
      selected.state.kind === "today" || selected.state.kind === "planned" ? selected.state.visit.id : null;
    void loadVisitStats(
      supabase,
      selected.row.id,
      selected.row.visits.map((visit) => visit.id),
      current,
    ).then((result) => {
      if (!live) return;
      if (result.ok) setStats({ id: selected.row.id, stats: result.stats });
      else setNotice(result.message);
    });
    return () => {
      live = false;
    };
    // Reload when the prop or its visits change, not on every render of `selected`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.row.id, selected?.row.visits, selected?.row.geometry]);

  const selectProp = (id: string) => {
    setNotice(null);
    setSelectedId(id);
    const row = rows.find((item) => item.id === id);
    const next: Detent = detent === "peek" ? "half" : detent;
    setDetent(next);
    if (row?.geometry) fitBox(boxOf([row.geometry]), detentHeights(available)[next]);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setNotice(null);
  };

  useEffect(() => {
    const url = selectedId ? `/admin/props?prop=${encodeURIComponent(selectedId)}` : "/admin/props";
    // `null` state lets Next sync its router with the new URL (UI-10 F3 review).
    window.history.replaceState(null, "", url);
  }, [selectedId]);

  // ---- routes on the map ----------------------------------------------

  useEffect(() => {
    if (!map) return;
    let live = true;
    const paint = (model: RoutePaintModel, key: string) => {
      if (live) paintRouteLayers(map, model, key, DOORS_LAYER, null, mode);
    };
    // The route editor paints its own live route.
    if (routeDraw) return;
    if (routeStep) {
      if (routeStep.model && routeStep.previewKey) paint(onlyVariant(routeStep.model, routeStep.previewKey), routeStep.previewKey);
      else paint(emptyRouteModel(), "");
      return () => {
        live = false;
      };
    }
    if (!layers.routes || !selected || session) {
      paint(emptyRouteModel(), "");
      return () => {
        live = false;
      };
    }
    const supabase = createClient();
    const state = selected.state;
    const frozen = (state.kind === "today" || state.kind === "planned") && state.visit.routeVariantKey ? state.visit : null;
    if (frozen?.routeVariantKey) {
      const key = frozen.routeVariantKey;
      void loadAssignmentRouteModel(supabase, frozen.id, key).then((result) => {
        if (result.ok) paint(result.model, key);
      });
    } else {
      void loadTerritoryRouteModel(supabase, selected.row.id).then((result) => {
        if (result.ok) paint(onlyVariant(result.model, "best"), "best");
      });
    }
    return () => {
      live = false;
    };
  }, [map, mode, routeStep, routeDraw, layers.routes, selected, session]);

  // ---- draw and edit ----------------------------------------------------

  const shape = session?.history.present ?? { points: [], closed: false };
  const ring = session ? ringOfShape(shape) : null;
  const count = useShapeCount(map, ring);
  const naming = session !== null && session.naming && shape.closed;
  const dirty = session
    ? session.kind === "new"
      ? shape.points.length > 0
      : ringKey(ring) !== session.originalKey
    : false;

  useEffect(() => {
    if (!map) return;
    setDrawShape(map, session ? session.history.present : null, drag, session?.kind === "edit" || (session?.history.present.closed ?? false));
  }, [map, session, drag]);

  const update = (change: (history: DrawHistory) => DrawHistory) => {
    setSaveError(null);
    setSession((current) => {
      if (!current) return current;
      const history = change(current.history);
      return { ...current, history, naming: current.naming && history.present.closed };
    });
  };

  useDrawGestures(map, session !== null && !naming && !saving, shape, {
    onAdd: (point) => update((history) => addPoint(history, point)),
    onClose: () => {
      update(closeShape);
      setSession((current) => (current && current.kind === "new" ? { ...current, naming: true } : current));
    },
    onMove: (index, point) => update((history) => movePoint(history, index, point)),
    onInsert: (afterIndex, point) => update((history) => insertPoint(history, afterIndex, point)),
    onDrag: setDrag,
  });

  const startDraw = () => {
    setLayersOpen(false);
    setSelectedId(null);
    setSaveError(null);
    setSession({
      kind: "new",
      propId: null,
      history: startHistory(),
      originalKey: "",
      naming: false,
      name: "",
      baselineDoors: null,
      note: null,
    });
  };

  const startEdit = () => {
    if (!selected) return;
    const saved = outerRing(selected.row.geometry);
    if (!saved) return;
    setLayersOpen(false);
    setSaveError(null);
    setSession({
      kind: "edit",
      propId: selected.row.id,
      history: startHistory(shapeFromRing(saved)),
      originalKey: ringKey(saved),
      naming: false,
      name: selected.row.name,
      baselineDoors: detailCount?.id === selected.row.id ? detailCount.count.knockable : null,
      note: frozenVisitNote(selected.state),
    });
    if (map) {
      map.fitBounds(boxOfRing(saved)!, { padding: desktop ? { top: 96, right: 96, bottom: 72, left: 96 } : { top: 120, right: 40, bottom: 120, left: 40 }, maxZoom: 18, duration: 400 });
    }
  };

  const leaveDraw = () => {
    setSession(null);
    setDrag(null);
    setSaving(false);
    setSaveError(null);
    setDiscardOpen(false);
    if (map) setDrawDoors(map, null);
  };

  const cancelDraw = () => {
    if (dirty) setDiscardOpen(true);
    else leaveDraw();
  };

  const makeRoutes = async (propId: string, edit: boolean) => {
    const mine = (current: RouteStep | null) => current !== null && current.propId === propId;
    setRouteStep((current) => (current && mine(current) ? { ...current, phase: { status: "working" } } : current));
    const saved = await saveTerritoryRoutes(createClient(), propId);
    if (!saved.ok) {
      let message = saved.message;
      if (edit) {
        const cleared = await clearPropRoutes({ id: propId });
        message = cleared.ok
          ? `${saved.message} The old routes no longer fit, so they were removed. New ones are made when the prop is next allocated.`
          : `${saved.message} The old routes still match the old shape. Make new ones before the next visit.`;
      } else {
        message = `${saved.message} A route is made when the prop is first allocated.`;
      }
      setRouteStep((current) => (current && mine(current) ? { ...current, phase: { status: "failed", message } } : current));
      return;
    }
    let model = toRoutePaintModel(walkResultToPaintInput(saved.result));
    const notice = saved.issues.length > 0 ? describeGeometryIssues(saved.issues) : null;
    const drawn = await loadDrawn(propId);
    if (drawn) {
      const stored = await loadTerritoryRouteModel(createClient(), propId);
      if (stored.ok) model = withVariant(model, "manual", stored.model);
    }
    setRouteStep((current) =>
      current && mine(current)
        ? { ...current, phase: { status: "ready", variants: saved.result.variants, notice }, previewKey: drawn?.mode === "manual" && drawn.finished ? "manual" : "best", model, drawn }
        : current,
    );
    const box = routeBounds(model, "best");
    // The route panel covers the left (desktop) or the lower part (phone, frame 12).
    const clear = desktop ? { top: 72, right: 72, bottom: 48, left: 400 } : { top: 72, right: 32, bottom: Math.min(460, Math.round(available * 0.6)), left: 32 };
    if (map && box && routeFor.current === propId) map.fitBounds(box, { padding: clear, maxZoom: 17, duration: 400 });
  };

  const save = async () => {
    if (!session || !ring || saving) return;
    setSaving(true);
    setSaveError(null);
    if (session.kind === "new") {
      const result = await saveProp({ name: session.name, ring });
      if (!result.ok) {
        setSaving(false);
        setSaveError(result.message);
        return;
      }
      leaveDraw();
      routeFor.current = result.id;
      setRouteStep({ propId: result.id, title: result.name, savedLine: `Saved ${result.name}.`, edit: false, phase: { status: "working" }, previewKey: null, model: null, drawn: null, modeBusy: false, source: "made" });
      router.refresh();
      void makeRoutes(result.id, false);
      return;
    }
    if (!session.propId) return;
    const result = await updatePropRing({ id: session.propId, ring });
    if (!result.ok) {
      setSaving(false);
      setSaveError(result.message);
      return;
    }
    const propId = session.propId;
    leaveDraw();
    routeFor.current = propId;
    setRouteStep({ propId, title: result.name, savedLine: "New shape saved.", edit: true, phase: { status: "working" }, previewKey: null, model: null, drawn: null, modeBusy: false, source: "made" });
    router.refresh();
    void makeRoutes(propId, true);
  };

  const finishRoutes = () => {
    const propId = routeStep?.propId ?? null;
    routeFor.current = null;
    setRouteStep(null);
    if (propId) {
      setFilter("all");
      setSelectedId(propId);
      setDetent("half");
    }
    router.refresh();
  };

  // ---- RT-3: drawn routes ---------------------------------------------------

  /** The prop's drawn route for the Routes panel, or null when it has none (or it could not be read). */
  async function loadDrawn(propId: string): Promise<DrawnRoute | null> {
    const manual = await loadManualRoute(createClient(), propId);
    if (!manual.ok || !manual.record.drawing) return null;
    const drawing = manual.record.drawing;
    return { mode: manual.record.routeMode, line: drawnRouteLine(drawing.chain.length, drawing.leftOut.length), finished: drawing.status === "ready" };
  }

  /**
   * Owner O8: unworked visits from today on take the prop's route again
   * (freeze picks it: the drawn route when it fits the visit, else A / B).
   * A visit with knocks keeps its route (freeze refuses it). Counts the
   * visits re-frozen on the drawn route and on A / B (a visit whose doors
   * differ from the drawing keeps A / B: 041).
   */
  async function refreezeUpcoming(propId: string): Promise<{ manual: number; auto: number; picked: number }> {
    // RT-START (043): a visit with a picked route keeps it; the freeze says so (summary.chosen).
    const counts = { manual: 0, auto: 0, picked: 0 };
    const row = rows.find((item) => item.id === propId);
    if (!row) return counts;
    const supabase = createClient();
    for (const visit of row.visits) {
      if (visit.workDate < today || visit.startedAt !== null || visit.closedAt !== null) continue;
      const frozen = await freezeAssignmentRoute(supabase, visit.id);
      if (!frozen.ok) continue;
      if (frozen.summary.chosen) counts.picked += 1;
      else if (frozen.summary.variantKey.startsWith("manual")) counts.manual += 1;
      else counts.auto += 1;
    }
    return counts;
  }

  /** The Routes panel for a saved prop (prop ⋯ → Routes): its saved routes, and the drawn one if any. */
  const openRoutes = async (propId: string) => {
    const row = rows.find((item) => item.id === propId);
    if (!row) return;
    routeFor.current = propId;
    setRouteStep({ propId, title: row.name, savedLine: row.name, edit: false, phase: { status: "working" }, previewKey: null, model: null, drawn: null, modeBusy: false, source: "hub" });
    const [drawn, stored] = await Promise.all([loadDrawn(propId), loadTerritoryRouteModel(createClient(), propId)]);
    if (routeFor.current !== propId) return;
    if (!stored.ok) {
      setRouteStep((current) => (current && current.propId === propId ? { ...current, phase: { status: "failed", message: stored.message } } : current));
      return;
    }
    setRouteStep((current) =>
      current && current.propId === propId
        ? {
            ...current,
            phase: { status: "ready", variants: stored.summaries.filter((summary) => !summary.key.startsWith("manual")), notice: null },
            model: stored.model,
            drawn,
            previewKey: drawn?.mode === "manual" && drawn.finished ? "manual" : "best",
          }
        : current,
    );
    const box = routeBounds(stored.model, drawn?.mode === "manual" && drawn.finished ? "manual" : "best");
    const clear = desktop ? { top: 72, right: 72, bottom: 48, left: 400 } : { top: 72, right: 32, bottom: Math.min(460, Math.round(available * 0.6)), left: 32 };
    if (map && box) map.fitBounds(box, { padding: clear, maxZoom: 17, duration: 400 });
  };

  const fitDraw = useCallback(
    (box: [[number, number], [number, number]]) => {
      if (!map) return;
      // RT-5: the whole prop. Drawing works at any zoom.
      const pad = desktop ? { top: 96, right: 96, bottom: 72, left: 96 } : { top: 140, right: 32, bottom: 120, left: 32 };
      map.fitBounds(box, { padding: pad, maxZoom: 18, duration: 400 });
    },
    [map, desktop],
  );

  const onRouteSaved = useCallback(
    (saved: RouteDrawSaved) => {
      const propId = routeDraw?.propId;
      setRouteDraw(null);
      if (!propId) return;
      const extra = toRoutePaintModel(walkResultToPaintInput({ variants: [saved.manual] }));
      const drawn: DrawnRoute = { mode: "manual", line: drawnRouteLine(saved.linked, saved.leftOut), finished: saved.summary.status === "ready" };
      const base = saved.summary.status === "ready" ? "Your route is saved." : "Your route is saved. New doors are not on it yet.";
      setRouteStep((current) =>
        current && current.propId === propId
          ? { ...current, drawn, model: withVariant(current.model, "manual", extra), previewKey: drawn.finished ? "manual" : "best", savedLine: base }
          : current,
      );
      // Show the whole saved route above the Routes panel.
      const box = routeBounds(extra, "manual");
      const clear = desktop ? { top: 72, right: 72, bottom: 48, left: 400 } : { top: 72, right: 32, bottom: Math.min(460, Math.round(available * 0.6)), left: 32 };
      if (map && box) map.fitBounds(box, { padding: clear, maxZoom: 17, duration: 400 });
      void refreezeUpcoming(propId).then(({ manual, auto, picked }) => {
        const parts = [base];
        if (manual > 0) parts.push(`${visitsWord(manual)} now ${manual === 1 ? "uses" : "use"} it.`);
        if (auto > 0) parts.push(`${visitsWord(auto)} ${auto === 1 ? "keeps" : "keep"} Route A and B: ${auto === 1 ? "its" : "their"} doors differ from your route.`);
        if (picked > 0) parts.push(`${visitsWord(picked)} ${picked === 1 ? "keeps the route picked for it" : "keep the routes picked for them"}.`);
        if (parts.length === 1) return;
        setRouteStep((current) => (current && current.propId === propId ? { ...current, savedLine: parts.join(" ") } : current));
      });
      router.refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeDraw, rows, today, map, desktop, available],
  );

  const changeMode = async (mode: RouteMode) => {
    const propId = routeStep?.propId;
    if (!propId) return;
    setRouteStep((current) => (current ? { ...current, modeBusy: true } : current));
    const result = await setRouteMode(createClient(), propId, mode);
    if (!result.ok) {
      setRouteStep((current) => (current && current.propId === propId ? { ...current, modeBusy: false, savedLine: result.message } : current));
      return;
    }
    const counts = await refreezeUpcoming(propId);
    const unfinished = mode === "manual" && result.manualStatus !== "ready";
    const count = mode === "manual" ? counts.manual : counts.manual + counts.auto;
    const what = unfinished
      ? "Your route needs finishing: visits use Route A and B until you save it again."
      : mode === "manual"
        ? "Visits now use your route."
        : "Visits now use the automatic routes.";
    setRouteStep((current) =>
      current && current.propId === propId && current.drawn
        ? {
            ...current,
            modeBusy: false,
            drawn: { ...current.drawn, mode },
            savedLine: [
              what,
              count > 0 ? `${visitsWord(count)} updated.` : "",
              mode === "manual" && !unfinished && counts.auto > 0
                ? `${visitsWord(counts.auto)} ${counts.auto === 1 ? "keeps" : "keep"} Route A and B: ${counts.auto === 1 ? "its" : "their"} doors differ from your route.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : current,
    );
    router.refresh();
  };

  const draw = useRouteDraw(map, mode, routeDraw, fitDraw, onRouteSaved, routeDiscardOpen);

  const leaveRouteDraw = () => {
    setRouteDiscardOpen(false);
    setRouteDraw(null);
  };

  const cancelRouteDraw = () => {
    if (draw.saving) return;
    if (draw.confirming) {
      draw.closeConfirm();
      return;
    }
    if (draw.dirty) setRouteDiscardOpen(true);
    else leaveRouteDraw();
  };

  // Keyboard: "/" to search; while drawing ⌘Z, ⇧⌘Z, Enter, Escape (D3).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (discardOpen || archiveOpen || layersOpen || routeDiscardOpen) return;
      if (routeDraw) {
        if (isTyping(event.target) || draw.saving) return;
        // The save sheet is up: only Escape (Keep drawing).
        if (draw.confirming && event.key !== "Escape") return;
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) draw.redo();
          else draw.undo();
        } else if (mod && event.key.toLowerCase() === "y") {
          event.preventDefault();
          draw.redo();
        } else if (!mod && event.key.toLowerCase() === "e" && draw.ready) {
          event.preventDefault();
          draw.toggleErase();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelRouteDraw();
        }
        return;
      }
      if (browsing) {
        if (event.key === "/" && searchRef.current && !isTyping(event.target)) {
          event.preventDefault();
          searchRef.current?.focus();
        }
        return;
      }
      if (!session || naming) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        update(event.shiftKey ? redo : undo);
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        update(redo);
      } else if (event.key === "Enter" && !isTyping(event.target) && !isControl(event.target) && !shape.closed) {
        event.preventDefault();
        update(closeShape);
        if (session.kind === "new") setSession((current) => (current ? { ...current, naming: true } : current));
      } else if (event.key === "Escape" && !isTyping(event.target)) {
        event.preventDefault();
        cancelDraw();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- actions on a prop -------------------------------------------------

  const rename = async (name: string): Promise<string | null> => {
    if (!selected) return null;
    const result = await renameProp({ id: selected.row.id, name });
    if (!result.ok) return result.message;
    router.refresh();
    return null;
  };

  const archive = async () => {
    if (!selected) return;
    setBusy(true);
    const result = await setPropArchived({ id: selected.row.id, archived: true });
    setBusy(false);
    setArchiveOpen(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    closeDetail();
    router.refresh();
  };

  const restore = async () => {
    if (!selected) return;
    const result = await setPropArchived({ id: selected.row.id, archived: false });
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setFilter("all");
    router.refresh();
  };

  const zoom = (by: 1 | -1) => {
    if (!map) return;
    if (by > 0) map.zoomIn();
    else map.zoomOut();
  };

  // ---- render ------------------------------------------------------------

  return (
    <div ref={root} className="relative h-full w-full overflow-hidden bg-field-bg">
      <div ref={container} className="admin-map h-full w-full" data-testid="props-map" />
      {!map ? (
        <p className="absolute inset-x-6 top-1/3 text-center text-admin-subhead text-ink-muted" role="status">
          {mapError ?? "Loading the map…"}
        </p>
      ) : null}

      {browsing ? (
        <>
          <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 lg:hidden">
            <AdminMenuButton floating />
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-4 text-ink-muted shadow-admin-float focus-within:outline-2 focus-within:outline-prop">
              <SearchIcon className="size-5 shrink-0" />
              <span className="sr-only">Search props</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (selectedId) setSelectedId(null);
                  setDetent((current) => (current === "peek" ? "half" : current));
                }}
                placeholder="Search props"
                className="min-w-0 flex-1 bg-transparent text-admin-body text-ink outline-none placeholder:text-ink-muted"
              />
            </label>
            <IconButton kind="floating" label="Map layers" onClick={() => setLayersOpen((open) => !open)} data-layers-button>
              <LayersIcon className="size-6" />
            </IconButton>
          </div>
          <div className="absolute top-3 right-3 z-10 hidden lg:block">
            <IconButton kind="floating" label="Map layers" onClick={() => setLayersOpen((open) => !open)} data-layers-button>
              <LayersIcon className="size-6" />
            </IconButton>
          </div>
          <div
            className="absolute right-3 z-10 flex flex-col gap-2 transition-[bottom] duration-200 motion-reduce:transition-none"
            style={{ bottom: (desktop ? 0 : sheetHeight) + 12 }}
          >
            {desktop ? (
              <div className="flex flex-col overflow-hidden rounded-full border border-line bg-surface shadow-admin-float">
                <IconButton label="Zoom in" onClick={() => zoom(1)}>
                  <PlusIcon className="size-5" />
                </IconButton>
                <span aria-hidden className="mx-2.5 border-t border-line" />
                <IconButton label="Zoom out" onClick={() => zoom(-1)}>
                  <MinusIcon className="size-5" />
                </IconButton>
              </div>
            ) : null}
            <IconButton
              kind="floating"
              label="Show all props"
              onClick={() => fitBox(boxOf(mapProps.map((prop) => prop.geometry)))}
            >
              <FitIcon className="size-6" />
            </IconButton>
          </div>

          <MapSheet
            label="Props"
            detent={detent}
            onDetent={setDetent}
            available={available}
            onHeight={setSheetHeight}
            header={
              selected ? null : (
                <PropsListHeader
                  counts={counts}
                  filter={filter}
                  onFilter={(next) => {
                    setFilter(next);
                    setDetent((current) => (current === "peek" ? "half" : current));
                  }}
                  onDraw={startDraw}
                  query={query}
                  onQuery={setQuery}
                  searchRef={searchRef}
                />
              )
            }
          >
            {selected ? (
              <PropDetail
                key={selected.row.id}
                row={selected.row}
                state={selected.state}
                today={today}
                doorsText={detailCount?.id === selected.row.id ? doorsLine(detailCount.count) : null}
                stats={stats?.id === selected.row.id ? stats.stats : null}
                statsError={notice}
                visitHref={
                  selected.state.kind === "today" || selected.state.kind === "planned"
                    ? visitHref(selected.state.visit.id)
                    : "/admin/today"
                }
                coverageHref={coverageHref(selected.row.id)}
                onClose={closeDetail}
                onRename={rename}
                onEditShape={startEdit}
                onRoutes={() => void openRoutes(selected.row.id)}
                onArchive={() => setArchiveOpen(true)}
                onRestore={() => void restore()}
              />
            ) : (
              <PropsList items={visible} selectedId={selectedId} onSelect={selectProp} emptyText={emptyText} />
            )}
          </MapSheet>
        </>
      ) : null}

      {session ? (
        <>
          <DrawPanel
            kind={session.kind}
            shape={shape}
            canUndo={canUndo(session.history)}
            canRedo={canRedo(session.history)}
            count={count}
            baselineDoors={session.baselineDoors}
            note={session.note}
            naming={naming}
            dirty={dirty}
            name={session.name}
            saving={saving}
            error={saveError}
            onName={(name) => setSession((current) => (current ? { ...current, name } : current))}
            onUndo={() => update(undo)}
            onRedo={() => update(redo)}
            onCloseShape={() => {
              update(closeShape);
              if (session.kind === "new") setSession((current) => (current ? { ...current, naming: true } : current));
            }}
            onCancel={cancelDraw}
            onSave={() => void save()}
            onKeepEditing={() => setSession((current) => (current ? { ...current, naming: false } : current))}
            onNameIt={() => setSession((current) => (current ? { ...current, naming: true } : current))}
            onShowZones={() => setLayers((current) => ({ ...current, nccz: true }))}
            zonesOn={layers.nccz}
            onLayers={() => setLayersOpen((open) => !open)}
          />
          <DrawMagnifier map={map} mode={mode} shape={shape} drag={drag} />
        </>
      ) : null}

      {routeDraw ? <RouteDrawPanel title={routeDraw.title} onCancel={cancelRouteDraw} {...draw.panel} /> : null}

      {routeStep && !routeDraw ? (
        <RoutePanel
          title={routeStep.title}
          savedLine={routeStep.savedLine}
          phase={routeStep.phase}
          previewKey={routeStep.previewKey}
          onPreview={(key) => {
            setRouteStep((current) => (current ? { ...current, previewKey: key } : current));
          }}
          onRetry={() => (routeStep.source === "hub" ? void openRoutes(routeStep.propId) : void makeRoutes(routeStep.propId, routeStep.edit))}
          onDone={finishRoutes}
          drawn={routeStep.drawn}
          modeBusy={routeStep.modeBusy}
          onDrawOwn={() => setRouteDraw({ propId: routeStep.propId, title: routeStep.title })}
          onMode={(next) => void changeMode(next)}
        />
      ) : null}

      <LayersPopover
        open={layersOpen}
        layers={layers}
        onChange={setLayers}
        onClose={() => setLayersOpen(false)}
        mode={mode}
        crm={{
          on: crmOn,
          filter: crmFilter,
          count: crmDoors ? filterCrmDoors(crmDoors, crmFilter).length : null,
          // Shown only while there are no doors yet; switching the layer on again clears it and retries.
          error: crmDoors === null ? crmError : null,
          onToggle: (on: boolean) => {
            if (on) setCrmError(null);
            setCrmOn(on);
          },
          onFilter: setCrmFilter,
        }}
      />

      <ConfirmDialog
        open={archiveOpen && selected !== null}
        title={`Archive ${selected?.row.name ?? "this prop"}?`}
        body="It leaves the map and can no longer be allocated. Its visits, knocks and leads stay. You can restore it from Archived."
        confirmLabel="Archive prop"
        busy={busy}
        onConfirm={() => void archive()}
        onCancel={() => setArchiveOpen(false)}
      />
      <ConfirmDialog
        open={routeDiscardOpen}
        title="Discard this drawing?"
        body={
          routeStep?.drawn
            ? "The doors you linked or took off since you opened it will be lost. The saved route stays as it was."
            : "The doors you linked will be lost."
        }
        confirmLabel="Discard drawing"
        onConfirm={leaveRouteDraw}
        onCancel={() => setRouteDiscardOpen(false)}
      />
      <ConfirmDialog
        open={discardOpen}
        title={session?.kind === "edit" ? "Discard your changes?" : "Discard this prop?"}
        body={session?.kind === "edit" ? "The shape goes back to how it was saved." : "The corners you have placed will be lost."}
        confirmLabel={session?.kind === "edit" ? "Discard changes" : "Discard prop"}
        onConfirm={leaveDraw}
        onCancel={() => setDiscardOpen(false)}
      />
    </div>
  );
}
