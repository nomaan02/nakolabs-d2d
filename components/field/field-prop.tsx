"use client";

import { useEffect, useState } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { FieldMap } from "@/components/field/field-map";
import { cacheAssignment, clearCachedToday, getCachedToday } from "@/lib/field/cache";
import {
  fetchTodaysAssignment,
  formatAssignmentHeader,
  type TodaysAssignment,
  type TodaysAssignmentResult,
} from "@/lib/geo/todays-assignment";
import { createClient } from "@/lib/supabase/client";

type View = "map" | "list";

type Phase =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; assignment: TodaysAssignment; fromCache: boolean };

export function FieldProp({ signedInAs }: { signedInAs: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [view, setView] = useState<View>("map");
  const [selectedUprn, setSelectedUprn] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user.id;
      if (cancelled) return;

      const cached = uid ? await getCachedToday(uid).catch(() => undefined) : undefined;
      if (cancelled) return;
      if (cached) {
        setPhase({ kind: "ready", assignment: cached.payload, fromCache: true });
      }

      const result = await Promise.race([
        fetchTodaysAssignment(supabase),
        new Promise<Extract<TodaysAssignmentResult, { ok: false }>>((resolve) => {
          window.setTimeout(
            () =>
              resolve({
                ok: false,
                message: "Today's prop could not be loaded. Check your connection and try again.",
              }),
            8000,
          );
        }),
      ]);
      if (cancelled) return;

      if (result.ok && result.assignment) {
        if (uid) await cacheAssignment(result.assignment, uid).catch(() => undefined);
        if (cancelled) return;
        setPhase({ kind: "ready", assignment: result.assignment, fromCache: false });
        return;
      }

      if (result.ok && result.assignment === null) {
        if (uid) await clearCachedToday(uid).catch(() => undefined);
        if (cancelled) return;
        setPhase({ kind: "empty" });
        return;
      }

      if (!result.ok) {
        if (cached) {
          setPhase({ kind: "ready", assignment: cached.payload, fromCache: true });
          return;
        }
        setPhase({
          kind: "error",
          message: result.message,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="relative flex min-h-dvh flex-col bg-worksheet text-ink">
      <header className="z-10 border-b border-ink/15 bg-paper px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-data text-[11px] uppercase tracking-wide text-ink-soft">Field</p>
            {phase.kind === "ready" ? (
              <>
                <h1 className="mt-1 font-display text-lg leading-snug tracking-tight">
                  {phase.assignment.territory_name}
                </h1>
                <p className="mt-1 font-data text-xs leading-relaxed text-ink-soft">
                  {formatAssignmentHeader(phase.assignment)}
                </p>
              </>
            ) : (
              <h1 className="mt-1 font-display text-lg tracking-tight">Today&apos;s prop</h1>
            )}
          </div>
          <SignOutButton className="min-h-11 shrink-0 rounded-md border border-ink/20 bg-paper px-3 text-sm font-medium text-ink hover:bg-worksheet" />
        </div>
        <p className="mt-2 truncate text-xs text-ink-soft">Signed in as {signedInAs}</p>
        {phase.kind === "ready" && phase.fromCache ? (
          <p className="mt-2 text-xs text-ink-soft" role="status">
            Showing the copy saved on this phone.
          </p>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1">
        {phase.kind === "loading" ? (
          <p className="px-4 pt-8 text-sm text-ink-soft">Loading today&apos;s prop…</p>
        ) : null}

        {phase.kind === "empty" ? (
          <div className="px-4 pt-8" data-testid="field-empty">
            <p className="font-display text-xl tracking-tight">No prop allocated for today.</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
              Nothing is assigned to you for today. If you should be out, speak to the person who
              allocates the props.
            </p>
          </div>
        ) : null}

        {phase.kind === "error" ? (
          <p className="px-4 pt-8 text-sm text-ink-soft" role="alert">
            {phase.message}
          </p>
        ) : null}

        {phase.kind === "ready" ? (
          <>
            <div className={view === "map" ? "absolute inset-0" : "hidden"} aria-hidden={view !== "map"}>
              <FieldMap
                doors={phase.assignment.doors}
                selectedUprn={selectedUprn}
                onSelectUprn={setSelectedUprn}
                active={view === "map"}
              />
            </div>
            <ol
              className={
                view === "list"
                  ? "absolute inset-0 overflow-y-auto bg-paper px-2 py-2"
                  : "hidden"
              }
              data-testid="field-door-list"
            >
              {phase.assignment.doors.features.map((feature) => {
                const { uprn, sequence } = feature.properties;
                const selected = uprn === selectedUprn;
                return (
                  <li key={uprn}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUprn(uprn);
                        setView("map");
                      }}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left ${
                        selected ? "bg-worksheet outline outline-1 outline-ink/30" : ""
                      }`}
                    >
                      <span className="text-base">Door {sequence + 1}</span>
                      <span className="font-data text-xs text-ink-soft">{uprn}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
      </div>

      {phase.kind === "ready" ? (
        <nav className="z-10 grid grid-cols-2 border-t border-ink/15 bg-paper">
          <button
            type="button"
            onClick={() => setView("map")}
            className={`min-h-11 text-base font-medium ${
              view === "map" ? "bg-ink text-paper" : "text-ink"
            }`}
          >
            Map
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`min-h-11 text-base font-medium ${
              view === "list" ? "bg-ink text-paper" : "text-ink"
            }`}
          >
            List
          </button>
        </nav>
      ) : null}
    </main>
  );
}
