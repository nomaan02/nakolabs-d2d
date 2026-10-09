import Link from "next/link";

import { CanvasserProfile, type ProfileDoor, type ProfileLead } from "@/components/admin/team/canvasser-profile";
import { PageFailed } from "@/components/admin/ui/page-failed";
import { loadDoorLabels, loadPropNames } from "@/lib/admin/lookups";
import { NO_STATS, parseTeamPeriod, periodLine, periodWindow, personStats, recentDays, recentDoors, recentLeads, inWindow } from "@/lib/admin/team";
import { loadCanvasser } from "@/lib/admin/team-data";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Canvasser · nakolabs-d2d" };

/**
 * UI-10 F5c (owner A9; owner 2026-10-09: a full profile). `/admin/team/<id>`
 * with the same `?period=` as Team. Everything is worked out here; the
 * browser gets the figures and at most 10 leads, 14 days and 20 doors.
 */
export default async function CanvasserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const today = londonDate();
  const period = parseTeamPeriod(query.period);
  const window = periodWindow(period, today);
  const supabase = await createClient();
  const loaded = await loadCanvasser(supabase, id);

  if (!loaded.ok && loaded.missing) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-14 lg:px-10 lg:pt-8">
        <h1 className="text-admin-large-title">Not on the team</h1>
        <p className="mt-2 text-admin-body text-ink-soft">This link doesn&apos;t match anyone.</p>
        <Link href="/admin/team" className="mt-3 inline-flex min-h-11 items-center text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop">
          Open Team
        </Link>
      </main>
    );
  }
  if (!loaded.ok) return <PageFailed title="Team" message={loaded.message ?? "This profile didn't load."} />;

  const { person, knocks, leads } = loaded;
  const stats = personStats(knocks, leads, window).get(person.id) ?? NO_STATS;
  const allTime = period === "all" ? stats : (personStats(knocks, leads, periodWindow("all", today)).get(person.id) ?? NO_STATS);
  const doorRows = recentDoors(knocks, window);
  const leadRows = recentLeads(leads, window);
  const visitIds = [...new Set(knocks.filter((knock) => inWindow(knock.occurredAt, window)).map((knock) => knock.assignmentId))];
  for (const lead of leadRows) visitIds.push(lead.assignmentId);

  let props = new Map<string, string>();
  let labels = new Map<number, string>();
  try {
    [props, labels] = await Promise.all([
      loadPropNames(supabase, visitIds),
      loadDoorLabels(supabase, [...doorRows.map((door) => door.uprn), ...leadRows.map((lead) => lead.uprn)]),
    ]);
  } catch {
    // Names and labels are extras: the figures still show, doors fall back to their UPRN.
  }

  const doors: ProfileDoor[] = doorRows.map((door) => ({
    key: `${door.assignmentId}|${door.uprn}`,
    uprn: door.uprn,
    door: labels.get(door.uprn) ?? null,
    prop: props.get(door.assignmentId) ?? "Prop",
    outcome: door.outcome,
    occurredAt: door.occurredAt,
  }));
  const recent: ProfileLead[] = leadRows.map((lead) => ({
    id: lead.id,
    uprn: lead.uprn,
    door: labels.get(lead.uprn) ?? null,
    prop: props.get(lead.assignmentId) ?? "Prop",
    occurredAt: lead.occurredAt,
    status: lead.status,
  }));

  return (
    <CanvasserProfile
      person={person}
      period={period}
      periodText={periodLine(period, today)}
      today={today}
      stats={stats}
      allTime={allTime}
      days={recentDays(knocks, props, window)}
      doors={doors}
      leads={recent}
    />
  );
}
