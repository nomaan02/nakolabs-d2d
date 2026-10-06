"use client";

import { useState, useTransition } from "react";

import { LOGGING_MODES, parseLoggingMode, type LoggingMode } from "@/lib/field/logging-mode";
import { createClient } from "@/lib/supabase/client";

/**
 * UI-8 D2b (owner U8-4, 2026-10-06). The org default logging mode. Each
 * canvasser can still change it for themselves in the field app's You tab,
 * and team props always log every door.
 */
export function LoggingDefaultSetting({ initial }: { initial: LoggingMode }) {
  const [mode, setMode] = useState<LoggingMode>(initial);
  const [saved, setSaved] = useState<LoggingMode>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { data, error: rpcError } = await createClient().rpc("set_logging_default", { p_mode: mode });
        const stored = rpcError ? null : parseLoggingMode(data);
        if (!stored) {
          setError(
            rpcError?.code === "42501"
              ? "Only an admin can change this."
              : "That did not save. Refresh the page before trying again.",
          );
          return;
        }
        setSaved(stored);
        setMode(stored);
      } catch {
        setError("That request did not complete. Refresh the page before trying again.");
      }
    });
  };

  return (
    <section className="flex flex-col gap-4" data-testid="logging-default">
      <div>
        <h2 className="font-display text-[20px] font-semibold leading-tight text-ink">Logging default</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink">
          How canvassers log on a solo prop until they change it in the You tab. Team props always log
          every door.
        </p>
      </div>
      <div role="radiogroup" aria-label="Logging default" className="flex flex-col gap-2">
        {LOGGING_MODES.map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(option.value)}
              data-testid={`logging-default-${option.value}`}
              className={`flex min-h-11 w-full max-w-xs items-center border px-3 text-left font-data text-[12px] uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop ${
                selected ? "border-prop bg-prop text-paper" : "border-ink/25 bg-worksheet text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Exceptions only: canvassers tap the doors that answer. Doors they pass between two logs are
        marked Not In for them, and they can undo it.
      </p>
      <button
        type="button"
        onClick={save}
        disabled={pending || mode === saved}
        data-testid="logging-default-save"
        className="min-h-11 w-full max-w-xs bg-prop px-4 font-data text-[11px] uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {pending ? "Saving…" : "Save logging default"}
      </button>
      {error ? (
        <p className="text-[14px] text-oxide" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[14px] leading-relaxed text-ink" role="status" data-testid="logging-default-current">
          Current default: {LOGGING_MODES.find((option) => option.value === saved)?.label}.
        </p>
      )}
    </section>
  );
}
