import type { PropCompletion } from "@/lib/prop-completion";

export function PropCompletionList({ rows }: { rows: PropCompletion[] }) {
  if (rows.length === 0) {
    return <p className="text-[14px] leading-relaxed text-ink-soft">No allocations yet.</p>;
  }

  return (
    <div className="overflow-x-auto" data-testid="prop-completion-list">
      <table className="w-full min-w-[36rem] text-left text-[13px]">
        <thead>
          <tr className="font-data text-[10px] uppercase tracking-[0.14em] text-ink-soft">
            <th className="py-2 pr-3 font-medium">Prop</th>
            <th className="py-2 pr-3 font-medium">Visit</th>
            <th className="py-2 pr-3 text-right font-medium">Worked</th>
            <th className="py-2 pr-3 text-right font-medium">Answered</th>
            <th className="py-2 text-right font-medium">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.assignment_id} className="border-t border-ink/10">
              <td className="py-2 pr-3 text-ink">
                <span>{shortName(row.territory_name)}</span>
                <span className="mt-0.5 block font-data text-[11px] text-ink-soft">
                  {formatDay(row.work_date)}
                </span>
              </td>
              <td className="py-2 pr-3 font-data tabular-nums whitespace-nowrap text-ink">
                {row.visit_number}
              </td>
              <td
                className="py-2 pr-3 text-right font-data tabular-nums whitespace-nowrap text-ink"
                data-testid="completion-worked"
              >
                {row.worked.toLocaleString("en-GB")}
              </td>
              <td
                className="py-2 pr-3 text-right font-data tabular-nums whitespace-nowrap text-ink"
                data-testid="completion-answered"
              >
                {row.answered.toLocaleString("en-GB")}
              </td>
              <td
                className="py-2 text-right font-data tabular-nums whitespace-nowrap text-ink"
                data-testid="completion-remaining"
              >
                {row.remaining.toLocaleString("en-GB")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shortName(name: string): string {
  return name.startsWith("DEMO - ") ? name.slice("DEMO - ".length) : name;
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
