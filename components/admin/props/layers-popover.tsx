"use client";

import { useEffect, useRef } from "react";

import { Toggle } from "@/components/admin/ui/toggle";
import type { MapLayers } from "@/components/admin/props/prop-layers";
import { mapColours, type MapMode } from "@/lib/map/map-palette";

type Row = { key: keyof MapLayers; label: string; help?: string };

const ROWS: Row[] = [
  { key: "outlines", label: "Prop outlines" },
  { key: "outcomes", label: "Latest outcomes", help: "Light dots on knocked doors" },
  { key: "leads", label: "Leads, pitches and sales", help: "Status from the office" },
  { key: "routes", label: "Routes", help: "Selected prop only" },
  { key: "nccz", label: "No Cold Calling zones", help: "Doors inside are never counted" },
];

/**
 * UI-10 F2b (owner A22; frame 07). Map layers, opened from the top-right
 * button. Outcome colours never carry meaning alone: the lead pins have a
 * legend in words. Closes on Escape or a press outside.
 */
export function LayersPopover({
  open,
  layers,
  onChange,
  onClose,
  mode,
}: {
  open: boolean;
  layers: MapLayers;
  onChange: (next: MapLayers) => void;
  onClose: () => void;
  mode: MapMode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Held in a ref so a parent re-render never re-runs the effect (and moves focus).
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onClose = () => close.current();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape closes only this panel, never the drawing behind it.
      event.stopPropagation();
      onClose();
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panel.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-layers-button]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    panel.current?.querySelector<HTMLElement>("[role=switch]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  if (!open) return null;
  const dot = mapColours(mode).dot;
  const legend = [
    { label: "Lead", style: { background: "transparent", boxShadow: `inset 0 0 0 2px ${dot.lead}` } },
    { label: "Pitched", style: { background: dot.other } },
    { label: "Sale", style: { background: dot.lead } },
    { label: "Closed", style: { background: mode === "dark" ? "#5b6470" : "#a5abb3" } },
  ];

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Map layers"
      className="absolute top-16 right-3 z-30 w-[min(20rem,calc(100%-1.5rem))] rounded-field-lg border border-line bg-surface p-4 pb-2 text-ink shadow-admin-float motion-safe:animate-admin-fade-in"
    >
      <h2 className="text-admin-headline">Map layers</h2>
      <ul className="mt-1">
        {ROWS.map((row) => (
          <li key={row.key} className="py-1.5">
            <label className="flex min-h-11 items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-admin-body">{row.label}</span>
                {row.help ? <span className="block text-admin-caption text-ink-muted">{row.help}</span> : null}
              </span>
              <Toggle
                checked={layers[row.key]}
                label={row.label}
                onChange={(next) => onChange({ ...layers, [row.key]: next })}
              />
            </label>
            {row.key === "leads" ? (
              <ul aria-label="Lead pins" className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {legend.map((item) => (
                  <li key={item.label} className="flex items-center gap-1.5 text-admin-caption text-ink-soft">
                    <span aria-hidden className="size-2.5 rounded-full" style={item.style} />
                    {item.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
