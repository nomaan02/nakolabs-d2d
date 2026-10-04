import type { KnockableCount } from "@/lib/geo/count-knockable";

const fmt = (n: number) => n.toLocaleString("en-GB");

/**
 * Neutral door count. No threshold and no warning colour — a shift here
 * walks past a lot of doors it does not knock. UI-5 A3b: flats are buildings of 3+ units; neither flats nor No Cold Calling doors are knocked.
 */
export function PropTally({ count, shown }: { count: KnockableCount; shown: number }) {
  const truncated = shown < count.total;

  return (
    <section aria-live="polite">
      <p className="font-data text-[15px] tabular-nums text-ink" data-testid="door-readout">
        {fmt(count.knockable)} knockable · {fmt(count.multiUnit)} flats · {fmt(count.nccz)} no cold calling
      </p>

      {truncated ? (
        <p className="mt-3 font-data text-[10px] leading-relaxed text-ink-soft">
          Map is showing {fmt(shown)} of {fmt(count.total)} doors. The count above is the full
          figure.
        </p>
      ) : null}
    </section>
  );
}
