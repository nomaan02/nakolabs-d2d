"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronDownIcon, CloseIcon } from "@/components/field/icons";
import {
  crmLeadLine,
  crmLeadPoints,
  doorLine,
  MAP_LAYER_WINDOWS,
  parseMapLayerWindow,
  statusTone,
  TONE_LABEL,
  TONE_ORDER,
  TONE_SQUARE,
  toneCounts,
  type MapLayerWindow,
  type MyCrmLead,
} from "@/lib/field/crm";
import { fetchMyLeads, useCrmMe, useLoad } from "@/lib/field/crm-data";

const LAYER_KEY = "d2d.map.crmLayer";

/**
 * CRM-5 C2, Figma F5 (186:7928). "My CRM leads" on the Map tab: the
 * canvasser's OWN CRM leads from the last 7 / 30 / 90 days as coloured rings.
 * OFF by default (owner 2026-10-12) and remembered on this phone. The only
 * previous-visit outcome colour allowed on the field map (AGENTS.md P4b).
 */
export function useCrmMapLayer(canvasserId: string | null) {
  const me = useCrmMe(canvasserId);
  const linked = me.kind === "ready" && me.data.name !== null;
  const [days, setDaysState] = useState<MapLayerWindow>(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDaysState(parseMapLayerWindow(window.localStorage.getItem(LAYER_KEY)));
    } catch {
      // Private mode: the layer starts off.
    }
  }, []);

  const setDays = (next: MapLayerWindow) => {
    setDaysState(next);
    setSelected(null);
    try {
      window.localStorage.setItem(LAYER_KEY, String(next));
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };

  const on = linked && days > 0;
  const load = useLoad(on ? `crm-map:${days}` : null, () => {
    const to = new Date();
    return fetchMyLeads(new Date(to.getTime() - days * 86_400_000).toISOString(), new Date(to.getTime() + 60_000).toISOString());
  });
  const leads = on && load.kind === "ready" ? load.data : null;
  const points = useMemo(() => (leads ? crmLeadPoints(leads) : null), [leads]);
  const lead = leads && selected ? (leads.find((l) => l.crm_id === selected) ?? null) : null;

  return { linked, days, setDays, on, state: load.kind, leads, points, selected: lead ? selected : null, select: setSelected, lead };
}

/** The dark pill, top of the map. A menu: Off / 7 / 30 / 90 days. */
export function CrmLayerPill({ days, onChange, className = "" }: { days: MapLayerWindow; onChange: (d: MapLayerWindow) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className={`absolute z-[3] ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="crm-layer-pill"
        className={`flex min-h-tap-min items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-field-knob focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
          days > 0 ? "bg-ink text-field-bg" : "border border-line bg-surface text-ink"
        }`}
      >
        <span aria-hidden className={`size-3 rounded-sm border-2 ${days > 0 ? "border-field-bg" : "border-ink-muted"}`} />
        {days > 0 ? `My CRM leads · ${days} days` : "My CRM leads"}
        <ChevronDownIcon className="size-4" />
      </button>
      {open ? (
        <ul role="menu" className="mt-2 w-56 overflow-hidden rounded-field-md border border-line bg-surface shadow-lg">
          {MAP_LAYER_WINDOWS.map((d) => (
            <li key={d}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={d === days}
                onClick={() => {
                  onChange(d);
                  setOpen(false);
                }}
                className={`flex min-h-tap-min w-full items-center px-4 text-left text-sm ${d === days ? "font-semibold text-prop" : "text-ink"}`}
              >
                {d === 0 ? "Off" : `Last ${d} days`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The bottom card: the tapped lead, or (nothing tapped) the key with counts. */
export function CrmLeadCard({
  lead,
  leads,
  state,
  onClose,
}: {
  lead: MyCrmLead | null;
  leads: readonly MyCrmLead[] | null;
  state: string;
  onClose: () => void;
}) {
  const counts = leads ? toneCounts(leads) : null;
  const placed = leads ? leads.filter((l) => l.lon !== null).length : 0;
  return (
    <section className="z-10 border-t border-line bg-surface px-4 pb-3 pt-3" data-testid="crm-lead-card" aria-label="My CRM leads">
      {lead ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-field-title-sm text-ink">{doorLine(lead)}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-field-body text-ink">
              <span aria-hidden className={`size-2.5 shrink-0 rounded-sm border-2 ${TONE_SQUARE[statusTone(lead.status)]}`} />
              {crmLeadLine(lead)}
            </p>
            {lead.callback_reason ? (
              <Link
                href="/field/leads"
                onClick={() => {
                  try {
                    window.localStorage.setItem("d2d.leads.view", "callbacks");
                  } catch {
                    // Private mode: Leads opens on its last view.
                  }
                }}
                className="mt-1 inline-flex min-h-tap-min items-center text-field-body-strong text-prop"
              >
                On your call-back list
              </Link>
            ) : null}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-tap-min shrink-0 items-center justify-center rounded-full border border-line text-ink-muted">
            <CloseIcon className="size-5" />
          </button>
        </div>
      ) : null}
      {counts ? (
        <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-field-body text-ink ${lead ? "mt-2 border-t border-line pt-2" : ""}`}>
          {TONE_ORDER.filter((t) => counts[t] > 0).map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-sm border-2 ${TONE_SQUARE[t]}`} />
              {TONE_LABEL[t]} {counts[t]}
            </li>
          ))}
          {leads && placed < leads.length ? <li className="text-ink-muted">{leads.length - placed} not on the map</li> : null}
          {leads && leads.length === 0 ? <li className="text-ink-muted">No CRM leads in this window.</li> : null}
        </ul>
      ) : (
        <p className="text-field-body text-ink-muted">
          {state === "offline" ? "No signal. Your CRM leads load when you’re back online." : state === "error" ? "Your CRM leads didn’t load." : "Loading your CRM leads…"}
        </p>
      )}
    </section>
  );
}
