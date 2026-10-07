"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MapLayerMouseEvent, PaddingOptions } from "maplibre-gl";

import { MapSheet } from "@/components/admin/map/map-sheet";
import { useAdminMap } from "@/components/admin/map/use-admin-map";
import { useIsDesktop } from "@/components/admin/map/use-is-desktop";
import { LayersPopover } from "@/components/admin/props/layers-popover";
import { PropDetail } from "@/components/admin/props/prop-detail";
import {
  DEFAULT_LAYERS,
  DOORS_LAYER,
  PROPS_FILL,
  applyLayerVisibility,
  ensurePropLayers,
  setLeadPins,
  setNcczZones,
  setOutcomeDoors,
  setProps,
  setSelectedProp,
  type MapLayers,
  type MapProp,
} from "@/components/admin/props/prop-layers";
import { PropsList, PropsListHeader } from "@/components/admin/props/props-list";
import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { IconButton } from "@/components/admin/ui/icon-button";
import { FitIcon, LayersIcon, MinusIcon, PlusIcon, SearchIcon } from "@/components/field/icons";
import { fetchCoverageMap, type CoveragePayload } from "@/lib/admin/coverage";
import { doorsLine } from "@/lib/admin/draw-copy";
import { loadLeadPins } from "@/lib/admin/lead-pins";
import { boxOf, outerRing, type LngLatBox } from "@/lib/admin/map-fit";
import { coverageHref, visitHref } from "@/lib/admin/nav";
import { loadVisitStats } from "@/lib/admin/prop-visit-stats";
import {
  filterCounts,
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
import { loadAssignmentRouteModel, loadTerritoryRouteModel } from "@/lib/map/route-load";
import { emptyRouteModel, paintRouteLayers, type RoutePaintModel } from "@/lib/map/route-layers";
import { renameProp, setPropArchived } from "@/lib/props/manage";
import { createClient } from "@/lib/supabase/client";

const VIEW_KEY = "d2d.admin.props-view";

function onlyVariant(model: RoutePaintModel, key: string): RoutePaintModel {
  return {
    steps: model.steps.filter((step) => step.variantKey === key),
    points: model.points.filter((point) => point.variantKey === key),
  };
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * UI-10 F2 (owner A19-A23, A25, M2; frames 03-07, D2). Props: one
 * full-screen map with a sheet (phone) or floating panel (desktop) listing
 * every prop and its detail. F2d adds Draw and Edit shape as modes of the
 * same map.
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
      if (desktop) return { top: 72, right: 72, bottom: 48, left: 400 };
      return { top: 72, right: 32, bottom: (bottom ?? sheetHeight) + 24, left: 32 };
    },
    [desktop, sheetHeight],
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
    const onPropClick = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      setSelectedId(id);
      setDetent((current) => (current === "peek" ? "half" : current));
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
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
    if (map) applyLayerVisibility(map, layers, false);
  }, [map, layers]);

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
    if (!layers.routes || !selected) {
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
  }, [map, mode, layers.routes, selected]);

  // Keyboard: "/" to search (D2).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (archiveOpen) return;
      if (event.key === "/" && searchRef.current && !isTyping(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archiveOpen]);

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
            onArchive={() => setArchiveOpen(true)}
            onRestore={() => void restore()}
          />
        ) : (
          <PropsList items={visible} selectedId={selectedId} onSelect={selectProp} emptyText={emptyText} />
        )}
      </MapSheet>

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
    </div>
  );
}
