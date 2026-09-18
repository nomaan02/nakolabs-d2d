import type { ReactNode } from "react";
import Link from "next/link";

import { AdminNav } from "@/components/admin/admin-nav";
import { ThreeNumbers } from "@/components/admin/three-numbers";
import { SignOutButton } from "@/components/auth/sign-out-button";
import type { DashboardPayload, LeadOutcomeStatus } from "@/lib/admin/dashboard";
import { formatSlot } from "@/lib/geo/rotation";

const LEAD_LABEL: Record<LeadOutcomeStatus, string> = {
  sale: "Sale",
  pm: "Pitch & miss",
  blowout: "Blowout",
  utc: "Unable to contact",
  btc: "Back to canvasser",
};

const LEAD_TONE: Record<LeadOutcomeStatus, string> = {
  sale: "bg-lead",
  pm: "bg-prop",
  blowout: "bg-ochre",
  utc: "bg-oxide",
  btc: "bg-ink-soft",
};

export function DashboardView({
  payload,
  signedInAs,
}: {
  payload: DashboardPayload;
  signedInAs: string;
}) {
  const totals = payload.coverage.reduce(
    (acc, row) => ({
      worked: acc.worked + row.worked,
      answered: acc.answered + row.answered,
      remaining: acc.remaining + row.remaining,
    }),
    { worked: 0, answered: 0, remaining: 0 },
  );
  const stale = payload.props_last_visit.filter((row) => row.stale);
  const leadMax = Math.max(1, ...payload.lead_outcomes.map((row) => row.n));

  return (
    <div className="flex min-h-dvh flex-col bg-worksheet lg:h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="flex w-full flex-col border-ink/15 lg:h-full lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-1 flex-col gap-6 p-6 lg:p-7">
          <header>
            <p className="font-data text-[10px] uppercase tracking-[0.22em] text-ink-soft">
              Dashboard · Bristol
            </p>
            <h1 className="mt-2 font-display text-[27px] font-semibold leading-none tracking-[-0.02em] text-ink">
              The numbers
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
              Derived from knocks on live props. Seeded history is included and is
              not real shift data. As of {formatDay(payload.as_of)}.
            </p>
          </header>

          <AdminNav current="dashboard" />

          <ThreeNumbers
            worked={totals.worked}
            answered={totals.answered}
            remaining={totals.remaining}
          />
          <p className="font-data text-[10px] leading-relaxed text-ink-soft">
            Answered means someone came to the door — not no-answer and not
            inaccessible. Contact, Lead and Rented/Council all count.
          </p>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-ink/15 px-6 py-4 lg:px-7">
          <p className="truncate font-data text-[10px] text-ink-soft">{signedInAs}</p>
          <SignOutButton className="min-h-11 border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop" />
        </footer>
      </aside>

      <main className="flex flex-1 flex-col bg-ink p-3 lg:h-full lg:overflow-y-auto">
        <div className="grid flex-1 gap-3 bg-paper p-4 lg:grid-cols-2 lg:p-6">
          <Panel title="Doors worked per prop per week">
            {payload.worked_per_week.length === 0 ? (
              <Empty>No allocations on live props yet.</Empty>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="font-data text-[10px] uppercase tracking-[0.14em] text-ink-soft">
                    <th className="py-2 pr-3 font-medium">Week</th>
                    <th className="py-2 pr-3 font-medium">Prop</th>
                    <th className="py-2 text-right font-medium">Worked</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.worked_per_week.map((row) => (
                    <tr
                      key={`${row.territory_id}-${row.iso_week}`}
                      className="border-t border-ink/10"
                    >
                      <td className="py-2 pr-3 font-data text-[12px] text-ink">
                        {formatWeek(row.week_start)}
                      </td>
                      <td className="py-2 pr-3 text-ink">{shortName(row.name)}</td>
                      <td className="py-2 text-right font-data tabular-nums text-ink">
                        {row.worked.toLocaleString("en-GB")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Answer rate by slot">
            <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">
              Early, mid and late as allocated. Rate is answered ÷ worked, with
              answered meaning someone came to the door.
            </p>
            <ul className="flex flex-col gap-4">
              {payload.answer_by_slot.map((row) => {
                const rate = row.worked === 0 ? 0 : row.answered / row.worked;
                return (
                  <li key={row.slot}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-data text-[11px] uppercase tracking-[0.14em] text-ink">
                        {formatSlot(row.slot)}
                      </span>
                      <span className="font-data text-[12px] tabular-nums text-ink">
                        {row.answered.toLocaleString("en-GB")} / {row.worked.toLocaleString("en-GB")}
                        <span className="text-ink-soft">
                          {" "}
                          ({Math.round(rate * 100)}%)
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 h-2 bg-worksheet-deep">
                      <div
                        className="h-2 bg-prop"
                        style={{ width: `${Math.round(rate * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Lead outcomes">
            <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">
              Terminal quality outcomes only. Pending, re-app and cancelled stay
              out of this breakdown.
            </p>
            <ul className="flex flex-col gap-3">
              {payload.lead_outcomes.map((row) => (
                <li key={row.status} className="flex items-center gap-3">
                  <span className={`size-2 shrink-0 ${LEAD_TONE[row.status]}`} aria-hidden />
                  <span className="flex-1 text-[14px] text-ink">{LEAD_LABEL[row.status]}</span>
                  <span className="font-data text-[14px] tabular-nums text-ink">
                    {row.n.toLocaleString("en-GB")}
                  </span>
                  <span
                    className="hidden h-2 w-24 bg-worksheet-deep sm:block"
                    aria-hidden
                  >
                    <span
                      className={`block h-2 ${LEAD_TONE[row.status]}`}
                      style={{ width: `${Math.round((row.n / leadMax) * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={`Props not visited in over ${payload.stale_weeks} weeks`}>
            <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-data text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                  Weeks
                </span>
                <input
                  type="number"
                  name="weeks"
                  min={1}
                  max={52}
                  defaultValue={payload.stale_weeks}
                  className="min-h-11 w-24 border border-ink/25 bg-worksheet px-3 font-data text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop"
                />
              </label>
              <button
                type="submit"
                className="min-h-11 bg-prop px-4 font-data text-[11px] uppercase tracking-[0.14em] text-paper hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                Update
              </button>
            </form>
            {stale.length === 0 ? (
              <Empty>
                Every live prop was visited within the last {payload.stale_weeks}{" "}
                weeks.
              </Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {stale.map((row) => (
                  <li
                    key={row.territory_id}
                    className="flex items-baseline justify-between gap-3 border-t border-ink/10 py-2 text-[14px] text-ink first:border-t-0"
                  >
                    <span>{shortName(row.name)}</span>
                    <span className="font-data text-[11px] uppercase tracking-[0.12em] text-oxide">
                      {row.last_visited ? formatDay(row.last_visited) : "Never allocated"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 font-data text-[10px] uppercase tracking-[0.14em] text-ink-soft">
              Last visit on every live prop
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {payload.props_last_visit.map((row) => (
                <li
                  key={row.territory_id}
                  className="flex items-baseline justify-between gap-3 text-[13px] text-ink"
                >
                  <span className="truncate">{shortName(row.name)}</span>
                  <span className="shrink-0 font-data text-[11px] text-ink-soft">
                    {row.last_visited ? formatDay(row.last_visited) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <p className="px-1 pt-2 font-data text-[9px] leading-relaxed text-worksheet/70">
          Coverage is derived from knock events. There is no coverage table.{" "}
          <Link href="/admin/coverage" className="underline decoration-worksheet/50 underline-offset-2">
            Open the coverage map
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col border border-ink/15 p-5">
      <h2 className="font-data text-[10px] uppercase tracking-[0.18em] text-ink-soft">{title}</h2>
      <div className="mt-4 min-h-0 flex-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-ink-soft">{children}</p>;
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

function formatWeek(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(Date.UTC(year, month - 1, day + 6));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startLabel = start.toLocaleDateString("en-GB", {
    day: "numeric",
    month: sameMonth ? undefined : "short",
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${startLabel}–${endLabel}`;
}
