/**
 * StatsRail: four "StatCell 2.1" (327:895), Logger V2.1 dial layout.
 * Today's own counts in one 40px row of four equal columns, so the figures
 * never shift sideways when a number grows. Value 17/20 semibold, label
 * 11/14 `ink-muted`, a 6px key dot linking the count to its outcome on the
 * dial (the label carries the meaning; the dot is only a key).
 *
 * Counts only, this canvasser, today: no rates or rankings (invariant 2).
 * Two digits as drawn in Figma ("04"); `null` shows a dash, never a made-up
 * zero. "Confirmed" stays null until the CRM supplies it (owner Q3).
 */
const CELLS = [
  { key: "doors", label: "Doors", dot: "bg-ink-faint" },
  { key: "contacts", label: "Contacts", dot: "bg-outcome-contact" },
  { key: "leads", label: "Leads", dot: "bg-outcome-lead" },
  { key: "confirmed", label: "Confirmed", dot: "bg-lead" },
] as const;

type Counts = Record<(typeof CELLS)[number]["key"], number | null>;

export function formatStat(value: number | null): string {
  if (value === null) return "—";
  return value < 10 ? `0${value}` : value.toLocaleString("en-GB");
}

export function StatsRail({ counts, hidden = false }: { counts: Counts; hidden?: boolean }) {
  return (
    <dl
      aria-label="Today's numbers"
      aria-hidden={hidden || undefined}
      className="grid h-10 grid-cols-4 items-center px-4"
      style={{ opacity: hidden ? 0 : 1, transition: "opacity 160ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
      data-testid="stats-rail"
    >
      {CELLS.map((cell) => (
        <div key={cell.key} className="flex min-w-0 flex-col-reverse items-center gap-1" data-testid="stat-cell">
          <dt className="whitespace-nowrap text-field-caption text-ink-muted">{cell.label}</dt>
          <dd className="flex items-center gap-1 text-field-stat-compact text-ink tabular-nums">
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${cell.dot}`} />
            {formatStat(counts[cell.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
