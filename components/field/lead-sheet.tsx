"use client";

import { useState } from "react";

import { Sheet } from "@/components/field/sheet";
import type { LeadDraft } from "@/components/field/field-data-provider";
import { londonDate, londonInstant } from "@/lib/field/london-date";
import { NOTES_MAX } from "@/lib/sync/ops";

/**
 * Appointment time via quick chips. An iOS `datetime-local` picker is slow to
 * operate on a doorstep with someone waiting, so the two times that cover
 * most bookings are one tap each and "Pick…" is the fallback.
 *
 * The sheet's draft — including its `client_event_id` — is owned by the
 * provider and survives a dismiss and a tab switch. The id is generated once,
 * at the Lead TAP, and the same id is submitted however many times the sheet
 * is reopened, so the knock and the lead always share exactly one.
 */

const TIME = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/**
 * Display-only preview of what the trigger will decide. Never sent: the
 * `leads_is_immediate_biu` trigger compares `booked_for` to the knock's
 * `occurred_at` in Europe/London and owns the column outright.
 */
function looksImmediate(bookedFor: string | null): boolean {
  if (!bookedFor) return false;
  return londonDate(new Date(bookedFor)) === londonDate(new Date());
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function LeadSheet({
  draft,
  doorLabel,
  onChange,
  onSubmit,
  onDismiss,
}: {
  draft: LeadDraft;
  doorLabel: string;
  onChange: (draft: LeadDraft) => void;
  onSubmit: (draft: LeadDraft) => void;
  onDismiss: () => void;
}) {
  const [picking, setPicking] = useState(draft.bookedFor !== null);

  const setBookedFor = (bookedFor: string | null) => onChange({ ...draft, bookedFor });
  const immediate = looksImmediate(draft.bookedFor);

  return (
    <Sheet
      title={`Lead · ${doorLabel}`}
      onDismiss={onDismiss}
      footer={
        <button
          type="button"
          onClick={() => onSubmit(draft)}
          className="min-h-[64px] w-full rounded-md bg-lead text-lg font-semibold text-paper"
          data-testid="lead-submit"
        >
          ★ Log the lead
        </button>
      }
    >
      <p className="text-sm font-medium">Appointment time</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            setPicking(false);
            setBookedFor(londonInstant(0, 18));
          }}
          className="min-h-[56px] rounded-md border-2 border-ink bg-paper text-sm font-semibold"
          data-testid="lead-today-pm"
        >
          Today PM
        </button>
        <button
          type="button"
          onClick={() => {
            setPicking(false);
            setBookedFor(londonInstant(1, 10));
          }}
          className="min-h-[56px] rounded-md border-2 border-ink bg-paper text-sm font-semibold"
          data-testid="lead-tomorrow-am"
        >
          Tomorrow AM
        </button>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="min-h-[56px] rounded-md border-2 border-ink bg-paper text-sm font-semibold"
          data-testid="lead-pick"
        >
          Pick…
        </button>
      </div>

      {picking ? (
        <input
          type="datetime-local"
          value={toLocalInputValue(draft.bookedFor)}
          onChange={(event) => {
            const value = event.target.value;
            setBookedFor(value ? new Date(value).toISOString() : null);
          }}
          className="mt-2 min-h-[56px] w-full rounded-md border-2 border-ink/30 bg-worksheet px-3 text-base"
          data-testid="lead-datetime"
        />
      ) : null}

      <p className="mt-2 font-data text-sm" data-testid="lead-booked-for">
        {draft.bookedFor ? TIME.format(new Date(draft.bookedFor)) : "No time booked yet"}
      </p>

      {/* Read-only confirmation. The database decides, not this line. */}
      <p
        className={`mt-2 rounded-md border-2 px-3 py-2 text-sm ${
          immediate ? "border-lead text-ink" : "border-ink/20 text-ink-soft"
        }`}
        data-testid="lead-immediate"
      >
        {immediate
          ? "★ Same day — the office will see this as an immediate."
          : "Not a same-day appointment."}
      </p>

      <label className="mt-4 block text-sm font-medium" htmlFor="lead-notes">
        Notes
      </label>
      <textarea
        id="lead-notes"
        value={draft.notes}
        maxLength={NOTES_MAX}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        rows={3}
        placeholder="e.g. rear extension, wants a morning slot"
        className="mt-1 w-full rounded-md border-2 border-ink/30 bg-worksheet px-3 py-2 text-base"
        data-testid="lead-notes"
      />
      <p className="mt-2 text-sm font-semibold text-oxide">
        Do not record names or contact details.
      </p>
    </Sheet>
  );
}
