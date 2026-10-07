"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MapLayerMouseEvent, PaddingOptions } from "maplibre-gl";

import { MapSheet } from "@/components/admin/map/map-sheet";
import { useAdminMap } from "@/components/admin/map/use-admin-map";
import { useIsDesktop } from "@/components/admin/map/use-is-desktop";
import { DrawPanel } from "@/components/admin/props/draw-panel";
import { ensureDrawLayers, setDrawShape, type DragState } from "@/components/admin/props/draw-layers";
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
import { RoutePanel, type RoutePhase } from "@/components/admin/props/route-panel";
import { useDrawGestures } from "@/components/admin/props/use-draw-gestures";
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
import { detentHeights, type Detent } from "@/lib/admin/sheet-detents";
import { useResolvedTheme } from "@/lib/field/theme";
import { countKnockable, type KnockableCount } from "@/lib/geo/count-knockable";
import { fetchNcczZones } from "@/lib/geo/nccz-zones";
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
};

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

  const browsing = session === null && routeStep === null;
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
      if (desktop) return { top: 72, right: 72, bottom: 48, left: browsingRef.current || routeStep ? 400 : 72 };
      if (!browsingRef.current && !routeStep) return { top: 120, right: 32, bottom: 120, left: 32 };
      return { top: 72, right: 32, bottom: (bottom ?? sheetHeight) + 24, left: 32 };
    },
    [desktop, routeStep, sheetHeight],
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
    window.history.replaceState(window.history.state, "", url);
  }, [selectedId]);

  // ---- routes on the map ----------------------------------------------

  useEffect(() => {
    if (!map) return;
    let live = true;
    const paint = (model: RoutePaintModel, key: string) => {
      if (live) paintRouteLayers(map, model, key, DOORS_LAYER, null, mode);
    };
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
  }, [map, mode, routeStep, layers.routes, selected, session]);

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
    const model = toRoutePaintModel(walkResultToPaintInput(saved.result));
    const notice = saved.issues.length > 0 ? describeGeometryIssues(saved.issues) : null;
    setRouteStep((current) =>
      current && mine(current)
        ? { ...current, phase: { status: "ready", variants: saved.result.variants, notice }, previewKey: "best", model }
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
      setRouteStep({ propId: result.id, title: result.name, savedLine: `Saved ${result.name}.`, edit: false, phase: { status: "working" }, previewKey: null, model: null });
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
    setRouteStep({ propId, title: result.name, savedLine: "New shape saved.", edit: true, phase: { status: "working" }, previewKey: null, model: null });
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

  // Keyboard: "/" to search; while drawing ⌘Z, ⇧⌘Z, Enter, Escape (D3).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (discardOpen || archiveOpen || layersOpen) return;
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
                visitHref={visitHref(selected.row.id)}
                coverageHref={coverageHref(selected.row.id)}
                onClose={closeDetail}
                onRename={rename}
                onEditShape={startEdit}
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
        </>
      ) : null}

      {routeStep ? (
        <RoutePanel
          title={routeStep.title}
          savedLine={routeStep.savedLine}
          phase={routeStep.phase}
          previewKey={routeStep.previewKey}
          onPreview={(key) => {
            setRouteStep((current) => (current ? { ...current, previewKey: key } : current));
          }}
          onRetry={() => void makeRoutes(routeStep.propId, routeStep.edit)}
          onDone={finishRoutes}
        />
      ) : null}

      <LayersPopover
        open={layersOpen}
        layers={layers}
        onChange={setLayers}
        onClose={() => setLayersOpen(false)}
        mode={mode}
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
