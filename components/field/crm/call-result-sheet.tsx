"use client";

import { useEffect, useRef, useState } from "react";

import { PhoneIcon } from "@/components/field/icons";
import { CALL_RESULT_OPTIONS, callbackAddress, contactName, isoDayLabel, laterDays, reasonLabel, type CallbackRow } from "@/lib/field/crm";
import type { CallResult } from "@/lib/sync/ops";

/**
 * CRM-5 C, Figma F2 (184:7746). "How did the call go?" One tap logs the
 * result through the offline queue. "Call back later" opens a row of days
 * first. A bottom sheet over a scrim; Escape or the scrim closes it, focus
 * goes back to the button that opened it.
 */
export function CallResultSheet({
  row,
  onLog,
  onClose,
}: {
  row: CallbackRow;
  onLog: (result: CallResult, callBackOn: string | null) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const name = contactName(row);

  useEffect(() => {
    opener.current = document.activeElement;
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  const days = laterDays(new Date());

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-testid="call-result-sheet">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-scrim/45" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-result-title"
        className="relative mx-auto max-h-[90%] w-full max-w-2xl overflow-y-auto rounded-t-field-lg bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 shadow-lg"
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="call-result-title" className="truncate text-field-title-sm text-ink">
              {name ?? callbackAddress(row)}
            </h2>
            <p className="mt-0.5 truncate text-field-body text-ink-muted">
              {name ? `${callbackAddress(row)} · ` : ""}
              {reasonLabel(row.callback_reason)}
            </p>
          </div>
          {row.phone ? (
            <a
              href={`tel:${row.phone}`}
              className="flex min-h-tap-min shrink-0 items-center gap-2 rounded-full bg-prop-soft px-4 text-sm font-semibold text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
            >
              <PhoneIcon className="size-5" />
              Call
            </a>
          ) : null}
        </header>

        {picking ? (
          <>
            <p className="mt-5 text-field-body-strong text-ink-muted">Call back on</p>
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {days.map((day, i) => (
                <li key={day}>
                  <button
                    ref={i === 0 ? first : undefined}
                    type="button"
                    onClick={() => onLog("later", day)}
                    className="flex min-h-14 w-full flex-col justify-center rounded-field-md bg-field-bg px-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
                  >
                    <span className="text-sm font-semibold text-ink">{i === 0 ? "Tomorrow" : isoDayLabel(day).split(" ")[0]}</span>
                    <span className="text-field-body text-ink-muted">{isoDayLabel(day).split(" ").slice(i === 0 ? 0 : 1).join(" ")}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="mt-3 min-h-tap-min w-full text-sm font-semibold text-ink-muted"
            >
              Back
            </button>
          </>
        ) : (
          <>
            <p className="mt-5 text-field-body-strong text-ink-muted">How did the call go?</p>
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-field-md bg-field-bg">
              {CALL_RESULT_OPTIONS.map((option, i) => (
                <li key={option.value}>
                  <button
                    ref={i === 0 ? first : undefined}
                    type="button"
                    data-testid={`call-result-${option.value}`}
                    onClick={() => (option.value === "later" ? setPicking(true) : onLog(option.value, null))}
                    className="flex min-h-14 w-full flex-col justify-center px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
                  >
                    <span className={`text-base font-semibold ${option.value === "rebooked" ? "text-prop" : "text-ink"}`}>{option.label}</span>
                    <span className="text-field-body text-ink-muted">{option.help}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onClose} className="mt-3 min-h-tap-min w-full text-base font-semibold text-ink-muted">
              Not now
            </button>
          </>
        )}
      </section>
    </div>
  );
}
