"use client";

import { useSyncExternalStore } from "react";

/**
 * Light, dark, or follow the phone. Remembered on this device only.
 * A blocked store still applies for this visit, and falls back to Auto.
 */

export type ThemePref = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "d2d.theme";

export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#fbfaf8",
  dark: "#161a20",
};

function isThemePref(value: string | null): value is ThemePref {
  return value === "auto" || value === "light" || value === "dark";
}

function readStored(): ThemePref {
  try {
    if (typeof localStorage === "undefined") return "auto";
    const value = localStorage.getItem(STORAGE_KEY);
    return isThemePref(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

function writeStored(next: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode, or storage blocked. The in-memory choice still applies.
  }
}

let pref: ThemePref = readStored();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setThemePref(next: ThemePref): void {
  if (!isThemePref(next)) return;
  if (pref === next) return;
  pref = next;
  writeStored(next);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemePref {
  return pref;
}

function getServerSnapshot(): ThemePref {
  return "auto";
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function systemDarkQuery(): MediaQueryList | null {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    return window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return null;
  }
}

function subscribeSystem(listener: () => void): () => void {
  const media = systemDarkQuery();
  if (!media) return () => {};
  media.addEventListener("change", listener);
  return () => {
    media.removeEventListener("change", listener);
  };
}

function getSystemDark(): boolean {
  return systemDarkQuery()?.matches ?? false;
}

export function currentResolvedTheme(): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return getSystemDark() ? "dark" : "light";
}

function getSystemDarkServer(): boolean {
  return false;
}

export function useResolvedTheme(): ResolvedTheme {
  const choice = useThemePref();
  const systemDark = useSyncExternalStore(subscribeSystem, getSystemDark, getSystemDarkServer);
  if (choice === "dark") return "dark";
  if (choice === "light") return "light";
  return systemDark ? "dark" : "light";
}

/** Plain JS, no imports. Runs before first paint from the field layout. */
export const THEME_BOOT_SCRIPT =
  `(function(){try{var stored=localStorage.getItem("d2d.theme");var systemDark=false;try{systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;}catch(e){}var theme=stored==="light"?"light":stored==="dark"?"dark":(systemDark?"dark":"light");document.documentElement.dataset.fieldTheme=theme;}catch(e){try{document.documentElement.dataset.fieldTheme="light";}catch(e2){}}})();`;
