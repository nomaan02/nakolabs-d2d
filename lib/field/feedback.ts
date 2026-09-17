"use client";

import { useCallback, useRef } from "react";

/**
 * A logged door is confirmed on two channels, not one. In bright sun, or
 * glanced at mid-conversation with a resident, a colour change alone is
 * missable; the pulse is felt whether or not the screen is being watched.
 */
export function pulse(ms = 40): void {
  if (typeof navigator === "undefined") return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  try {
    vibrate(ms);
  } catch {
    // iOS Safari has no vibrate. The visual change still happens.
  }
}

export const INPUT_LOCK_MS = 400;

/**
 * Eats an unintended repeat tap. Cold or wet fingers mis-register, and a
 * canvasser is often not looking at the screen as they tap, so a double tap
 * in the rain must log one door rather than two.
 *
 * This is not a confirmation step — the brief is explicit that one tap logs.
 */
export function useInputLock(lockMs: number = INPUT_LOCK_MS) {
  const lockedUntil = useRef(0);

  return useCallback(
    (action: () => void): boolean => {
      const now = Date.now();
      if (now < lockedUntil.current) return false;
      lockedUntil.current = now + lockMs;
      action();
      return true;
    },
    [lockMs],
  );
}
