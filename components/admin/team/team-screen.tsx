"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { PeriodChips } from "@/components/admin/team/period-chips";
import { Avatar } from "@/components/admin/ui/avatar";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/field/icons";
import { initialOf } from "@/lib/admin/nav";
import {
  TEAM_PERIODS,
  TEAM_SORTS,
  contactToLead,
  daysLabel,
  parseTeamSort,
  peopleCount,
  percentText,
  profileHref,
  sortTeam,
  teamHref,
  type TeamPeriod,
  type TeamRow,
  type TeamSort,
} from "@/lib/admin/team";

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

/**
 * UI-10 F5c (owner A9, A34; frame 20). Team: one card per canvasser with
 * the period's doors, contacts, leads and contact → lead, sortable. Each
 * card opens that person's profile. Admin only (invariant 2).
 */
export function TeamScreen({
  period,
  periodText,
  rows,
  initialSort,
}: {
  period: TeamPeriod;
  periodText: string;
  rows: TeamRow[];
  initialSort: TeamSort;
}) {
  const [sort, setSort] = useState<TeamSort>(initialSort);
  const sorted = useMemo(() => sortTeam(rows, sort), [rows, sort]);
  const sortLabel = TEAM_SORTS.find((option) => option.value === sort)?.label ?? "";

  // `null` state keeps Next's router in step with the new URL.
  useEffect(() => {
    window.history.replaceState(null, "", teamHref(period, sort));
  }, [period, sort]);

  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] lg:max-w-4xl lg:px-10 lg:pt-8">
      <div className="-ml-1.5 flex min-h-11 items-center lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">Team</h1>
      <p className="text-admin-subhead text-ink-muted">{periodText}</p>

      <div className="mt-3">
        <PeriodChips links={TEAM_PERIODS.map((option) => ({ label: option.label, href: teamHref(option.value, sort), on: option.value === period }))} />
      </div>

      <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
        <p className="text-admin-section text-ink-muted">{peopleCount(sorted.length)}</p>
        <label className="relative inline-flex min-h-11 items-center gap-1 text-admin-body-strong text-prop focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-prop">
          <span className="sr-only">Sort by</span>
          <span aria-hidden>{sortLabel}</span>
          <ChevronDownIcon className="size-4" />
          <select
            value={sort}
            onChange={(event) => setSort(parseTeamSort(event.target.value))}
            className="absolute inset-0 cursor-pointer appearance-none opacity-0"
          >
            {TEAM_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <div className="mt-1 rounded-field-lg bg-surface p-5 lg:border lg:border-line">
          <p className="text-admin-body">No canvassers yet.</p>
          <Link
            href="/admin/settings"
            className="mt-2 inline-flex min-h-11 items-center text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
          >
            Invite one in Settings
          </Link>
        </div>
      ) : (
        <ul className="mt-1 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sorted.map((row) => (
            <li key={row.person.id}>
              <PersonCard row={row} href={profileHref(row.person.id, period)} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function PersonCard({ row, href }: { row: TeamRow; href: string }) {
  const { person, stats } = row;
  const conversion = contactToLead(stats);
  const figures = [
    { label: "Doors", value: n(stats.doors) },
    { label: "Contacts", value: n(stats.contacts) },
    { label: "Leads", value: n(stats.leads) },
  ];
  return (
    <Link
      href={href}
      className="block rounded-field-lg bg-surface p-4 transition-transform duration-100 active:scale-[0.99] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop lg:border lg:border-line"
    >
      <span className="flex items-center gap-3">
        <Avatar initial={initialOf(person.name)} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-admin-headline">{person.name}</span>
          {!person.active ? <span className="block text-admin-caption text-ink-muted">Inactive</span> : null}
        </span>
        <span className="text-admin-subhead text-ink-muted tabular-nums">{daysLabel(stats.days)}</span>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-faint" />
      </span>
      <span className="mt-3 grid grid-cols-[1fr_1fr_0.8fr_1.3fr] gap-2">
        {figures.map((figure) => (
          <span key={figure.label} className="flex flex-col">
            <span className="text-admin-body tabular-nums">{figure.value}</span>
            <span className="text-admin-caption text-ink-muted">{figure.label}</span>
          </span>
        ))}
        <span className="flex flex-col">
          <span className={`text-admin-body-strong tabular-nums ${conversion === null ? "text-ink-muted" : "text-lead"}`}>{percentText(conversion)}</span>
          <span className="text-admin-caption text-ink-muted">Contact → lead</span>
        </span>
      </span>
    </Link>
  );
}
