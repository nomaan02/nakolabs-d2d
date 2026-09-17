"use client";

import { useSyncExternalStore } from "react";

import { cancelHeld, UNDO_WINDOW_MS } from "@/lib/sync/queue";

/**
 * The single undo target. One at a time by design: a stack of undos on a
 * doorstep is a way to undo the wrong thing.
 *
 * The toast is a view of this; the actual grace period belongs to the outbox
 * row's `held_undo` status, so a force-quit and reopen cannot leave a row
 * both un-undoable and unsent.
 */

export type UndoTarget = {
  clientEventId: string;
  /** "No answer · 38 Small Street" — what the canvasser will recognise. */
  description: string;
  expiresAt: number;
};

let target: UndoTarget | null = null;
const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function clearExpiry() {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

export function offerUndo(clientEventId: string, description: string): void {
  clearExpiry();
  target = { clientEventId, description, expiresAt: Date.now() + UNDO_WINDOW_MS };
  emit();
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (target?.clientEventId === clientEventId) {
      target = null;
      emit();
    }
  }, UNDO_WINDOW_MS);
}

export function dismissUndo(): void {
  clearExpiry();
  if (target === null) return;
  target = null;
  emit();
}

/** Delete the held row. Returns false if the window had already closed. */
export async function takeUndo(): Promise<boolean> {
  const current = target;
  if (!current) return false;
  const undone = await cancelHeld(current.clientEventId);
  dismissUndo();
  return undone;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UndoTarget | null {
  return target;
}

function getServerSnapshot(): UndoTarget | null {
  return null;
}

export function useUndoTarget(): UndoTarget | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
