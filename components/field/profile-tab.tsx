"use client";

import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { MyResults } from "@/components/field/crm/my-results";
import { useFieldData } from "@/components/field/field-data-provider";
import { ChevronRightIcon } from "@/components/field/icons";
import { PropStatus } from "@/components/field/prop-status";
import { SyncStatus } from "@/components/field/sync-status";
import { SharedKnockNotice } from "@/components/field/shared-knock-notice";
import { FieldHeader, FieldPage } from "@/components/field/shell/field-header";
import { useCrmMe } from "@/lib/field/crm-data";
import { isTeamProp, LOGGING_MODES, useLoggingMode } from "@/lib/field/logging-mode";
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
  const { signedInAs, role, phase, canvasserId, team } = useFieldData();
  const themePref = useThemePref();
  const logging = useLoggingMode(canvasserId);
  const teamProp = isTeamProp(team);
  const crm = useCrmMe(canvasserId);
  const linked = crm.kind === "ready" && crm.data.name !== null;

  // FUI-1b (owner 2026-10-14, O3): the title sits in the fixed header; only
  // the sections scroll. CRM-5 C (Figma F3): my CRM results first when the
  // account is linked to the CRM (the drawer's "My results" lands here).
  return (
    <FieldPage
      testId="profile-tab"
      header={
        <FieldHeader
          title="You"
          subtitle={`${signedInAs || "Signed in"} · ${linked && crm.kind === "ready" && crm.data.branch ? crm.data.branch : role}`}
        />
      }
    >
      {linked && crm.kind === "ready" ? (
        <div id="my-results" className="scroll-mt-2 bg-field-bg pt-2 pb-2">
          <MyResults me={crm.data} />
        </div>
      ) : null}

      {/* UI-10 F6b (owner A30, 2026-10-10): an admin who went canvassing gets back in one tap. */}
      {role === "admin" ? (
        <Link
          href="/admin/today"
          className="flex min-h-tap-min items-center justify-between border-b border-line bg-surface px-4 text-sm font-semibold text-prop focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
          data-testid="profile-back-to-admin"
        >
          Back to admin
          <ChevronRightIcon className="size-5" />
        </Link>
      ) : null}

      <section className="border-b border-line bg-surface px-4 py-3">
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

      {/* UI-8 D2b (owner U8-4, 2026-10-06). Per canvasser, per phone. */}
      <section className="border-b border-line bg-surface px-4 py-3" data-testid="profile-logging">
        <h2 className="text-sm font-semibold">Logging</h2>
        <div
          role="radiogroup"
          aria-label="Logging"
          className="mt-2 flex gap-1 rounded-field-md border border-line bg-surface p-1"
        >
          {LOGGING_MODES.map((option) => {
            const selected = logging.mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => logging.setChoice(option.value)}
                data-testid={`logging-mode-${option.value}`}
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
          {logging.mode === "exceptions"
            ? "Tap only the doors that matter. Doors you pass between two logs are marked Not In for you, and Undo takes them back. A gap of 25+ doors or a new street asks first."
            : "Tap every door you knock."}{" "}
          {logging.choice === null ? "Your admin\u2019s default. " : ""}Saved on this phone.
        </p>
        {teamProp && logging.mode === "exceptions" ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-soft" data-testid="profile-logging-team">
            Today&apos;s prop is a team prop, so every door is tapped there.
          </p>
        ) : null}
      </section>

      <section className="border-b border-line bg-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Sync</h2>
        <SyncStatus />
        <SharedKnockNotice assignmentId={phase.kind === "ready" ? phase.assignment.assignment_id : null} />
      </section>

      <section className="border-b border-line bg-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Today</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {phase.kind === "ready"
            ? `${phase.assignment.territory_name} · ${phase.assignment.door_count} doors`
            : "No prop loaded."}
        </p>
        <PropStatus />
      </section>

      <section className="border-b border-line bg-surface px-4 py-4" data-testid="profile-attribution">
        <h2 className="text-sm font-semibold">Map and data attribution</h2>
        <ul className="mt-2 space-y-2 text-xs leading-relaxed text-ink-soft">
          {ATTRIBUTION_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <div className="px-4 py-4">
        <SignOutButton className="min-h-11 w-full rounded-field-sm border-2 border-ink bg-surface px-4 text-base font-medium text-ink" />
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          Anything still waiting to send is kept on this phone and goes out when you sign back in.
        </p>
      </div>
    </FieldPage>
  );
}
