"use client";

import { Segmented } from "@/components/admin/ui/segmented";
import { APPEARANCE_OPTIONS } from "@/lib/admin/nav";
import { setThemePref, useThemePref } from "@/lib/field/theme";

/**
 * UI-10 F4c (owner 2026-10-08, A28, A51). Light / Dark / System in the
 * drawer and the rail: the same choice as the field app's You tab, stored
 * on this device. Pages not yet rebuilt stay light whatever is picked.
 */
export function AppearanceControl() {
  const pref = useThemePref();
  return (
    <div className="px-2 py-2">
      <p className="mb-1.5 text-admin-section text-ink-muted">Appearance</p>
      <Segmented label="Appearance" options={APPEARANCE_OPTIONS} value={pref} onChange={setThemePref} />
    </div>
  );
}
