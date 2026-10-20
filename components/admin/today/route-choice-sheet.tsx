"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useAdminMap } from "@/components/admin/map/use-admin-map";
import { Button } from "@/components/admin/ui/button";
import { Sheet } from "@/components/admin/ui/sheet";
import { ChevronDownIcon, WarningIcon } from "@/components/field/icons";
import { routeName, routeSubline, routeTitle, type RouteOption } from "@/lib/geo/walk/route-options";
import type { MapMode } from "@/lib/map/map-palette";
import { applyRouteActive, paintRouteLayers, routeBounds, type RoutePaintModel } from "@/lib/map/route-layers";

/** Rows shown before "N more alternatives". */
const SHOWN = 3;

/**
 * RT-START P1 (owner 2026-10-19; Figma S2, 240:5488). Which saved route ONE
 * visit walks. The map shows the picked route (the others dimmed). The
 * current route and the default are always among the rows on show; the rest
 * sit behind "N more alternatives". A route that no longer fits the visit's
 * doors is listed, greyed, and cannot be picked.
 */
export function RouteChoiceSheet({
  subtitle,
  note,
  options,
  defaultKey,
  currentKey,
  chosenBy,
  model,
  mode,
  busy,
  error,
  onUse,
  onClose,
}: {
  /** "Henleaze · Mon 19 Oct · visit 1". */
  subtitle: string;
  /** "Only this visit changes. Visit 2 goes back to Route B." */
  note: string;
  options: readonly RouteOption[];
  defaultKey: string;
  /** The route the visit has now (or will get). */
  currentKey: string;
  chosenBy?: string | null;
  model: RoutePaintModel | null;
  mode: MapMode;
  busy: boolean;
  error: string | null;
  onUse: (key: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(currentKey);
  const [more, setMore] = useState(false);

  const { shown, hidden } = useMemo(() => {
    const pinned = new Set([currentKey, defaultKey]);
    const first: RouteOption[] = [];
    const rest: RouteOption[] = [];
    for (const option of options) {
      if (first.length < SHOWN || pinned.has(option.key)) first.push(option);
      else rest.push(option);
    }
    return { shown: first, hidden: rest };
  }, [options, currentKey, defaultKey]);

  const pickedOption = options.find((option) => option.key === picked);
  const changed = picked !== currentKey;

  const row = (option: RouteOption) => {
    const on = option.key === picked;
    const sub = option.usable
      ? routeSubline({
          option,
          isDefault: option.key === defaultKey,
          chosenBy: option.key === currentKey ? chosenBy : null,
        })
      : "Doesn't fit this visit's doors";
    return (
      <li key={option.key} role="none">
        <button
          type="button"
          role="radio"
          aria-checked={on}
          disabled={!option.usable || busy}
          onClick={() => setPicked(option.key)}
          className={`flex w-full items-center gap-3 rounded-field-lg border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-45 ${
            on ? "border-prop bg-prop-soft" : "border-line bg-surface"
          }`}
        >
          <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-prop" : "border-ink-faint"}`}>
            {on ? <span className="size-2.5 rounded-full bg-prop" /> : null}
          </span>
          <span className="min-w-0">
            <span className="block text-admin-body-strong tabular-nums">{routeTitle(option)}</span>
            <span className="block truncate text-admin-subhead text-ink-muted">{sub}</span>
          </span>
        </button>
      </li>
    );
  };

  const footer = (
    <div>
      {error ? (
        <p role="alert" className="mb-3 flex gap-2 text-admin-subhead text-oxide">
          <WarningIcon className="size-5 shrink-0" />
          {error}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={busy || !pickedOption?.usable}
        onClick={() => (changed ? onUse(picked) : onClose())}
      >
        {busy ? "Changing the route…" : changed ? `Use ${routeName(picked)} for this visit` : `Keep ${routeName(picked)}`}
      </Button>
    </div>
  );

  return (
    <Sheet open title="Route for this visit" subtitle={subtitle} onClose={onClose} footer={footer}>
      <div className="flex flex-col gap-3">
        {model && model.steps.length > 0 ? <RouteChoiceMap model={model} activeKey={picked} mode={mode} /> : null}
        <p className="text-admin-subhead text-ink-muted">{note}</p>
        <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Which route this visit walks">
          {shown.map(row)}
          {more ? hidden.map(row) : null}
        </ul>
        {hidden.length > 0 && !more ? (
          <button
            type="button"
            aria-expanded={false}
            onClick={() => setMore(true)}
            className="flex min-h-11 w-full items-center justify-between px-1 text-admin-body text-ink-soft focus-visible:outline-2 focus-visible:outline-prop"
          >
            {hidden.length === 1 ? "1 more alternative" : `${hidden.length} more alternatives`}
            <ChevronDownIcon className="size-5" />
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

/** A still map of the prop's saved routes with the picked one highlighted. */
function RouteChoiceMap({ model, activeKey, mode }: { model: RoutePaintModel; activeKey: string; mode: MapMode }) {
  const container = useRef<HTMLDivElement | null>(null);
  const { map, error } = useAdminMap(container, mode, "d2d.admin.route-choice-map", { interactive: false });
  const active = useRef(activeKey);
  active.current = activeKey;

  useEffect(() => {
    if (!map) return;
    paintRouteLayers(map, model, active.current, undefined, null, mode);
    const box = routeBounds(model);
    if (box) map.fitBounds(box, { padding: 16, maxZoom: 17, duration: 0 });
  }, [map, model, mode]);

  useEffect(() => {
    if (map) applyRouteActive(map, model, activeKey);
  }, [map, model, activeKey]);

  return (
    <div className="relative h-40 shrink-0 overflow-hidden rounded-field-lg bg-field-bg">
      <div ref={container} className="h-full w-full" role="img" aria-label={`Map of ${routeName(activeKey)}`} />
      {!map ? (
        <p className="absolute inset-0 flex items-center justify-center text-admin-caption text-ink-muted">
          {error ?? "Loading the map…"}
        </p>
      ) : null}
    </div>
  );
}
