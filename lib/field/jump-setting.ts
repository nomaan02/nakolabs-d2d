"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * GPS-LOCK GL-2 (owner G7, 2026-10-18). "Jump to me on reopen": on by
 * default, switched off per canvasser per phone in the You tab.
 * localStorage only; nothing here reaches Supabase.
 */

export type JumpSetting = "on" | "off";

export const JUMP_SETTINGS: ReadonlyArray<{ value: JumpSetting; label: string }> = [
  { value: "on", label: "Jump to me" },
  { value: "off", label: "Off" },
];

const key = (canvasserId: string) => `d2d.jumpOnReopen:${canvasserId}`;
/** Used when storage is blocked, so the choice still lasts for this page. */
const memory = new Map<string, JumpSetting>();

function read(canvasserId: string | null): JumpSetting {
  if (!canvasserId) return "on";
  const remembered = memory.get(canvasserId);
  if (remembered) return remembered;
  try {
    return localStorage.getItem(key(canvasserId)) === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("d2d.jumpOnReopen")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useJumpSetting(canvasserId: string | null): {
  setting: JumpSetting;
  setSetting: (value: JumpSetting) => void;
} {
  const setting = useSyncExternalStore(
    subscribe,
    () => read(canvasserId),
    () => "on" as const,
  );
  const setSetting = useCallback(
    (value: JumpSetting) => {
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
  return { setting, setSetting };
}
