"use client";

import { useSyncExternalStore } from "react";

/**
 * The one 2D/3D choice for the Map tab and the Logger mini map.
 * Remembered on the device. A blocked store still applies for this tab.
 */

export type MapView = "2d" | "3d";

const STORAGE_KEY = "d2d.mapView";

function readStored(): MapView {
  try {
    if (typeof localStorage === "undefined") return "2d";
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
}

function writeStored(next: MapView): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode, or storage blocked. The in-memory choice still applies.
  }
}

let view: MapView = readStored();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setMapView(next: MapView): void {
  if (next !== "2d" && next !== "3d") return;
  if (view === next) return;
  view = next;
  writeStored(next);
  emit();
}

export function toggleMapView(): void {
  setMapView(view === "2d" ? "3d" : "2d");
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MapView {
  return view;
}

function getServerSnapshot(): MapView {
  return "2d";
}

export function useMapView(): MapView {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
