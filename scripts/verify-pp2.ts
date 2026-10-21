/**
 * PP-2 (owner 2026-10-21): pure checks for "Pending a result" on the
 * Leads tab. No network, no database.
 * Run: npm run verify:pp2
 */
import { isPending, parseSeen, pendingLeads, pendingWhenLine, seenBlowouts, todaySubtitle } from "@/lib/field/pending";

let failed = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed += 1;
}

// ---- PP-2: Pending -----------------------------------------------------------

const NOW = new Date("2026-10-21T17:00:00Z");
const lead = (crm_id: string, status: string | null, appointment_at: string | null, created = "2026-10-19T10:00:00Z") => ({
  crm_id,
  status,
  appointment_at,
  crm_created_at: created,
});
const none = new Set<string>();
const AHEAD = "2026-10-22T17:00:00Z";
const PAST = "2026-10-20T17:00:00Z";

check("no result, before appointment → pending", isPending(lead("1", null, AHEAD), none, NOW));
check("UTC before appointment → pending", isPending(lead("2", "utc", AHEAD), none, NOW));
check("Re-App before appointment → pending", isPending(lead("3", "re_app", AHEAD), none, NOW));
check("Booked before appointment → pending", isPending(lead("4", "confirmed", AHEAD), none, NOW));
check("Uncontacted before appointment → pending", isPending(lead("5", "pending", AHEAD), none, NOW));
check("UTC after appointment → call-back", !isPending(lead("6", "utc", PAST), none, NOW));
check("no appointment time → call-back", !isPending(lead("7", null, null), none, NOW));
check("blowout, not seen → pending even after time", isPending(lead("8", "blowout", PAST), none, NOW));
check("blowout, seen → call-back", !isPending(lead("8", "blowout", PAST), new Set(["8"]), NOW));
check("sale never pending", !isPending(lead("9", "sale", AHEAD), none, NOW));
check("P&M never pending", !isPending(lead("10", "pm", AHEAD), none, NOW));
check("older than 14 days → not pending", !isPending(lead("11", null, AHEAD, "2026-10-06T10:00:00Z"), none, NOW));

const order = pendingLeads([lead("a", null, "2026-10-23T10:00:00Z"), lead("b", "blowout", PAST), lead("c", "utc", AHEAD)], none, NOW);
check("blowouts first, then soonest", order.map((l) => l.crm_id).join(",") === "b,c,a");
check(
  "seen blowouts go to call-backs once",
  seenBlowouts([lead("b", "blowout", PAST), lead("x", "blowout", PAST), lead("y", "utc", PAST)], new Set(["b", "x", "y"]), new Set(["x"]))
    .map((l) => l.crm_id)
    .join(",") === "b",
);
check("subtitle", todaySubtitle(4, 1) === "Today · 4 pending · 1 lead" && todaySubtitle(0, 0) === "Today · no leads yet" && todaySubtitle(null, null) === undefined);
check("subtitle while loading", todaySubtitle(0, null) === undefined && todaySubtitle(2, null) === "Today · 2 pending");
check("when line", pendingWhenLine(lead("b", "blowout", PAST), () => "Tue", NOW) === "Was due Tue" && pendingWhenLine(lead("c", "utc", AHEAD), () => "Thu", NOW) === "Appointment Thu");
check("seen store drops old and junk", (() => {
  const seen = parseSeen(JSON.stringify({ a: "2026-10-20T10:00:00Z", b: "2026-07-01T10:00:00Z", c: 5 }), NOW);
  return Object.keys(seen).join(",") === "a" && Object.keys(parseSeen("{bad", NOW)).length === 0;
})());

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
