"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { Avatar } from "@/components/admin/ui/avatar";
import { Button } from "@/components/admin/ui/button";
import { Segmented } from "@/components/admin/ui/segmented";
import { Sheet } from "@/components/admin/ui/sheet";
import { CheckIcon, ChevronRightIcon } from "@/components/field/icons";
import { APPEARANCE_OPTIONS, initialOf } from "@/lib/admin/nav";
import {
  LOGGING_OPTIONS,
  THRESHOLD_ERROR,
  accountLine,
  dataRows,
  loggingLabel,
  parseThreshold,
  thresholdValue,
  type CanvasserAccount,
  type DataStatus,
  type LoggingDefault,
} from "@/lib/admin/settings";
import { setThemePref, useThemePref } from "@/lib/field/theme";
import { saveVisitThresholdAction } from "@/lib/props/reallocation";
import { createClient } from "@/lib/supabase/client";

type Open = null | "threshold" | "logging";

/**
 * UI-10 F5e (owner A35; frames 23, 24, dark 32). Settings: grouped rows.
 * The threshold and the logging default open a sheet each; Appearance is
 * the shared Light / Dark / System choice (A51); canvasser accounts are
 * listed (switching on and off and inviting arrive in F5f, with migration
 * 029); data status is read-only.
 */
export function SettingsScreen({
  thresholdPct,
  thresholdStored,
  loggingDefault,
  accounts,
  data,
  failed,
  build,
}: {
  thresholdPct: number;
  thresholdStored: boolean;
  loggingDefault: LoggingDefault;
  accounts: CanvasserAccount[];
  data: DataStatus;
  failed: Array<"accounts" | "data">;
  build: string;
}) {
  const router = useRouter();
  const pref = useThemePref();
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const done = (text: string) => {
    setOpen(null);
    setToast(text);
    router.refresh();
  };

  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-10 lg:pt-8">
      <div className="-ml-1.5 flex min-h-11 items-center lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">Settings</h1>

      <Group title="Visits" help="A visit ended early counts toward rotation only after this share of doors is worked.">
        <ValueRow label="Rotation threshold" value={thresholdStored ? thresholdValue(thresholdPct) : `${thresholdValue(thresholdPct)} (default)`} onClick={() => setOpen("threshold")} />
      </Group>

      <Group title="Field app" help="What canvassers log by default. They can switch on the You tab. Team props always log every door.">
        <ValueRow label="Logging default" value={loggingLabel(loggingDefault)} onClick={() => setOpen("logging")} />
      </Group>

      <Group title="Appearance" help="Shared with the field app on this device.">
        <div className="p-2 [&>div]:flex [&>div]:w-full">
          <Segmented label="Appearance" options={APPEARANCE_OPTIONS} value={pref} onChange={setThemePref} />
        </div>
      </Group>

      <Group title="Canvassers" help="Inactive people can't sign in and drop off the allocation list. Their history stays.">
        {failed.includes("accounts") ? (
          <p role="alert" className="px-4 py-4 text-admin-body text-ink-soft">
            Accounts didn&apos;t load. Reopen Settings to try again.
          </p>
        ) : (
          <ul>
            {accounts.length === 0 ? <li className="px-4 py-4 text-admin-body text-ink-muted">No canvassers yet.</li> : null}
            {accounts.map((account) => (
              <li key={account.id} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2">
                <Avatar initial={initialOf(account.name)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-admin-body">{account.name}</span>
                  <span className="block text-admin-caption text-ink-muted">{accountLine(account)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Data">
        {failed.includes("data") ? (
          <p role="alert" className="px-4 py-4 text-admin-body text-ink-soft">
            Data status didn&apos;t load.
          </p>
        ) : (
          <dl>
            {dataRows(data).map((row) => (
              <div key={row.label} className="flex min-h-13 items-center justify-between gap-3 border-t border-line px-4 py-2 first:border-t-0">
                <dt className="text-admin-body">{row.label}</dt>
                <dd className="text-admin-body text-ink-muted tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Group>

      <p className="mt-6 px-1 text-admin-caption text-ink-muted">{build}</p>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p role="status" className="pointer-events-auto rounded-field-lg bg-ink px-4 py-3 text-admin-body text-paper shadow-field-toast motion-safe:animate-admin-fade-in">
            {toast}
          </p>
        </div>
      ) : null}

      <ThresholdSheet open={open === "threshold"} initialPct={thresholdPct} onClose={() => setOpen(null)} onSaved={(pct) => done(`Threshold saved: ${thresholdValue(pct)}.`)} />
      <LoggingSheet open={open === "logging"} initial={loggingDefault} onClose={() => setOpen(null)} onSaved={(mode) => done(`Logging default saved: ${loggingLabel(mode)}.`)} />

    </main>
  );
}

function Group({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="mb-1.5 px-1 text-admin-section text-ink-muted">{title}</h2>
      <div className="overflow-hidden rounded-field-lg bg-surface lg:border lg:border-line">{children}</div>
      {help ? <p className="mt-1.5 px-1 text-admin-caption text-ink-muted">{help}</p> : null}
    </section>
  );
}

function ValueRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
    >
      <span className="min-w-0 flex-1 text-admin-body">{label}</span>
      <span className="text-admin-body text-ink-muted tabular-nums">{value}</span>
      <ChevronRightIcon className="size-5 shrink-0 text-ink-faint" />
    </button>
  );
}

function ThresholdSheet({
  open,
  initialPct,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialPct: number;
  onClose: () => void;
  onSaved: (pct: number) => void;
}) {
  const [input, setInput] = useState(String(initialPct));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setInput(String(initialPct));
      setError(null);
    }
  }, [open, initialPct]);

  const save = () => {
    const pct = parseThreshold(input);
    if (pct === null) {
      setError(THRESHOLD_ERROR);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveVisitThresholdAction(pct);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        if (result.source !== "setting") {
          setError(`That didn't store. Removals still use ${result.savedPct}%.`);
          return;
        }
        onSaved(result.savedPct);
      } catch {
        setError("That didn't save. Check your signal, then try again.");
      }
    });
  };

  return (
    <Sheet
      open={open}
      title="Rotation threshold"
      onClose={onClose}
      footer={
        <Button type="submit" form="threshold-form" className="w-full" disabled={pending}>
          {pending ? "Saving…" : "Save threshold"}
        </Button>
      }
    >
      <form
        id="threshold-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label htmlFor="threshold" className="block px-1 text-admin-section">
          Share of doors worked
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="threshold"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={input}
            aria-invalid={error !== null}
            aria-describedby="threshold-help"
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
            }}
            onBlur={() => setError(input.trim() === "" || parseThreshold(input) !== null ? null : THRESHOLD_ERROR)}
            data-autofocus
            className={`min-h-12 w-28 rounded-field-md border bg-surface px-3 text-admin-body tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop ${
              error ? "border-oxide" : "border-line"
            }`}
          />
          <span className="text-admin-body text-ink-muted">%</span>
        </div>
        {error ? (
          <p role="alert" className="mt-2 px-1 text-admin-subhead text-oxide">
            {error}
          </p>
        ) : null}
        <p id="threshold-help" className="mt-3 px-1 text-admin-subhead text-ink-muted">
          A visit ended early counts toward rotation only above this share. Exactly this share does not count.
        </p>
      </form>
    </Sheet>
  );
}

