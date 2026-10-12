"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CallResultSheet } from "@/components/field/crm/call-result-sheet";
import { Segmented } from "@/components/field/crm/segmented";
import { CheckIcon, PhoneIcon } from "@/components/field/icons";
import {
  CALLBACK_WINDOWS,
  callbackLine,
  contactName,
  doorLine,
  parseCallbackWindow,
  sectionCallbacks,
  statusTone,
  TONE_SQUARE,
  type CallbackRow,
  type CallbackWindow,
} from "@/lib/field/crm";
import { fetchCallbacks, logCallResult, useLoad, useLocalCalls } from "@/lib/field/crm-data";
import type { CallResult } from "@/lib/sync/ops";

const WINDOW_KEY = "d2d.crm.callbackWindow";

function readWindow(): CallbackWindow {
  try {
    return parseCallbackWindow(window.localStorage.getItem(WINDOW_KEY));
  } catch {
    return parseCallbackWindow(null);
  }
}

/**
 * CRM-5 C, Figma F1 (184:305) / F7 dark (186:8104). The canvasser's own
 * call-back list: To call, Done today, Later. Phone button rings the
 * customer; the tick opens the result sheet. Results queue offline.
 */
export function CallbacksPane({ canvasserId, linked, onCount }: { canvasserId: string; linked: boolean; onCount: (n: number | null) => void }) {
  const [days, setDays] = useState<CallbackWindow>(30);
  const [open, setOpen] = useState<CallbackRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setDays(readWindow()), []);

  const load = useLoad(linked ? `callbacks:${days}` : null, () => fetchCallbacks(days));
  const local = useLocalCalls(canvasserId);
  const sections = useMemo(
    () => (load.kind === "ready" ? sectionCallbacks(load.data, local, new Date()) : null),
    [load, local],
  );

  useEffect(() => onCount(sections ? sections.toCall.length : null), [sections, onCount]);

  const choose = (next: CallbackWindow) => {
    setDays(next);
    try {
      window.localStorage.setItem(WINDOW_KEY, String(next));
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };

  const close = useCallback(() => setOpen(null), []);

  const log = async (result: CallResult, callBackOn: string | null) => {
    const row = open;
    setOpen(null);
    if (!row) return;
    try {
      await logCallResult({ canvasserId, crmId: row.crm_id, result, callBackOn });
      setNotice(null);
    } catch {
      setNotice("That didn't save on this phone. Try again.");
    }
  };

  if (!linked) {
    return (
      <p className="px-4 pt-6 text-field-body text-ink-muted" data-testid="callbacks-not-linked">
        Your account isn&apos;t linked to the CRM yet. Ask your admin to add your CRM name.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8" data-testid="callbacks-pane">
      <div className="mt-3 flex items-center justify-between gap-3">
        <Segmented
          label="Leads booked in the last"
          size="sm"
          value={days}
          onChange={choose}
          options={CALLBACK_WINDOWS.map((d) => ({ value: d, label: `${d} days` }))}
          testId="callbacks-window"
        />
        {sections ? (
          <span className="text-field-body text-ink-muted tabular-nums">{sections.toCall.length} to call</span>
        ) : null}
      </div>

      {notice ? (
        <p role="alert" className="mt-3 rounded-field-md bg-error-bg px-3 py-2 text-field-body text-ink">
          {notice}
        </p>
      ) : null}

      {load.kind === "loading" ? <p className="mt-6 text-field-body text-ink-muted">Loading your call-backs…</p> : null}
      {load.kind === "offline" ? (
        <p className="mt-6 text-field-body text-ink-muted">No signal. Your call-backs load when you&apos;re back online.</p>
      ) : null}
      {load.kind === "error" ? (
        <div className="mt-6">
          <p className="text-field-body text-ink-muted">Your call-backs didn&apos;t load.</p>
          <button type="button" onClick={load.reload} className="mt-2 min-h-tap-min text-sm font-semibold text-prop">
            Try again
          </button>
        </div>
      ) : null}

      {sections ? (
        <>
          <Section title="To call" rows={sections.toCall} onTick={setOpen} empty={`Nothing to call from the last ${days} days.`} />
          {sections.doneToday.length > 0 ? <Section title="Done today" rows={sections.doneToday} onTick={setOpen} done /> : null}
          {sections.later.length > 0 ? <Section title="Later" rows={sections.later} onTick={setOpen} /> : null}
          <p className="mt-6 text-field-body text-ink-muted">
            New call-backs appear within half an hour of the CRM changing. Numbers are deleted 90 days after the lead.
          </p>
        </>
      ) : null}

      {open ? <CallResultSheet row={open} onLog={(r, d) => void log(r, d)} onClose={close} /> : null}
    </div>
  );
}

function Section({
  title,
  rows,
  onTick,
  empty,
  done = false,
}: {
  title: string;
  rows: CallbackRow[];
  onTick: (row: CallbackRow) => void;
  empty?: string;
  done?: boolean;
}) {
  const now = new Date();
  return (
    <section className="mt-5" aria-label={title}>
      <h2 className="mb-2 text-field-body-strong text-ink-muted">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-field-lg border border-line bg-surface px-4 py-4 text-field-body text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-field-lg border border-line bg-surface">
          {rows.map((row) => {
            const name = contactName(row);
            return (
              <li key={row.crm_id} className="flex items-center gap-3 py-3 pl-4 pr-3" data-testid="callback-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-ink">{name ?? doorLine(row)}</p>
                  {name ? <p className="truncate text-field-body text-ink-muted">{doorLine(row)}</p> : null}
                  <p className="mt-0.5 flex items-start gap-1.5 text-field-body text-ink">
                    {done ? null : <span aria-hidden className={`mt-1 size-2.5 shrink-0 rounded-sm border-2 ${TONE_SQUARE[statusTone(row.status)]}`} />}
                    <span className={done ? "text-ink-muted" : ""}>
                      {callbackLine(row, now)}
                      {row.pending ? <span className="text-ink-muted"> · waiting to send</span> : null}
                    </span>
                  </p>
                </div>
                {row.phone ? (
                  <a
                    href={`tel:${row.phone}`}
                    aria-label={`Call ${name ?? doorLine(row)}`}
                    className="flex size-tap-min shrink-0 items-center justify-center rounded-full bg-prop-soft text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                  >
                    <PhoneIcon className="size-5" />
                  </a>
                ) : null}
                <button
                  type="button"
                  aria-label={`Log the call to ${name ?? doorLine(row)}`}
                  onClick={() => onTick(row)}
                  className="flex size-tap-min shrink-0 items-center justify-center rounded-full border border-line text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                >
                  <CheckIcon className="size-5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
