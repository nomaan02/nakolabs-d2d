"use client";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { useFieldData } from "@/components/field/field-data-provider";
import { PropStatus } from "@/components/field/prop-status";
import { SyncStatus } from "@/components/field/sync-status";
import { SharedKnockNotice } from "@/components/field/shared-knock-notice";
import { ATTRIBUTION_LINES } from "@/lib/field/map-style";
import { setThemePref, useThemePref, type ThemePref } from "@/lib/field/theme";

const APPEARANCE: { value: ThemePref; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Name, role, sign out, and the queue depth and last-sync time Stage 7
 * exposed and had nowhere to put.
 *
 * Sign out sits in the top third on purpose. That band needs a grip change
 * to reach one-handed, which is exactly the friction an unrecoverable action
 * should have on a doorstep — signing out with unsent knocks is the one
 * mis-tap on this screen that costs the day's work.
 */
export function ProfileTab() {
  const { signedInAs, role, phase } = useFieldData();
  const themePref = useThemePref();

  return (
    <div className="h-full overflow-y-auto bg-worksheet" data-testid="profile-tab">
      <header className="border-b border-ink/15 bg-paper px-4 py-3">
        <h1 className="font-display text-lg tracking-tight">{signedInAs || "Signed in"}</h1>
        <p className="font-data text-xs uppercase tracking-wide text-ink-soft">{role}</p>
      </header>

      <section className="border-b border-ink/15 bg-paper px-4 py-3">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <div
          role="radiogroup"
          aria-label="Appearance"
          className="mt-2 flex gap-1 rounded-field-md border border-line bg-surface p-1"
        >
          {APPEARANCE.map((option) => {
            const selected = themePref === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setThemePref(option.value)}
                className={`min-h-tap-min flex-1 rounded-field-sm text-sm font-semibold ${
                  selected ? "bg-prop text-field-bg" : "text-ink"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          Auto follows your phone&apos;s light/dark setting. Saved on this phone.
        </p>
      </section>

      <section className="border-b border-ink/15 bg-paper px-4 py-3">
        <h2 className="text-sm font-semibold">Sync</h2>
        <SyncStatus />
        <SharedKnockNotice assignmentId={phase.kind === "ready" ? phase.assignment.assignment_id : null} />
      </section>

      <section className="border-b border-ink/15 bg-paper px-4 py-3">
        <h2 className="text-sm font-semibold">Today</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {phase.kind === "ready"
            ? `${phase.assignment.territory_name} · ${phase.assignment.door_count} doors`
            : "No prop loaded."}
        </p>
        <PropStatus />
      </section>

      <section className="border-b border-ink/15 bg-paper px-4 py-4" data-testid="profile-attribution">
        <h2 className="text-sm font-semibold">Map and data attribution</h2>
        <ul className="mt-2 space-y-2 text-xs leading-relaxed text-ink-soft">
          {ATTRIBUTION_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <div className="px-4 py-4">
        <SignOutButton className="min-h-11 w-full rounded-md border-2 border-ink bg-paper px-4 text-base font-medium text-ink" />
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          Anything still waiting to send is kept on this phone and goes out when you sign back in.
        </p>
      </div>
    </div>
  );
}
