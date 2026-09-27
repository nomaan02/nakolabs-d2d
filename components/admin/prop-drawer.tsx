"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";

import { AdminNav } from "@/components/admin/admin-nav";
import { PropTally } from "@/components/admin/prop-tally";
import { RouteOverlay, type RouteVariantChoice } from "@/components/admin/route-overlay";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { countKnockable, type KnockableCount } from "@/lib/geo/count-knockable";
import { type Ring } from "@/lib/geo/prop-polygon";
import { previewTerritoryRoutes, saveTerritoryRoutes } from "@/lib/geo/walk/save";
import { describeGeometryIssues } from "@/lib/geo/walk/validate";
import { loadTerritoryRouteModel } from "@/lib/map/route-load";
import {
  applyRouteActive,
  compareVariantKeys,
  emptyRouteModel,
  fitRouteBounds,
  paintRouteLayers,
  routeSaveEnabled,
  toRoutePaintModel,
  walkResultToPaintInput,
  ROUTE_LINE_SOURCE,
  type RoutePaintModel,
} from "@/lib/map/route-layers";
import {
  DOT_CAP,
  propertiesInPolygon,
  type DoorCollection,
} from "@/lib/geo/properties-in-polygon";
import { saveProp, updatePropRing } from "@/lib/props/actions";
import { createClient } from "@/lib/supabase/client";

// MapLibre derives this from `import.meta.url` and gives up silently when the
// bundler has rewritten it, leaving a worker that never boots and a map that
// never finishes loading. `npm run maplibre:worker` puts the chunk here.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const BRISTOL: [number, number] = [-2.5879, 51.4545];
const BRISTOL_ZOOM = 12.4;
const DOORS_SOURCE = "prop-doors";
const EMPTY_DOORS: DoorCollection = { type: "FeatureCollection", features: [] };
// Drawing props is repetitive work in one part of the city at a time, so the
// view is remembered. Kept in session storage rather than the URL: MapLibre's
// own `hash` option rewrites the location on every pan, which the App Router
// treats as a navigation and remounts the map mid-load.
const VIEW_KEY = "prop-drawer-view";

type View = { lng: number; lat: number; zoom: number };

function readView(): View | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const view = JSON.parse(raw) as Partial<View>;
    if (
      typeof view.lng !== "number" ||
      typeof view.lat !== "number" ||
      typeof view.zoom !== "number"
    ) {
      return null;
    }
    return { lng: view.lng, lat: view.lat, zoom: view.zoom };
  } catch {
    return null;
  }
}

export type SavedProp = { id: string; name: string; created_at: string };

type Phase =
  | { kind: "idle" }
  | { kind: "counting" }
  | { kind: "counted"; ring: Ring; count: KnockableCount; shown: number }
  | { kind: "failed"; message: string; detail?: string };

type Tool = "draw" | "amend";

type RouteView = {
  keys: string[];
  highlighted: string;
  /** The ring this preview was generated from. A later edit sets `stale`. */
  ringKey: string;
  stale: boolean;
  /** True after Save has written territory_routes. The model then comes from those rows. */
  persisted: boolean;
  model: RoutePaintModel;
  variants: RouteVariantChoice[];
};

function ringKeyOf(ring: Ring): string {
  return JSON.stringify(ring);
}

