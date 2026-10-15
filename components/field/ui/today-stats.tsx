/**
 * FUI-2b (owner 2026-10-14; Figma Field/TodayStats 208:401). Today's own
 * counts, in admin's figure + caption style (Today numbers card), two by
 * two. Replaces StatRow: sentence case, no zero padding, tabular figures.
 *
 * Counts only, this canvasser, today: no rates or rankings (invariant 2).
 * A `null` value renders an em dash, never a fabricated "0". "Confirmed" is
 * null until the CRM supplies it (owner Q3, 2026-10-14: keep the dash).
 * Labels never truncate: on a 375px phone "Confirmed" runs a few pixels
 * into the space under Other, which is empty at that height.
 */
export function TodayStats({
  doors,
  contacts,
  leads,
  confirmed,
  className = "",
}: {
  doors: number | null;
  contacts: number | null;
  leads: number | null;
  confirmed: number | null;
  className?: string;
}) {
  const cells: ReadonlyArray<[string, number | null]> = [
    ["Doors", doors],
    ["Contacts", contacts],
    ["Leads", leads],
    ["Confirmed", confirmed],
  ];
  return (
    <dl className={`grid grid-cols-2 gap-x-2 gap-y-2 ${className}`} aria-label="Today's numbers" data-testid="today-stats">
      {cells.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col-reverse" data-testid="stat-row">
          <dt className="whitespace-nowrap text-admin-caption text-ink-muted" data-testid="stat-label">
            {label}
          </dt>
          <dd className="text-admin-figure text-ink tabular-nums" data-testid="stat-value">
            {value === null ? "—" : value.toLocaleString("en-GB")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
