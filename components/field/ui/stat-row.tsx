/**
 * StatRow — Figma node 7:27.
 *
 * "Today's stats row (this canvasser, today, current assignment). Counts
 * only — no rates or rankings (invariant 2). 'Confirmed' is a placeholder
 * until the CRM is linked."
 *
 * `value` is a plain count or `null`. `null` renders an em dash, never a
 * fabricated "0" — this is how the Session C composer renders "Confirmed"
 * until the CRM is linked (brief invariant 2). Zero-padded to 2 digits so
 * every row lines up at a fixed 36px minimum width, whether the count is
 * "3" or "48".
 */
export function StatRow({ label, value }: { label: string; value: number | null }) {
  const display = value === null ? "—" : String(value).padStart(2, "0");

  return (
    <div className="flex items-baseline gap-2 min-[390px]:gap-3" data-testid="stat-row">
      <p className="min-w-9 text-field-stat-number text-ink" data-testid="stat-value">
        {display}
      </p>
      <p className="whitespace-nowrap text-field-stat-label text-ink-muted uppercase tracking-[0.08em] min-[390px]:tracking-[0.12em]" data-testid="stat-label">
        {label}
      </p>
    </div>
  );
}
