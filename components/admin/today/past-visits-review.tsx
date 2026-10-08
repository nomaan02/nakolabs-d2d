"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { CheckIcon, ChevronLeftIcon, WarningIcon } from "@/components/field/icons";
import {
  mustEnd,
  reviewButton,
  reviewConfirm,
  reviewRowMeta,
  selectionLine,
  splitReview,
  staleGroups,
  type TodayVisit,
  type VisitFigures,
} from "@/lib/admin/today";
import { removeAssignmentAction } from "@/lib/props/reallocation";
import { closeVisitAction } from "@/lib/props/visits";

type Failure = { visit: TodayVisit; message: string };

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-6 shrink-0 items-center justify-center rounded-field-sm border-2 ${on ? "border-prop bg-prop text-paper" : "border-ink-faint bg-surface"}`}
    >
      {on ? <CheckIcon className="size-4" /> : null}
    </span>
  );
}

/**
 * UI-10 F3d (owner A27; frames 18-19). Every open visit dated before today,
 * by date, all ticked. Untick any to keep. One button ends the started or
 * knocked ones (`assignment_close_early` / `assignment_remove`) and deletes
 * the ones that never started, one visit at a time — the same rule as the
 * visit sheet. A failure stops nothing: it is listed and stays open.
 */
export function PastVisitsReview({ visits, figures }: { visits: TodayVisit[]; figures: Record<string, VisitFigures> }) {
  const router = useRouter();
  const figureMap = useMemo(() => new Map(Object.entries(figures)), [figures]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(visits.map((visit) => visit.id)));
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);

  const groups = staleGroups(visits);
  const { end, remove } = splitReview(visits, selected, figureMap);
  const all = selected.size === visits.length && visits.length > 0;
  const confirm = reviewConfirm(end.length, remove.length);
  const working = progress !== null;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    setAsking(false);
    const targets = visits.filter((visit) => selected.has(visit.id));
    const failed: Failure[] = [];
    setFailures([]);
    setProgress({ done: 0, total: targets.length });
    for (const [index, visit] of targets.entries()) {
      // Started visits are ended, never deleted (their phones may hold unsynced knocks).
      const result = await (visit.startedAt ? closeVisitAction(visit.id) : removeAssignmentAction(visit.id)).catch(() => null);
      if (!result || !result.ok) failed.push({ visit, message: result?.message ?? "That request did not complete." });
      setProgress({ done: index + 1, total: targets.length });
    }
    setProgress(null);
    if (failed.length === 0) {
      router.push("/admin/today");
      router.refresh();
      return;
    }
    setFailures(failed);
    setSelected(new Set(failed.map((failure) => failure.visit.id)));
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col lg:px-6 lg:pt-6">
      <div className="px-4">
        <Link
          href="/admin/today"
          aria-label="Back to Today"
          className="-ml-2.5 inline-flex size-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-prop"
        >
          <ChevronLeftIcon className="size-6" />
        </Link>
        <h1 className="mt-1 text-admin-title">
          {visits.length === 1 ? "1 past visit still open" : `${visits.length} past visits still open`}
        </h1>
        <p className="text-admin-subhead text-ink-muted">Ending a visit frees the prop for its next visit.</p>
      </div>

      {visits.length === 0 ? (
        <p className="px-4 pt-6 text-admin-body text-ink-muted">Nothing to close. Every past visit is ended.</p>
      ) : (
        <>
          <button
            type="button"
            role="checkbox"
            aria-checked={all ? true : selected.size === 0 ? false : "mixed"}
            disabled={working}
            onClick={() => setSelected(all ? new Set() : new Set(visits.map((visit) => visit.id)))}
            className="mt-4 flex min-h-14 items-center gap-3 bg-field-bg px-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop lg:rounded-field-lg"
          >
            <Tick on={all} />
            <span className="flex-1 text-admin-body-strong">{selectionLine(selected.size, visits.length)}</span>
            <span className="text-admin-subhead text-ink-muted tabular-nums">
              {end.length} end · {remove.length} delete
            </span>
          </button>

          {failures.length > 0 ? (
            <div role="alert" className="mx-4 mt-3 rounded-field-md bg-error-bg p-3 text-oxide">
              <p className="flex gap-2 text-admin-subhead">
                <WarningIcon className="size-5 shrink-0" />
                {failures.length === 1 ? "1 visit could not be closed:" : `${failures.length} visits could not be closed:`}
              </p>
              <ul className="mt-1 pl-7 text-admin-caption">
                {failures.map((failure) => (
                  <li key={failure.visit.id}>
                    {failure.visit.propName}, visit {failure.visit.visitNumber}: {failure.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex-1 px-4">
            {groups.map((group) => (
              <section key={group.date} aria-label={group.label} className="mt-4">
                <h2 className="text-admin-section text-ink-muted">{group.label}</h2>
                <ul>
                  {group.visits.map((visit) => {
                    const on = selected.has(visit.id);
                    const ends = mustEnd(visit, figureMap.get(visit.id));
                    return (
                      <li key={visit.id} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={working}
                          onClick={() => toggle(visit.id)}
                          className="flex min-h-16 w-full items-center gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                        >
                          <Tick on={on} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-admin-body-strong">{visit.propName}</span>
                            <span className="block truncate text-admin-subhead text-ink-muted">{reviewRowMeta(visit, figureMap.get(visit.id))}</span>
                          </span>
                          <span className={`text-admin-pill ${!on ? "text-ink-faint" : ends ? "text-ink" : "text-oxide"}`}>
                            {!on ? "Keep" : ends ? "End" : "Delete"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="sticky bottom-0 mt-6 border-t border-line bg-field-bg px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:border-0">
            <Button className="w-full" disabled={selected.size === 0 || working} onClick={() => setAsking(true)}>
              {progress ? `Closing ${progress.done} of ${progress.total}…` : reviewButton(end.length, remove.length)}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={asking}
        title={confirm.title}
        body={confirm.body}
        confirmLabel={confirm.confirm}
        onConfirm={() => void run()}
        onCancel={() => setAsking(false)}
      />
    </main>
  );
}
