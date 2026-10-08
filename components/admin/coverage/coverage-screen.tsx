"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { GeoJSONSource, MapMouseEvent, PaddingOptions } from "maplibre-gl";

import { FilterPicker, PeriodPicker, type PickerOption } from "@/components/admin/coverage/filter-picker";
import { MapSheet } from "@/components/admin/map/map-sheet";
import { useAdminMap } from "@/components/admin/map/use-admin-map";
import { useIsDesktop } from "@/components/admin/map/use-is-desktop";
import {
  DOORS_LAYER,
  applyLayerVisibility,
  ensurePropLayers,
  setOutcomeDoors,
  setProps,
  setSelectedProp,
} from "@/components/admin/props/prop-layers";
import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { IconButton } from "@/components/admin/ui/icon-button";
import { ChevronDownIcon, ChevronLeftIcon, CloseIcon, FitIcon, MinusIcon, PlusIcon } from "@/components/field/icons";
import { calendarHref, monthOf } from "@/lib/admin/calendar";
import type { CoverageDoorCollection, CoverageProp } from "@/lib/admin/coverage";
import type { CoveragePerson } from "@/lib/admin/coverage-data";
import {
  clearedFilters,
  coverageFigures,
  doorMeta,
  filterCountLine,
  filtersHref,
  knockWhen,
  matchedLabel,
  outcomeChip,
  outcomeWords,
  paintedOf,
  periodIsFilter,
  periodLabel,
  scopeLine,
  slotChip,
  visitChip,
  whoChip,
  withoutProp,
  OUTCOME_FILTERS,
  type CoverageFilters,
  type CoverageVisit,
  type OutcomeFilter,
  type PaintedDoor,
} from "@/lib/admin/coverage-filters";
import { boxOf, type LngLatBox } from "@/lib/admin/map-fit";
import type { Detent } from "@/lib/admin/sheet-detents";
import { mapColours } from "@/lib/map/map-palette";
import { useResolvedTheme } from "@/lib/field/theme";

const VIEW_KEY = "d2d.admin.coverage-view";
const PICK_SOURCE = "admin-coverage-pick";
const PICK_LAYER = "admin-coverage-pick";
/** A finger is not a mouse: a tap this close to a dot picks it. */
const TAP_SLOP = 12;

type Picker = "period" | "visit" | "slot" | "outcome" | "who" | null;

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

const LEGEND: ReadonlyArray<{ key: OutcomeFilter | "none"; label: string; className: string }> = [
  { key: "contact", label: "Contact", className: "bg-outcome-contact" },
  { key: "lead", label: "Lead", className: "bg-outcome-lead" },
  { key: "rented", label: "Rented / council", className: "bg-outcome-rented-edge" },
  { key: "notin", label: "Not in", className: "bg-outcome-notin" },
  { key: "other", label: "Other", className: "bg-ink-soft" },
  { key: "none", label: "Not knocked", className: "border border-ink-faint bg-surface" },
];

const GROUP_DOT: Record<OutcomeFilter, string> = {
  contact: "bg-outcome-contact",
  lead: "bg-outcome-lead",
  rented: "bg-outcome-rented-edge",
  notin: "bg-outcome-notin",
  other: "bg-ink-soft",
};

/** A filter chip: dark when it narrows the map; opens its sheet. */
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={`inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-4 text-admin-pill shadow-admin-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
        active ? "bg-ink text-paper" : "border border-line bg-surface text-ink"
      }`}
    >
      {label}
      <ChevronDownIcon className="size-4" />
    </button>
  );
}

/**
 * UI-10 F4d (owner A32, A33, A44; frames 22, 38). Coverage rebuilt: one
 * full-screen map, filter chips (days, visit, slot, outcome, person, and
 * the prop when one is picked), and a sheet with the figures and legend.
 * Tapping a dot shows that door's latest knock within the filters (label,
 * outcome, when, visit; no names, no lead details). The URL is the state,
 * so Calendar's "Open on map" and Back both land exactly (A44). Coverage is
 * derived from knocks every time; nothing is stored.
 */
