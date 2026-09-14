"use client";

import { SHIFT_DOORS } from "@/lib/geo/prop-polygon";

/**
 * A ruled gauge for one prop's knockable count.
 *
 * The scale runs 0 to whichever is larger, 150 or the count itself, so a prop
 * inside the shift window fills a band ruled at 40 and 150, and a prop over it
 * pushes those rules leftwards and carries on in ochre. Overshoot is shown
 * rather than described.
 */
export function DoorBand({ knockable }: { knockable: number }) {
  const domain = Math.max(SHIFT_DOORS.max, knockable);
  const pct = (value: number) => `${Math.min(100, (value / domain) * 100)}%`;

  const withinWindow = Math.min(knockable, SHIFT_DOORS.max);
  const overshoot = Math.max(0, knockable - SHIFT_DOORS.max);

  return (
    <div className="mt-4">
      <div
        className="relative h-9 border border-ink/25 bg-worksheet-deep"
        role="img"
        aria-label={`${knockable} knockable doors against a shift window of ${SHIFT_DOORS.min} to ${SHIFT_DOORS.max}`}
      >
        <div
          className="absolute inset-y-0 left-0 bg-prop transition-[width] duration-[400ms] ease-out motion-reduce:transition-none"
          style={{ width: pct(withinWindow) }}
        />
        {overshoot > 0 ? (
          <div
            className="absolute inset-y-0 bg-ochre transition-[width] duration-[400ms] ease-out motion-reduce:transition-none"
            style={{ left: pct(SHIFT_DOORS.max), width: pct(overshoot) }}
          />
        ) : null}

        {/* Ruler texture, one hairline every 6px, multiplied over the fill. */}
        <div
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, rgba(28,34,38,0.22) 0 1px, transparent 1px 6px)",
          }}
        />

        <Rule at={pct(SHIFT_DOORS.min)} />
        <Rule at={pct(SHIFT_DOORS.max)} />
      </div>

      <div className="relative mt-1 h-4 font-data text-[10px] text-ink-soft">
        <span className="absolute -translate-x-1/2" style={{ left: pct(SHIFT_DOORS.min) }}>
          {SHIFT_DOORS.min}
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(SHIFT_DOORS.max) }}>
          {SHIFT_DOORS.max}
        </span>
      </div>
    </div>
  );
}

function Rule({ at }: { at: string }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 w-px bg-ink/70" style={{ left: at }} />
  );
}
