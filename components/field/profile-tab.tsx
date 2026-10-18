"use client";

import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { MyResults } from "@/components/field/crm/my-results";
import { useFieldData } from "@/components/field/field-data-provider";
import { PropStatus } from "@/components/field/prop-status";
import { SyncStatus } from "@/components/field/sync-status";
import { SharedKnockNotice } from "@/components/field/shared-knock-notice";
import { useGeo } from "@/components/field/geo-provider";
import { FieldHeader, FieldPage } from "@/components/field/shell/field-header";
import { useCrmMe } from "@/lib/field/crm-data";
import { JUMP_SETTINGS, useJumpSetting } from "@/lib/field/jump-setting";
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
  const jump = useJumpSetting(canvasserId);
  const geo = useGeo();
  const locationOff = geo.status === "denied" || geo.status === "unavailable";
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

      <Group title="Logging" testId="profile-logging">
        <SwitchRow
          label="Logging"
          options={LOGGING_MODES}
          selected={logging.mode}
          onPick={(value) => logging.setChoice(value)}
          testIdFor={(value) => `logging-mode-${value}`}
        />
        <p className="mt-2 text-admin-caption text-ink-muted">
          {logging.mode === "exceptions"
            ? "Tap only the doors that matter. Doors you pass between two logs are marked Not In for you, and Undo takes them back. A gap of 25+ doors or a new street asks first."
            : "Tap every door you knock."}{" "}
          {logging.choice === null ? "Your admin\u2019s default. " : ""}Saved on this phone.
        </p>
        {teamProp && logging.mode === "exceptions" ? (
          <p className="mt-1 text-admin-caption text-ink-soft" data-testid="profile-logging-team">
            Today&apos;s prop is a team prop, so every door is tapped there.
          </p>
        ) : null}
      </Group>

      {/* GPS-LOCK GL-3 (owner G7, 2026-10-18; Figma "GPS-LOCK (2026-10-18)"). */}
      <Group title="Location" testId="profile-location">
        <SwitchRow
          label="When you come back to the app"
          options={JUMP_SETTINGS}
          selected={jump.setting}
          onPick={jump.setSetting}
          testIdFor={(value) => `jump-setting-${value}`}
        />
        <p className="mt-2 text-admin-caption text-ink-muted">
          {jump.setting === "on"
            ? "When you come back to the app, the Logger moves to the door nearest you on the route and tells you, with Undo. It never moves while you\u2019re using the screen."
            : "The Logger stays on its door. The Near you chip still suggests the door nearest you."}{" "}
          Saved on this phone.
        </p>
        {locationOff ? (
          <p className="mt-1 text-admin-caption text-ink-soft" data-testid="profile-location-off">
            Location is off on this phone, so the Logger can&apos;t find you.
          </p>
        ) : null}
      </Group>

      <Group title="Appearance">
        <SwitchRow label="Appearance" options={APPEARANCE} selected={themePref} onPick={setThemePref} />
        <p className="mt-2 text-admin-caption text-ink-muted">Auto follows your phone&apos;s light/dark setting. Saved on this phone.</p>
      </Group>

      <Group title="Sync">
        <SyncStatus />
        <SharedKnockNotice assignmentId={phase.kind === "ready" ? phase.assignment.assignment_id : null} />
      </Group>

      <Group title="Today">
        <p className="text-admin-body text-ink">
          {phase.kind === "ready"
            ? `${phase.assignment.territory_name} · ${phase.assignment.door_count} doors`
            : "No prop loaded."}
        </p>
        <PropStatus />
      </Group>

      <div className="px-4 pt-6">
        <SignOutButton className="min-h-12 w-full rounded-field-md border border-ink bg-surface px-4 text-admin-button text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop" />
        <p className="mt-2 text-admin-caption text-ink-muted">
          Anything still waiting to send is kept on this phone and goes out when you sign back in.
        </p>
      </div>

      <Group title="About" testId="profile-attribution">
        <ul className="space-y-2 text-admin-caption text-ink-muted">
          {ATTRIBUTION_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Group>
      <div aria-hidden className="h-6" />
    </FieldPage>
  );
}

/** A titled card, the same shape as the Logger's (Figma Y2). */
function Group({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-4" data-testid={testId}>
      <h2 className="mb-2 text-admin-section text-ink-muted">{title}</h2>
      <div className="rounded-field-lg border border-line bg-surface p-4">{children}</div>
    </section>
  );
}

/** One choice of a few, every option visible, 44px tall. */
function SwitchRow<T extends string>({
  label,
  options,
  selected,
  onPick,
  testIdFor,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: T;
  onPick: (value: T) => void;
  testIdFor?: (value: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-field-md bg-line p-1">
      {options.map((option) => {
        const on = option.value === selected;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(option.value)}
            data-testid={testIdFor?.(option.value)}
            className={`min-h-tap-min flex-1 rounded-field-sm text-admin-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
              on ? "bg-surface text-ink shadow-sm" : "text-ink-muted"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