export function CoverageScreen({
  today,
  filters,
  doors,
  props,
  visits,
  worked,
  people,
  missingProp,
}: {
  today: string;
  filters: CoverageFilters;
  doors: CoverageDoorCollection;
  props: CoverageProp[];
  visits: CoverageVisit[];
  /** The knock that paints each door within the filters (before the outcome filter), resolved on the server. */
  worked: PaintedDoor[];
  people: CoveragePerson[];
  /** `?prop=` is a prop that is not live (archived). */
  missingProp: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const mode = useResolvedTheme();
  const desktop = useIsDesktop();
  const root = useRef<HTMLDivElement | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const { map, error: mapError } = useAdminMap(container, mode, VIEW_KEY);
  const [pending, startTransition] = useTransition();
  const [picker, setPicker] = useState<Picker>(null);
  const [detent, setDetent] = useState<Detent>("peek");
  const [available, setAvailable] = useState(720);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [doorId, setDoorId] = useState<number | null>(null);

  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name] as const)), [people]);
  const visitById = useMemo(() => new Map(visits.map((visit) => [visit.id, visit] as const)), [visits]);
  const prop = props.find((item) => item.id === filters.prop) ?? null;
  const resolved = useMemo(() => {
    const byDoor = new Map(worked.map((door) => [door.uprn, door] as const));
    return { worked: byDoor, painted: paintedOf(byDoor, filters.outcome) };
  }, [worked, filters.outcome]);
  const scopeDoors = useMemo(
    () => doors.features.filter((door) => !filters.prop || door.properties.territory_id === filters.prop).map((door) => door.properties.uprn),
    [doors, filters.prop],
  );
  const figures = coverageFigures(scopeDoors, resolved, filters);
  const scope = scopeLine(filters, resolved.painted, names, scopeDoors);
  const countLine = filterCountLine(filters, today);
  const propName = prop?.name ?? missingProp?.name ?? null;
  const door = doorId === null ? null : (doors.features.find((feature) => feature.properties.uprn === doorId) ?? null);
  const doorKnock = doorId === null ? null : (resolved.worked.get(doorId) ?? null);

  const go = useCallback(
    (next: CoverageFilters) => {
      setPicker(null);
      setDoorId(null);
      startTransition(() => router.push(filtersHref(next, today)));
    },
    [router, today],
  );

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(Math.round(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const padding = useCallback(
    (): PaddingOptions => (desktop ? { top: 96, right: 72, bottom: 48, left: 400 } : { top: 128, right: 32, bottom: sheetHeight + 24, left: 32 }),
    [desktop, sheetHeight],
  );
  const fitBox = useCallback(
    (box: LngLatBox | null) => {
      if (map && box) map.fitBounds(box, { padding: padding(), maxZoom: 17, duration: 400 });
    },
    [map, padding],
  );

  // Layers, and a tap on a dot (with a finger's slop) opens that door.
  useEffect(() => {
    if (!map) return;
    ensurePropLayers(map, mode);
    applyLayerVisibility(map, { outlines: true, outcomes: true, leads: false, routes: false, nccz: false }, false);
    if (!map.getSource(PICK_SOURCE)) {
      const c = mapColours(mode);
      map.addSource(PICK_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: PICK_LAYER,
        type: "circle",
        source: PICK_SOURCE,
        paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": c.focus.line, "circle-stroke-width": 2.5 },
      });
    }
    const onClick = (event: MapMouseEvent) => {
      const { x, y } = event.point;
      const hits = map.queryRenderedFeatures(
        [
          [x - TAP_SLOP, y - TAP_SLOP],
          [x + TAP_SLOP, y + TAP_SLOP],
        ],
        { layers: [DOORS_LAYER] },
      );
      let best: { uprn: number; d: number } | null = null;
      for (const hit of hits) {
        const uprn = Number(hit.properties?.uprn);
        if (!Number.isFinite(uprn) || hit.geometry.type !== "Point") continue;
        const p = map.project(hit.geometry.coordinates as [number, number]);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (!best || d < best.d) best = { uprn, d };
      }
      if (best) {
        setDoorId(best.uprn);
        setDetent((current) => (current === "peek" ? "half" : current));
      } else setDoorId(null);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, mode]);

  useEffect(() => {
    if (!map) return;
    setProps(
      map,
      props.map((item) => ({ id: item.id, name: item.name, archived: false, geometry: item.geometry })),
    );
    setSelectedProp(map, filters.prop);
  }, [map, props, filters.prop]);

  useEffect(() => {
    if (!map) return;
    setOutcomeDoors(
      map,
      doors,
      [...resolved.painted.values()].map((row) => ({ uprn: row.uprn, outcome: row.outcome })),
    );
  }, [map, doors, resolved]);

  useEffect(() => {
    const source = map?.getSource(PICK_SOURCE) as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: door ? [{ type: "Feature", geometry: door.geometry, properties: {} }] : [] });
  }, [map, door]);

  // Frame the picked prop (or every prop) once per prop, never on a filter change within it.
  const framedFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!map || framedFor.current === filters.prop) return;
    const first = framedFor.current === undefined;
    framedFor.current = filters.prop;
    if (prop) {
      fitBox(boxOf([prop.geometry]));
      return;
    }
    let remembered = false;
    try {
      remembered = sessionStorage.getItem(VIEW_KEY) !== null;
    } catch {
      remembered = false;
    }
    if (!first || !remembered) fitBox(boxOf(props.map((item) => item.geometry)));
  }, [map, prop, props, filters.prop, fitBox]);

  // A door that is no longer on the map closes its popup.
  useEffect(() => {
    if (doorId !== null && !doors.features.some((feature) => feature.properties.uprn === doorId)) setDoorId(null);
  }, [doors, doorId]);

  const zoom = (by: 1 | -1) => {
    if (!map) return;
    if (by > 0) map.zoomIn();
    else map.zoomOut();
  };

  // ---- the filter sheets -----------------------------------------------------

  const visitNumbers = [...new Set(visits.filter((visit) => !filters.prop || visit.propId === filters.prop).map((visit) => visit.visitNumber))].sort((a, b) => a - b);
  const options: Record<Exclude<Picker, "period" | null>, { title: string; list: PickerOption[] }> = {
    visit: {
      title: "Visit",
      list: [
        { key: "all", label: "All visits", selected: filters.visit === null, apply: (f) => ({ ...f, visit: null }) },
        ...visitNumbers.map((number) => ({
          key: String(number),
          label: `Visit ${number}`,
          selected: filters.visit === number,
          apply: (f: CoverageFilters) => ({ ...f, visit: number }),
        })),
      ],
    },
    slot: {
      title: "Slot",
      list: [
        { key: "all", label: "All slots", selected: filters.slot === null, apply: (f) => ({ ...f, slot: null }) },
        ...(["early", "mid", "late"] as const).map((slot) => ({
          key: slot,
          label: slotChip(slot),
          selected: filters.slot === slot,
          apply: (f: CoverageFilters) => ({ ...f, slot }),
        })),
      ],
    },
    outcome: {
      title: "Outcome",
      list: [
        { key: "all", label: "All outcomes", selected: filters.outcome === null, apply: (f) => ({ ...f, outcome: null }) },
        ...OUTCOME_FILTERS.map((option) => ({
          key: option.value,
          label: option.label,
          selected: filters.outcome === option.value,
          apply: (f: CoverageFilters) => ({ ...f, outcome: option.value }),
        })),
      ],
    },
    who: {
      title: "Person",
      list: [
        { key: "all", label: "Everyone", selected: filters.who === null, apply: (f) => ({ ...f, who: null }) },
        ...people.map((person) => ({
          key: person.id,
          label: person.name,
          selected: filters.who === person.id,
          apply: (f: CoverageFilters) => ({ ...f, who: person.id }),
        })),
      ],
    },
  };

  // Back to the day you came from; once the days have changed there is no one day, so the month view.
  const back =
    filters.via !== "calendar"
      ? null
      : filters.from && filters.from === filters.to
        ? calendarHref(monthOf(filters.from), filters.from)
        : "/admin/calendar";

  // ---- render ----------------------------------------------------------------

  const sheetHeader = (
    <div className="px-5 pt-1 pb-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-admin-headline">{propName ?? "Coverage"}</h2>
          {scope ? <p className="truncate text-admin-subhead text-ink-muted tabular-nums">{scope}</p> : null}
          {missingProp ? (
            <p className="text-admin-subhead text-ink-muted">This prop is archived, so its doors are not on the map.</p>
          ) : null}
        </div>
        {pending ? (
          <span role="status" className="shrink-0 pt-0.5 text-admin-caption text-ink-muted">
            Updating…
          </span>
        ) : null}
      </div>
      <dl className={`mt-2 grid gap-2 ${filters.outcome ? "grid-cols-3" : "grid-cols-4"}`}>
        {(filters.outcome
          ? [
              { label: "Worked", value: figures.worked },
              { label: matchedLabel(filters), value: figures.matched ?? 0 },
              { label: "Not knocked", value: figures.notKnocked },
            ]
          : [
              { label: "Worked", value: figures.worked },
              { label: "Contacts", value: figures.contacts },
              { label: "Leads", value: figures.leads },
              { label: "Not knocked", value: figures.notKnocked },
            ]
        ).map((figure) => (
          <div key={figure.label} className="flex min-w-0 flex-col-reverse">
            <dt className="truncate text-admin-caption text-ink-muted">{figure.label}</dt>
            <dd className="text-admin-headline tabular-nums">{n(figure.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div ref={root} className="relative h-full w-full overflow-hidden bg-field-bg">
      <div ref={container} className="admin-map admin-map-chips h-full w-full" data-testid="coverage-map" />
      {!map ? (
        <p className="absolute inset-x-6 top-1/3 text-center text-admin-subhead text-ink-muted" role="status">
          {mapError ?? "Loading the map…"}
        </p>
      ) : null}

      <div className="absolute inset-x-0 top-0 z-10 flex flex-col gap-2 pt-3 lg:left-[384px]">
        <div className="flex items-center gap-2 px-3">
          {back ? (
            <Link
              href={back}
              className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-line bg-surface pr-4 pl-2 text-admin-body-strong text-prop shadow-admin-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
            >
              <ChevronLeftIcon className="size-5" />
              Calendar
            </Link>
          ) : (
            <AdminMenuButton floating />
          )}
          <div className="flex h-11 min-w-0 items-center gap-3 rounded-full border border-line bg-surface pr-1.5 pl-4 shadow-admin-float">
            <h1 className="text-admin-headline">Coverage</h1>
            {countLine ? <span className="truncate text-admin-subhead text-ink-muted">{countLine}</span> : null}
            {countLine ? (
              <button
                type="button"
                onClick={() => go(clearedFilters(filters, today))}
                className="inline-flex min-h-11 shrink-0 items-center px-2.5 text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
          {propName ? (
            <button
              type="button"
              onClick={() => go(withoutProp(filters, today))}
              aria-label={`Remove the ${propName} filter`}
              className="inline-flex h-11 max-w-56 shrink-0 items-center gap-1.5 rounded-full bg-ink pr-3 pl-4 text-admin-pill text-paper shadow-admin-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
            >
              <span className="truncate">{propName}</span>
              <CloseIcon className="size-4 shrink-0" />
            </button>
          ) : null}
          <Chip label={periodLabel(filters, today)} active={periodIsFilter(filters, today)} onClick={() => setPicker("period")} />
          <Chip label={visitChip(filters.visit)} active={filters.visit !== null} onClick={() => setPicker("visit")} />
          <Chip label={slotChip(filters.slot)} active={filters.slot !== null} onClick={() => setPicker("slot")} />
          <Chip label={outcomeChip(filters.outcome)} active={filters.outcome !== null} onClick={() => setPicker("outcome")} />
          <Chip label={whoChip(filters.who, names)} active={filters.who !== null} onClick={() => setPicker("who")} />
        </div>
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
          label={prop ? `Show ${prop.name}` : "Show all props"}
          onClick={() => fitBox(boxOf(prop ? [prop.geometry] : props.map((item) => item.geometry)))}
        >
          <FitIcon className="size-6" />
        </IconButton>
      </div>

      <MapSheet label="Coverage" detent={detent} onDetent={setDetent} available={available} onHeight={setSheetHeight} header={sheetHeader}>
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {door ? (
            <section aria-label="Door" className="mb-4 rounded-field-lg bg-field-bg p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-admin-headline">{door.properties.label ?? "Door"}</h3>
                  <p className="text-admin-subhead text-ink-muted">
                    {doorKnock ? doorMeta(visitById.get(doorKnock.assignmentId)?.visitNumber ?? null, door.properties.territory_name) : door.properties.territory_name}
                  </p>
                </div>
                <IconButton label="Close door" onClick={() => setDoorId(null)} className="-mt-2 -mr-2">
                  <CloseIcon className="size-5" />
                </IconButton>
              </div>
              {doorKnock ? (
                <p className="mt-2 flex items-center gap-2 text-admin-body">
                  <span aria-hidden className={`size-2.5 rounded-full ${GROUP_DOT[doorKnock.group]}`} />
                  <span className="flex-1">{outcomeWords(doorKnock.outcome)}</span>
                  <span className="text-admin-subhead text-ink-muted tabular-nums">{knockWhen(doorKnock.occurredAt)}</span>
                </p>
              ) : (
                <p className="mt-2 text-admin-body text-ink-muted">Not knocked for these filters.</p>
              )}
            </section>
          ) : null}
          <ul aria-label="Key" className="flex flex-wrap gap-x-4 gap-y-1.5 text-admin-caption text-ink-soft">
            {LEGEND.map((item) => (
              <li key={item.key} className="flex items-center gap-1.5">
                <span aria-hidden className={`size-2.5 rounded-full ${item.className}`} />
                {item.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-admin-caption text-ink-muted">
            Each door shows its latest knock for these filters. Tap a dot to see it.
          </p>
        </div>
      </MapSheet>

      {picker === "period" ? (
        <PeriodPicker filters={filters} today={today} onClose={() => setPicker(null)} onApply={go} />
      ) : picker ? (
        <FilterPicker title={options[picker].title} options={options[picker].list} filters={filters} onClose={() => setPicker(null)} onApply={go} />
      ) : null}
    </div>
  );
}

/** Coverage could not be read. `narrower` offers fewer days when there were too many knocks. */
export function CoverageFailed({ message, narrower }: { message: string; narrower: string | null }) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 lg:px-10 lg:pt-8">
      <div className="-ml-1.5 lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">Coverage</h1>
      <div role="alert" className="mt-6 rounded-field-lg bg-surface p-5">
        <p className="text-admin-body">{message}</p>
        {narrower ? (
          <Link
            href={narrower}
            className="mt-3 inline-flex min-h-11 items-center text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
          >
            Show the last 7 days
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-3 inline-flex min-h-11 items-center text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
          >
            Try again
          </button>
        )}
      </div>
    </main>
  );
}
