"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { saveVisitThresholdAction } from "@/lib/props/reallocation";

const NUMBER = /^(?:\d+)(?:\.\d+)?$/;

export function RotationSettings({
  signedInAs,
  initialPct,
  detail,
  extra,
}: {
  signedInAs: string;
  initialPct: number;
  detail: string;
  /** UI-8 D2b: further settings, shown under the threshold form. */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const [input, setInput] = useState(String(initialPct));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!NUMBER.test(text)) {
      setSaved(null);
      setError("Enter a percentage from 0 to 100.");
      return;
    }
    const pct = Number(text);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setSaved(null);
      setError("Enter a percentage from 0 to 100.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await saveVisitThresholdAction(pct);
        if (!result.ok) {
          setSaved(null);
          setError(result.message);
          return;
        }
        if (result.source !== "setting") {
          setSaved(null);
          setError(`The stored value will not be used. Removals use ${result.savedPct}%.`);
          return;
        }
        setSaved(result.savedPct);
        setInput(String(result.savedPct));
        router.refresh();
      } catch {
        setSaved(null);
        setError("That request did not complete. Refresh the page before trying again.");
      }
    });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-worksheet lg:h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="flex w-full flex-col border-ink/15 lg:h-full lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-1 flex-col gap-6 p-6 lg:p-7">
          <header>
            <p className="font-data text-[10px] uppercase tracking-[0.22em] text-ink-soft">
              Settings · Bristol
            </p>
            <h1 className="mt-2 font-display text-[27px] font-semibold leading-none tracking-[-0.02em] text-ink">
              Visit threshold
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
              An early end counts toward the next visit only when the share of doors worked is
              above this percentage. Exactly this percentage does not count.
            </p>
          </header>
          <AdminMenuButton />
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-ink/15 px-6 py-4 lg:px-7">
          <p className="truncate font-data text-[10px] text-ink-soft">{signedInAs}</p>
          <SignOutButton className="min-h-11 border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop" />
        </footer>
      </aside>

      <main className="flex flex-1 flex-col bg-ink p-3 lg:h-full lg:overflow-y-auto">
        <div className="flex-1 bg-paper p-6 lg:p-10">
          <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-6">
            <p className="text-[14px] leading-relaxed text-ink" data-testid="threshold-current">
              {detail}
            </p>
            <label className="flex flex-col gap-2">
              <span className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                Percentage
              </span>
              <input
                type="text"
                inputMode="decimal"
                required
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setSaved(null);
                  setError(null);
                }}
                data-testid="threshold-input"
                className="min-h-11 w-full max-w-xs border border-ink/25 bg-worksheet px-3 font-data text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              data-testid="threshold-save"
              className="min-h-11 w-full max-w-xs bg-prop px-4 font-data text-[11px] uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {pending ? "Saving…" : "Save threshold"}
            </button>
            {saved !== null ? (
              <p className="text-[14px] leading-relaxed text-ink" role="status" data-testid="threshold-saved">
                Saved. Removals use {saved}%.
              </p>
            ) : null}
            {error ? (
              <p className="text-[14px] text-oxide" role="alert">
                {error}
              </p>
            ) : null}
          </form>
          {extra ? <div className="mt-10 max-w-md border-t border-ink/15 pt-8">{extra}</div> : null}
        </div>
      </main>
    </div>
  );
}
