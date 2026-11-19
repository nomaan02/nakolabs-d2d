"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * DIAL-1 (owner 2026-11-19). How the Logger takes an outcome: the radial
 * dial (Logger V2.1) or the outcome buttons down the right edge (V1). Dial
 * by default; the buttons stay as a per-phone fallback while the dial is
 * field tested. Saved per canvasser per phone, like "Jump to me"
 * (`jump-setting.ts`). localStorage only; nothing here reaches Supabase.
 */

export type LoggerStyle = "dial" | "buttons";

export const LOGGER_STYLES: ReadonlyArray<{ value: LoggerStyle; label: string }> = [
  { value: "dial", label: "Dial" },
  { value: "buttons", label: "Buttons" },
];

const key = (canvasserId: string) => `d2d.loggerStyle:${canvasserId}`;
/** Used when storage is blocked, so the choice still lasts for this page. */
const memory = new Map<string, LoggerStyle>();

function read(canvasserId: string | null): LoggerStyle {
  if (!canvasserId) return "dial";
  const remembered = memory.get(canvasserId);
  if (remembered) return remembered;
  try {
    return localStorage.getItem(key(canvasserId)) === "buttons" ? "buttons" : "dial";
  } catch {
    return "dial";
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("d2d.loggerStyle")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLoggerStyle(canvasserId: string | null): {
  style: LoggerStyle;
  setStyle: (value: LoggerStyle) => void;
} {
  const style = useSyncExternalStore(
    subscribe,
    () => read(canvasserId),
    () => "dial" as const,
  );
  const setStyle = useCallback(
    (value: LoggerStyle) => {
      if (!canvasserId) return;
      memory.set(canvasserId, value);
      try {
        localStorage.setItem(key(canvasserId), value);
      } catch {
        // Private mode or storage blocked: the choice lasts for this page only.
      }
      for (const listener of listeners) listener();
    },
    [canvasserId],
  );
  return { style, setStyle };
}