/** Reads a design token so the map and the rail cannot drift apart. */
function token(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function PropDrawer({
  savedProps,
  signedInAs,
}: {
  savedProps: SavedProp[];
  signedInAs: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const request = useRef(0);
  const recountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measuredRing = useRef<string | null>(null);
  const routeRef = useRef<RouteView | null>(null);
  const paintedModel = useRef<RoutePaintModel | null>(null);
  const paintRouteRef = useRef<(force: boolean) => void>(() => {});

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("draw");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [savedTerritory, setSavedTerritory] = useState<{ id: string; ringKey: string } | null>(null);
  const [routeView, setRouteView] = useState<RouteView | null>(null);
  const [routeBusy, setRouteBusy] = useState<null | "generating" | "saving">(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const router = useRouter();
  const phaseRef = useRef(phase);
  routeRef.current = routeView;
  phaseRef.current = phase;

  const setDoors = useCallback((doors: DoorCollection) => {
    const source = map.current?.getSource(DOORS_SOURCE) as GeoJSONSource | undefined;
    source?.setData(doors);
  }, []);

  /** Counts the prop, then draws the doors it counted. Never the other way round. */
  const measure = useCallback(
    async (ring: Ring) => {
      const seq = (request.current += 1);
      const key = ringKeyOf(ring);
      measuredRing.current = key;
      // Same session only. `territories` has no column that records when the
      // polygon last changed, so a boundary edited before this page was
      // opened cannot be told apart from the one the routes were generated
      // from. That case stays undetected rather than guessed.
      setRouteView((current) => {
        if (!current) return current;
        if (current.ringKey === key) return current.stale ? { ...current, stale: false } : current;
        return { ...current, stale: true };
      });
      setSaved(null);
      setSaveError(null);
      setPhase({ kind: "counting" });

      const supabase = createClient();
      const counted = await countKnockable(supabase, ring);
      if (seq !== request.current) return;

      if (!counted.ok) {
        setDoors(EMPTY_DOORS);
        setPhase({ kind: "failed", message: counted.message, detail: counted.detail });
        return;
      }

      const doors = await propertiesInPolygon(supabase, ring, DOT_CAP);
      if (seq !== request.current) return;

      if (!doors.ok) {
        setDoors(EMPTY_DOORS);
        setPhase({ kind: "counted", ring, count: counted.count, shown: 0 });
        return;
      }

      setDoors(doors.doors);
      setPhase({
        kind: "counted",
        ring,
        count: counted.count,
        shown: doors.doors.features.length,
      });
    },
    [setDoors],
  );

  useEffect(() => {
    if (!container.current || map.current) return;

    paintRouteRef.current = (force: boolean) => {
      const instance = map.current;
      if (!instance?.getStyle() || !instance.getLayer(DOORS_SOURCE)) return;
      const view = routeRef.current;
      if (!view) {
        if (force || paintedModel.current) {
          paintRouteLayers(instance, emptyRouteModel(), "", DOORS_SOURCE);
          paintedModel.current = null;
        }
        return;
      }
      const modelChanged = paintedModel.current !== view.model;
      if (force || modelChanged) {
        paintRouteLayers(instance, view.model, view.highlighted, DOORS_SOURCE);
        paintedModel.current = view.model;
        if (modelChanged) {
          fitRouteBounds(instance, view.model, view.highlighted, { maxZoom: 16 });
        }
      } else if (instance.getSource(ROUTE_LINE_SOURCE)) {
        applyRouteActive(instance, view.model, view.highlighted);
      }
    };

    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    const view = readView();
    const instance = new MapLibreMap({
      container: container.current,
      style: `https://api.maptiler.com/maps/dataviz-light/style.json?key=${key}`,
      center: view ? [view.lng, view.lat] : BRISTOL,
      zoom: view ? view.zoom : BRISTOL_ZOOM,
      attributionControl: { compact: false },
    });

    instance.on("moveend", () => {
      const centre = instance.getCenter();
      const next: View = { lng: centre.lng, lat: centre.lat, zoom: instance.getZoom() };
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        // A full or blocked session store is not worth interrupting drawing for.
      }
    });
    map.current = instance;

    instance.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
    instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    // A blank plate with no explanation is the worst outcome here.
    instance.on("error", (event) => {
      setMapError(event.error?.message ?? "The map could not be loaded.");
    });

    // Feature-state has to be applied here as well as in the effect. The
    // effect returns early until the door layer exists, and a style reload
    // would otherwise leave every variant dimmed.
    instance.on("style.load", () => {
      paintRouteRef.current(true);
    });

    instance.on("load", () => {
      try {
      // Added before Terra Draw starts, so the prop outline and its draggable
      // corners always render above the doors.
      instance.addSource(DOORS_SOURCE, { type: "geojson", data: EMPTY_DOORS });
      instance.addLayer({
        id: DOORS_SOURCE,
        type: "circle",
        source: DOORS_SOURCE,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            1.8,
            15,
            2.8,
            17,
            4.2,
            19,
            6.5,
          ],
          // Knockable doors are solid Bristol blue. Doors in a No Cold Calling
          // Zone are hollow with an oxide ring, so they read as excluded by
          // shape as well as by colour.
          "circle-color": [
            "case",
            ["get", "is_nccz"],
            token("--color-paper", "#fbfaf8"),
            token("--color-prop", "#1b4aa6"),
          ],
          "circle-stroke-width": ["case", ["get", "is_nccz"], 1.6, 0.6],
          "circle-stroke-color": [
            "case",
            ["get", "is_nccz"],
            token("--color-oxide", "#7a2b33"),
            token("--color-paper", "#fbfaf8"),
          ],
        },
      });

      const instanceDraw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: instance }),
        modes: [
          new TerraDrawPolygonMode({
            showCoordinatePoints: true,
            styles: {
              fillColor: token("--color-prop", "#1b4aa6") as `#${string}`,
              fillOpacity: 0.1,
              outlineColor: token("--color-prop", "#1b4aa6") as `#${string}`,
              outlineWidth: 2,
              closingPointColor: token("--color-paper", "#fbfaf8") as `#${string}`,
              closingPointOutlineColor: token("--color-ink", "#1c2226") as `#${string}`,
              closingPointWidth: 6,
              closingPointOutlineWidth: 2,
              coordinatePointColor: token("--color-paper", "#fbfaf8") as `#${string}`,
              coordinatePointOutlineColor: token("--color-prop", "#1b4aa6") as `#${string}`,
              coordinatePointWidth: 4,
              coordinatePointOutlineWidth: 2,
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: false,
                  coordinates: { midpoints: true, draggable: true, deletable: true },
                },
              },
            },
            styles: {
              selectedPolygonColor: token("--color-prop", "#1b4aa6") as `#${string}`,
              selectedPolygonFillOpacity: 0.1,
              selectedPolygonOutlineColor: token("--color-prop", "#1b4aa6") as `#${string}`,
              selectedPolygonOutlineWidth: 2,
              selectionPointColor: token("--color-paper", "#fbfaf8") as `#${string}`,
              selectionPointOutlineColor: token("--color-prop", "#1b4aa6") as `#${string}`,
              selectionPointWidth: 5,
              selectionPointOutlineWidth: 2,
              midPointColor: token("--color-worksheet", "#e4e6de") as `#${string}`,
              midPointOutlineColor: token("--color-ink-soft", "#4a5259") as `#${string}`,
              midPointWidth: 3,
              midPointOutlineWidth: 1,
            },
          }),
        ],
      });

      instanceDraw.start();
      instanceDraw.setMode("polygon");

      // Closing the ring is the moment the count happens.
      instanceDraw.on("finish", (id, context) => {
        if (context.action !== "draw") return;
        const ring = ringOf(instanceDraw, id);
        if (!ring) return;
        void measure(ring);
        setTool("amend");
        // Deferred: `finish` fires while the click that closed the ring is
        // still being handled.
        setTimeout(() => instanceDraw.selectFeature(id), 0);
      });

      // Dragging a corner or a midpoint changes the prop, so it changes the count.
      instanceDraw.on("change", (ids, type) => {
        if (type !== "update" || instanceDraw.getMode() !== "select") return;
        const id = ids[0];
        if (recountTimer.current) clearTimeout(recountTimer.current);
        recountTimer.current = setTimeout(() => {
          // Read the shape when the recount actually runs, not when it was
          // scheduled: the prop may have been cleared while it waited.
          const ring = ringOf(instanceDraw, id);
          if (!ring) return;
          // Selecting a prop counts as an update, so the same ring can arrive
          // here having already been counted. Counting it twice is a wasted
          // round trip against 424,952 rows.
          if (JSON.stringify(ring) === measuredRing.current) return;
          void measure(ring);
        }, 500);
      });

        draw.current = instanceDraw;
        paintRouteRef.current(true);
        setReady(true);
      } catch (error) {
        setMapError(error instanceof Error ? error.message : "The drawing tools failed to start.");
      }
    });

    return () => {
      if (recountTimer.current) clearTimeout(recountTimer.current);
      draw.current?.stop();
      draw.current = null;
      paintedModel.current = null;
      instance.remove();
      map.current = null;
    };
  }, [measure]);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded() || !instance.getLayer(DOORS_SOURCE)) return;
    paintRouteRef.current(false);
  }, [routeView]);

  const startDrawing = () => {
    request.current += 1;
    measuredRing.current = null;
    if (recountTimer.current) clearTimeout(recountTimer.current);
    draw.current?.clear();
    draw.current?.setMode("polygon");
    setDoors(EMPTY_DOORS);
    setTool("draw");
    setPhase({ kind: "idle" });
    setName("");
    setSaved(null);
    setSaveError(null);
    setSavedTerritory(null);
    setRouteView(null);
    setRouteBusy(null);
    setRouteError(null);
    setRouteNotice(null);
    paintedModel.current = null;
  };

  const amendShape = () => {
    const feature = draw.current?.getSnapshot().find((f) => f.geometry.type === "Polygon");
    if (!feature) return;
    setTool("amend");
    draw.current?.selectFeature(feature.id!);
  };

  const onSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase.kind !== "counted") return;
    const ring = phase.ring;
    setSaveError(null);

    startTransition(async () => {
      const result = await saveProp({ name, ring });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      setSaved(result.name);
      setName("");
      setSavedTerritory({ id: result.id, ringKey: ringKeyOf(ring) });
      setRouteView(null);
      setRouteError(null);
      setRouteNotice(null);
      paintedModel.current = null;
      router.refresh();
    });
  };

  const onGenerate = () => {
    if (phase.kind !== "counted" || !savedTerritory || routeBusy) return;
    const ring = phase.ring;
    const key = ringKeyOf(ring);
    const territoryId = savedTerritory.id;
    setRouteError(null);
    setRouteNotice(null);
    setRouteBusy("generating");

    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (key !== savedTerritory.ringKey) {
        const updated = await updatePropRing({ id: territoryId, ring });
        if (!updated.ok) {
          setRouteError(updated.message);
          setRouteBusy(null);
          return;
        }
        setSavedTerritory({ id: territoryId, ringKey: key });
      }

      const preview = await previewTerritoryRoutes(createClient(), territoryId);
      if (!preview.ok) {
        setRouteError(preview.message);
        setRouteBusy(null);
        return;
      }

      const keys = preview.result.variants.map((variant) => variant.key).sort(compareVariantKeys);
      const latest = phaseRef.current;
      const moved = latest.kind !== "counted" || ringKeyOf(latest.ring) !== key;
      setRouteView({
        keys,
        highlighted: keys[0] ?? "best",
        ringKey: key,
        stale: moved,
        persisted: false,
        model: toRoutePaintModel(walkResultToPaintInput(preview.result)),
        variants: preview.result.variants.map((variant) => ({
          key: variant.key,
          hand: variant.hand,
          totalM: variant.total_m,
          steps: variant.steps.length,
        })),
      });
      setRouteNotice(describeGeometryIssues(preview.issues));
      setRouteBusy(null);
    })();
  };

  const onSaveRoute = () => {
    if (!savedTerritory || !routeView || routeBusy) return;
    if (!routeSaveEnabled({ hasPreview: true, stale: routeView.stale, busy: false })) return;
    const territoryId = savedTerritory.id;
    setRouteError(null);
    setRouteNotice(null);
    setRouteBusy("saving");

    void (async () => {
      // The highlighted variant is not passed. Save writes the whole set.
      const savedRoutes = await saveTerritoryRoutes(createClient(), territoryId);
      if (!savedRoutes.ok) {
        setRouteError(savedRoutes.message);
        setRouteBusy(null);
        return;
      }
      const loaded = await loadTerritoryRouteModel(createClient(), territoryId);
      setRouteView((current) => {
        if (!current) return current;
        return {
          ...current,
          persisted: true,
          model: loaded.ok && loaded.steps > 0 ? loaded.model : current.model,
        };
      });
      const savedLine = `Saved ${savedRoutes.summary.variants.toLocaleString("en-GB")} variants, ${savedRoutes.summary.steps.toLocaleString("en-GB")} steps. ${describeGeometryIssues(savedRoutes.issues)}`;
      setRouteNotice(savedLine);
      if (!loaded.ok) {
        setRouteError(loaded.message);
      }
      setRouteBusy(null);
    })();
  };

  const routeVariants = [...(routeView?.variants ?? [])].sort((a, b) => compareVariantKeys(a.key, b.key));
  const showRouteControls = phase.kind === "counted" || phase.kind === "counting" || routeView !== null;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="order-2 flex w-full flex-col border-ink/15 bg-worksheet lg:order-1 lg:h-full lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-1 flex-col gap-6 p-6 lg:p-7">
          <header>
            <p className="font-data text-[10px] uppercase tracking-[0.22em] text-ink-soft">
              Props · Bristol
            </p>
            <h1 className="mt-2 font-display text-[27px] font-semibold leading-none tracking-[-0.02em] text-ink">
              Draw a prop
            </h1>
          </header>

          <AdminNav current="draw" />

          <div className="grid grid-cols-3 gap-px bg-ink/20">
            <ToolButton active={tool === "draw"} disabled={!ready} onClick={startDrawing}>
              Draw
            </ToolButton>
            <ToolButton
              active={tool === "amend"}
              disabled={!ready || phase.kind === "idle"}
              onClick={amendShape}
            >
              Amend
            </ToolButton>
            <ToolButton active={false} disabled={!ready} onClick={startDrawing}>
              Clear
            </ToolButton>
          </div>

          <div className="border-t border-ink/15 pt-6">
            {phase.kind === "idle" ? (
              <div className="text-[13px] leading-relaxed text-ink-soft">
                <p className="text-ink">
                  Trace the streets one team can cover in a shift, then click the first corner
                  again to close the ring.
                </p>
                <p className="mt-3">
                  Doors are counted the moment the ring closes. Save the prop, then generate a
                  route.
                </p>
              </div>
            ) : null}

            {phase.kind === "counting" ? (
              <p className="font-data text-[11px] uppercase tracking-[0.16em] text-ink-soft">
                Counting doors…
              </p>
            ) : null}

            {phase.kind === "failed" ? (
              <div role="alert">
                <p className="font-data text-[10px] uppercase tracking-[0.2em] text-oxide">
                  Not counted
                </p>
                <p className="mt-2 text-[14px] leading-snug text-ink">{phase.message}</p>
                {phase.detail ? (
                  <p className="mt-2 font-data text-[10px] leading-relaxed text-ink-soft">
                    {phase.detail}
                  </p>
                ) : null}
              </div>
            ) : null}

            {phase.kind === "counted" ? (
              <PropTally count={phase.count} shown={phase.shown} />
            ) : null}
          </div>

          {phase.kind === "counted" ? (
            <form onSubmit={onSave} className="border-t border-ink/15 pt-6">
              <label className="flex flex-col gap-2">
                <span className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                  Prop name
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Bishopston east"
                  required
                  className="min-h-11 border border-ink/25 bg-paper px-3 text-[15px] text-ink placeholder:text-ink-soft/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="mt-3 min-h-11 w-full bg-prop px-4 font-data text-[11px] uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {pending ? "Saving…" : "Save prop"}
              </button>
              {saved ? (
                <p className="mt-3 text-[13px] text-ink" role="status">
                  Saved {saved}. Draw the next one when you are ready.
                </p>
              ) : null}
              {saveError ? (
                <p className="mt-3 text-[13px] text-oxide" role="alert">
                  {saveError}
                </p>
              ) : null}
            </form>
          ) : null}

          {savedProps.length > 0 ? (
            <div className="border-t border-ink/15 pt-6">
              <p className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                Saved props
              </p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {savedProps.map((prop) => (
                  <li key={prop.id} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] text-ink">{prop.name}</span>
                    <Link
                      href={`/admin/allocate?prop=${prop.id}`}
                      className="shrink-0 font-data text-[10px] uppercase tracking-[0.12em] text-prop hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                    >
                      Allocate
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-ink/15 px-6 py-4 lg:px-7">
          <p className="truncate font-data text-[10px] text-ink-soft">{signedInAs}</p>
          <SignOutButton className="min-h-11 border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop" />
        </footer>
      </aside>

      <div className="order-1 flex h-[54dvh] flex-col bg-ink p-3 lg:order-2 lg:h-full lg:flex-1">
        <div className="relative flex-1">
          {/* Sized with h-full rather than inset-0: MapLibre's stylesheet sets
              position: relative on its own container, which would undo an
              absolute one and collapse the map to nothing. */}
          <div ref={container} className="h-full w-full bg-worksheet-deep" />
          {showRouteControls ? (
            <RouteOverlay
              canGenerate={phase.kind === "counted" && savedTerritory !== null && routeBusy === null}
              generateHint={
                phase.kind === "counted" && !savedTerritory
                  ? "Save the prop first, then generate its route."
                  : null
              }
              generating={routeBusy === "generating"}
              saving={routeBusy === "saving"}
              variants={routeVariants}
              highlighted={routeView?.highlighted ?? null}
              stale={routeView?.stale ?? false}
              notice={routeNotice}
              error={routeError}
              canSave={routeSaveEnabled({
                hasPreview: routeView !== null,
                stale: routeView?.stale ?? false,
                busy: routeBusy !== null,
              })}
              onGenerate={onGenerate}
              onHighlight={(key) => {
                setRouteView((current) => (current ? { ...current, highlighted: key } : current));
              }}
              onSave={onSaveRoute}
            />
          ) : null}
          {!ready ? (
            <p className="absolute inset-x-6 top-1/2 text-center font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
              {mapError ?? "Loading the map…"}
            </p>
          ) : null}
          <Registration />
        </div>
        <p className="mt-2 font-data text-[9px] leading-relaxed text-worksheet/70">
          Contains OS data © Crown copyright and database right 2026. Contains public sector
          information licensed under the Open Government Licence v3.0. Contains Energy
          Performance Certificate data © Crown copyright, Ministry of Housing, Communities and
          Local Government. Map data © OpenStreetMap contributors.
        </p>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`min-h-11 font-data text-[11px] uppercase tracking-[0.14em] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
        active ? "bg-prop text-paper" : "bg-worksheet text-ink hover:bg-worksheet-deep"
      }`}
    >
      {children}
    </button>
  );
}

/** Corner marks, so the map reads as a plate pinned to the worksheet. */
function Registration() {
  const corner = "pointer-events-none absolute h-3 w-3 border-worksheet/50";
  return (
    <>
      <span className={`${corner} left-0 top-0 border-l border-t`} />
      <span className={`${corner} right-0 top-0 border-r border-t`} />
      <span className={`${corner} bottom-0 left-0 border-b border-l`} />
      <span className={`${corner} bottom-0 right-0 border-b border-r`} />
    </>
  );
}

/** The outer ring of a Terra Draw polygon, as [lon, lat] pairs. */
function ringOf(instance: TerraDraw, id: string | number | undefined): Ring | null {
  if (id === undefined) return null;
  const feature = instance.getSnapshotFeature(id);
  if (!feature || feature.geometry.type !== "Polygon") return null;
  return feature.geometry.coordinates[0].map(([lon, lat]) => [lon, lat] as [number, number]);
}
