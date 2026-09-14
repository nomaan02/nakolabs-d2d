"use client";

import { useEffect, useState } from "react";
import { DoorBand } from "@/components/admin/door-band";
import type { KnockableCount } from "@/lib/geo/count-knockable";
import type { PropWarning } from "@/lib/geo/prop-warnings";

export const fmt = (n: number) => n.toLocaleString("en-GB");

/** Counts a fresh reading up from zero once. Still under reduced motion. */
function useCountUp(target: number, duration = 400) {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }

    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - started) / duration);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

export function PropTally({
  count,
  shown,
  warnings,
}: {
  count: KnockableCount;
  shown: number;
  warnings: PropWarning[];
}) {
  const knockable = useCountUp(count.knockable);
  const truncated = shown < count.total;

  return (
    <section aria-live="polite">
      <p className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
        Knockable doors
      </p>
      <p className="mt-1 font-data text-[64px] leading-[0.88] tracking-[-0.04em] text-ink tabular-nums">
        {fmt(knockable)}
      </p>

      <DoorBand knockable={count.knockable} />

      <dl className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 font-data text-[11px]">
        <div className="flex items-baseline gap-1.5">
          <dt className="uppercase tracking-[0.14em] text-ink-soft">Total</dt>
          <dd className="text-ink">{fmt(count.total)}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <Hatch />
          <dt className="uppercase tracking-[0.14em] text-ink-soft">Excluded</dt>
          <dd className={count.excluded > 0 ? "text-oxide" : "text-ink"}>{fmt(count.excluded)}</dd>
        </div>
      </dl>

      {truncated ? (
        <p className="mt-3 font-data text-[10px] leading-relaxed text-ink-soft">
          Map is showing {fmt(shown)} of {fmt(count.total)} doors. The count above is the full
          figure.
        </p>
      ) : null}

      {warnings.map((warning) => (
        <p key={warning.code} className="mt-3 text-[13px] leading-snug text-ochre">
          {warning.message}
        </p>
      ))}
    </section>
  );
}

/** The same diagonal hatch the excluded dots are drawn with on the map. */
function Hatch() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 border border-oxide/60"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, var(--color-oxide) 0 1px, transparent 1px 4px)",
      }}
    />
  );
}