function LoggingSheet({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: LoggingDefault;
  onClose: () => void;
  onSaved: (mode: LoggingDefault) => void;
}) {
  const [mode, setMode] = useState<LoggingDefault>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setMode(initial);
      setError(null);
    }
  }, [open, initial]);

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { data, error: rpcError } = await createClient().rpc("set_logging_default", { p_mode: mode });
        if (rpcError || (data !== "every_door" && data !== "exceptions")) {
          setError(rpcError?.code === "42501" ? "Only an admin can change this." : "That didn't save. Check your signal, then try again.");
          return;
        }
        onSaved(data);
      } catch {
        setError("That didn't save. Check your signal, then try again.");
      }
    });
  };

  return (
    <Sheet
      open={open}
      title="Logging default"
      subtitle="Canvassers can still switch on the You tab."
      onClose={onClose}
      footer={
        <Button className="w-full" onClick={save} disabled={pending || mode === initial}>
          {pending ? "Saving…" : "Save logging default"}
        </Button>
      }
    >
      <div role="radiogroup" aria-label="Logging default" className="overflow-hidden rounded-field-lg border border-line">
        {LOGGING_OPTIONS.map((option) => {
          const selected = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(option.value)}
              className="flex min-h-16 w-full items-center gap-3 border-t border-line px-4 py-3 text-left first:border-t-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-admin-body-strong">{option.label}</span>
                <span className="block text-admin-subhead text-ink-muted">{option.detail}</span>
              </span>
              <span className="flex size-6 shrink-0 items-center justify-center text-prop">{selected ? <CheckIcon className="size-5" /> : null}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-2 px-1 text-admin-subhead text-oxide">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
