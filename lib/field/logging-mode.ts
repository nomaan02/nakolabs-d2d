"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * UI-8 D2b (owner H4, U8-4; 2026-10-06). The logging mode.
 *
 * - "every_door": today's behaviour. Every door is tapped.
 * - "exceptions": tap only the doors that matter. Doors passed between two
 *   tapped logs are filled as Not In (`lib/field/inference.ts`).
 *
 * The choice is per canvasser, per phone (localStorage). Until they choose,
 * the org default from `logging_default()` applies; the last value read is
 * cached so it works offline. Team props are ALWAYS "every_door": a filled
 * door could be one the partner has not reached yet.
 *
 * Read-only: `logging_default()` is a read. Nothing here writes to Supabase.
 */

export type LoggingMode = "every_door" | "exceptions";

export const LOGGING_MODES: ReadonlyArray<{ value: LoggingMode; label: string }> = [
  { value: "every_door", label: "Tap every door" },
  { value: "exceptions", label: "Exceptions only" },
];

const DEFAULT_KEY = "d2d.loggingDefault";
const choiceKey = (canvasserId: string) => `d2d.loggingMode:${canvasserId}`;

export function parseLoggingMode(value: unknown): LoggingMode | null {
  return value === "every_door" || value === "exceptions" ? value : null;
}

/** A team prop: any other active member, or any door a teammate has knocked. */
export function isTeamProp(team: {
  teammates: ReadonlyArray<unknown>;
  knockedBy: ReadonlyMap<number, unknown>;
}): boolean {
  return team.teammates.length > 0 || team.knockedBy.size > 0;
}

function read(key: string): LoggingMode | null {
  try {
    return parseLoggingMode(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key: string, value: LoggingMode | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or storage blocked: the choice lasts for this page only.
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("d2d.logging")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

let defaultRequested = false;

/** Refresh the cached org default once per page load. Offline or failing: keep the cache. */
function refreshDefault(): void {
  if (defaultRequested) return;
  defaultRequested = true;
  void (async () => {
    try {
      const { data, error } = await createClient().rpc("logging_default");
      const mode = error ? null : parseLoggingMode(data);
      if (mode && mode !== read(DEFAULT_KEY)) {
        write(DEFAULT_KEY, mode);
        emit();
      }
    } catch {
      defaultRequested = false;
    }
  })();
}

export type LoggingModeState = {
  /** The mode this phone uses on a solo prop. */
  mode: LoggingMode;
  /** What this canvasser picked on this phone; null = following the org default. */
  choice: LoggingMode | null;
  orgDefault: LoggingMode;
  setChoice: (mode: LoggingMode) => void;
};

export function useLoggingMode(canvasserId: string | null): LoggingModeState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${canvasserId ? (read(choiceKey(canvasserId)) ?? "") : ""}|${read(DEFAULT_KEY) ?? ""}`,
    () => "|",
  );

  useEffect(() => {
    refreshDefault();
  }, []);

  const setChoice = useCallback(
    (mode: LoggingMode) => {
      if (!canvasserId) return;
      write(choiceKey(canvasserId), mode);
      emit();
    },
    [canvasserId],
  );

  const [choiceText, defaultText] = snapshot.split("|");
  const choice = parseLoggingMode(choiceText);
  const orgDefault = parseLoggingMode(defaultText) ?? "every_door";
  return { mode: choice ?? orgDefault, choice, orgDefault, setChoice };
}
