"use client";

import { useEffect, useMemo, useState } from "react";

import { LeadMarkDot, MARK_TEXT } from "@/components/admin/leads/lead-mark";
import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { PeriodChips } from "@/components/admin/team/period-chips";
import { Button } from "@/components/admin/ui/button";
import { Chip } from "@/components/admin/ui/chip";
import { InfoIcon } from "@/components/field/icons";
import {
  LEADS_PAGE,
  doorTitle,
  emptyLeadsLine,
  filterByStatus,
  leadMark,
  leadMeta,
  leadStatusLabel,
  leadsHref,
  leadsSubtitle,
  showMoreLabel,
  statusChips,
  type LeadItem,
  type StatusFilter,
} from "@/lib/admin/leads";
import { TEAM_PERIODS, type TeamPeriod } from "@/lib/admin/team";

/**
 * UI-10 F5d (frame 21; owner 2026-10-09: period chips like Team). Every
 * lead in the period, newest first, filtered by the office's status.
 * Read-only: only the office settles a lead, so there is no status control
 * and no row action. Doors are address labels or UPRNs, never residents.
 */
export function LeadsScreen({
  period,
  today,
  items,
  initialStatus,
}: {
  period: TeamPeriod;
  today: string;
  items: LeadItem[];
  initialStatus: StatusFilter;
}) {
  const chips = useMemo(() => statusChips(items), [items]);
  const [status, setStatus] = useState<StatusFilter>(chips.some((chip) => chip.value === initialStatus) ? initialStatus : "all");
  const [shown, setShown] = useState(LEADS_PAGE);
  const visible = useMemo(() => filterByStatus(items, status), [items, status]);

  // `null` state keeps Next's router in step with the new URL.
  useEffect(() => {
    window.history.replaceState(null, "", leadsHref(period, status));
  }, [period, status]);

  const pick = (next: StatusFilter) => {
    setStatus(next);
    setShown(LEADS_PAGE);
  };

  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] lg:max-w-3xl lg:px-10 lg:pt-8">
      <div className="-ml-1.5 flex min-h-11 items-center lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">Leads</h1>
      <p className="text-admin-subhead text-ink-muted">{leadsSubtitle(items.length, period)}</p>

      <div className="mt-3">
        <PeriodChips links={TEAM_PERIODS.map((option) => ({ label: option.label, href: leadsHref(option.value, status), on: option.value === period }))} />
      </div>
      <div role="group" aria-label="Status" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
        {chips.map((chip) => (
          <Chip key={chip.value} on={chip.value === status} onClick={() => pick(chip.value)}>
            {chip.label} <span className="ml-1 tabular-nums">{chip.count.toLocaleString("en-GB")}</span>
          </Chip>
        ))}
      </div>

      <p className="mt-1 flex min-h-8 items-center gap-1.5 text-admin-caption text-ink-muted">
        <InfoIcon className="size-4 shrink-0" />
        Only the office can change a lead&apos;s status.
      </p>

      <ul aria-label="Leads" className="mt-2 rounded-field-lg bg-surface lg:border lg:border-line">
        {visible.length === 0 ? (
          <li className="px-4 py-5 text-admin-body text-ink-muted">{emptyLeadsLine(status, period)}</li>
        ) : (
          visible.slice(0, shown).map((item) => {
            const mark = leadMark(item.status);
            return (
              <li key={item.id} className="flex min-h-16 items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-admin-headline">{doorTitle(item)}</span>
                  <span className="block truncate text-admin-subhead text-ink-muted">{leadMeta(item, today)}</span>
                </span>
                <span className={`flex shrink-0 items-center gap-1.5 text-admin-pill ${MARK_TEXT[mark]}`}>
                  <LeadMarkDot status={item.status} />
                  {leadStatusLabel(item.status)}
                </span>
              </li>
            );
          })
        )}
      </ul>

      {visible.length > shown ? (
        <Button kind="secondary" size="compact" className="mt-3 w-full" onClick={() => setShown((count) => count + LEADS_PAGE)}>
          {showMoreLabel(shown, visible.length)}
        </Button>
      ) : null}
    </main>
  );
}
