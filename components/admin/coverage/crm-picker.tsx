"use client";

import type { ReactNode } from "react";

import { CRM_RING, HEAT_RAMP } from "@/components/admin/map/crm-layers";
import { Sheet } from "@/components/admin/ui/sheet";
import { CheckIcon } from "@/components/field/icons";
import { CRM_DOOR_FILTERS, type CrmDoorFilter, type CrmView } from "@/lib/admin/crm-map";
import type { MapMode } from "@/lib/map/map-palette";

/** A door mark as it looks on the map: a rounded-square outline. */
export function CrmMark({ colour, className = "size-3" }: { colour: string; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-[30%] border-2 ${className}`} style={{ borderColor: colour }} />;
}

function Ramp({ mode }: { mode: MapMode }) {
  return (
    <span aria-hidden className="flex gap-0.5">
      {HEAT_RAMP[mode].steps.map((colour) => (
        <span key={colour} className="h-3.5 w-1.5 rounded-xs" style={{ background: colour }} />
      ))}
    </span>
  );
}

/**
 * CRM-2 D (owner 2026-10-10; Figma CRM-2 C3 approved). The Coverage "CRM"
 * chip's sheet: off, a heat map (sale rate or number of leads), or CRM doors
 * by latest outcome, with each choice's door count once the doors are read.
 * The CRM layer covers all CRM history; the other chips filter knocks only.
 */
export function CrmPicker({
  view,
  mode,
  tally,
  onClose,
  onPick,
}: {
  view: CrmView;
  mode: MapMode;
  tally: Record<CrmDoorFilter, number> | null;
  onClose: () => void;
  onPick: (next: CrmView) => void;
}) {
  const row = (value: CrmView, label: string, lead: ReactNode, sub?: string) => (
    <li key={value} className="border-b border-line last:border-b-0">
      <button
        type="button"
        role="radio"
        aria-checked={value === view}
        onClick={() => onPick(value)}
        className="flex min-h-12 w-full items-center gap-3 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
      >
        <span className="flex w-8 shrink-0 justify-center">{lead}</span>
        <span className="min-w-0 flex-1">
          <span className={`block ${value === view ? "text-admin-body-strong" : "text-admin-body"}`}>{label}</span>
          {sub ? <span className="block text-admin-caption text-ink-muted tabular-nums">{sub}</span> : null}
        </span>
        {value === view ? <CheckIcon className="size-5 text-prop" /> : null}
      </button>
    </li>
  );
  const doors = (n: number | undefined) => (n === undefined ? undefined : `${n.toLocaleString("en-GB")} ${n === 1 ? "door" : "doors"}`);

  return (
    <Sheet open title="CRM layer" subtitle="All CRM history, admin only. Knock filters still apply to the dots." onClose={onClose}>
      <div role="radiogroup" aria-label="CRM layer" className="px-5 pb-4">
        <ul>{row("off", "Off", null)}</ul>
        <h3 className="pt-4 pb-1 text-admin-section text-ink-muted">Heat map, 250 m squares</h3>
        <ul>
          {row("heat-rate", "Sale rate", <Ramp mode={mode} />, "Sold ÷ leads")}
          {row("heat-leads", "Number of leads", <Ramp mode={mode} />)}
        </ul>
        <h3 className="pt-4 pb-1 text-admin-section text-ink-muted">Doors, by latest CRM outcome</h3>
        <ul>
          {CRM_DOOR_FILTERS.map((f) =>
            row(
              `doors-${f.value}` as CrmView,
              f.label,
              f.value === "all" ? null : <CrmMark colour={CRM_RING[mode][f.value]} />,
              doors(tally?.[f.value]),
            ),
          )}
        </ul>
      </div>
    </Sheet>
  );
}
