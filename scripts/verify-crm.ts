/**
 * CRM-1: browser-free checks for the CRM pull (no network, no database).
 *   - lib/crm/parse.ts parsing (postcode, street line, first name, status, times)
 *   - lib/crm/client.ts refuses anything but a read
 *   - the repo stays read-only towards the CRM: only lib/crm/client.ts calls
 *     webservice.php, and it names no write operation
 *
 *   npm run verify:crm
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { assertReadOnlyCall, CRM_READ_OPERATIONS } from "../lib/crm/client";
import {
  appointmentToIso,
  decodeCrmText,
  canvasserFirstName,
  CRM_LEAD_FIELDS,
  crmStampToIso,
  isoToCrmStamp,
  mapCrmStatus,
  normaliseCrmPostcode,
  parseCrmLead,
  parseStreetLine,
  postcodeSector,
  saleAmount,
  type AppCrmStatus,
} from "../lib/crm/parse";
import { recordUnchanged } from "../lib/crm/sync";

let failures = 0;
function check(name: string, ok: boolean): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("CRM postcode");
check("normalise with and without space", normaliseCrmPostcode("bs78ab") === "BS7 8AB" && normaliseCrmPostcode(" BS7  8AB ") === "BS7 8AB" && normaliseCrmPostcode("BS15 4QQ") === "BS15 4QQ");
check("outward only or junk -> null", normaliseCrmPostcode("BS7") === null && normaliseCrmPostcode("n/a") === null && normaliseCrmPostcode(null) === null);
check("sector", postcodeSector("BS7 8AB") === "BS7 8" && postcodeSector("BS15 4QQ") === "BS15 4" && postcodeSector(null) === null);

console.log("\nCRM street line");
check("plain", same(parseStreetLine("23 Upton Road"), { number: 23, suffix: "", street: "Upton Road" }));
check("letter", same(parseStreetLine("23a Upton Road"), { number: 23, suffix: "A", street: "Upton Road" }));
check("range takes the first number", same(parseStreetLine("21-23 Upton Road"), { number: 21, suffix: "", street: "Upton Road" }));
check("comma after number", same(parseStreetLine("23, Upton Road"), { number: 23, suffix: "", street: "Upton Road" }));
check("town after comma dropped", same(parseStreetLine("23 Upton Road, Bishopston"), { number: 23, suffix: "", street: "Upton Road" }));
check("multi-line keeps the first line", same(parseStreetLine("23 Upton Road\nBishopston\nBristol"), { number: 23, suffix: "", street: "Upton Road" }));
check("number on its own line", same(parseStreetLine("23\nUpton Road"), { number: 23, suffix: "", street: "Upton Road" }));
check("flat prefix", same(parseStreetLine("Flat 2, 23 Upton Road"), { number: 23, suffix: "", street: "Upton Road" }));
check("house name only", same(parseStreetLine("Rose Cottage"), { number: null, suffix: "", street: "Rose Cottage" }));
check("apostrophe street", parseStreetLine("9 St John’s Road").street === "St John’s Road");
check("blank", same(parseStreetLine(""), { number: null, suffix: "", street: null }) && same(parseStreetLine(null), { number: null, suffix: "", street: null }));

console.log("\nCRM people, money, status");
check("first name only, tidied", canvasserFirstName("JOHN smith") === "John" && canvasserFirstName("  amy-lee  jones") === "Amy-lee" && canvasserFirstName("") === null && canvasserFirstName("123") === null);
check("sale amount", saleAmount("8400.00000000") === 8400 && saleAmount("£1,250.50") === 1250.5 && saleAmount("0.00") === null && saleAmount("") === null && saleAmount("x") === null);
const map = new Map<string, AppCrmStatus>([["Sold", "sale"], ["Booked", "confirmed"], ["Uncontacted", "pending"]]);
check("mapped status", same(mapCrmStatus("Sold", map), { status_raw: "Sold", status: "sale", unknown: false }) && mapCrmStatus("Booked", map).status === "confirmed");
check("blank status = No outcome", same(mapCrmStatus("  ", map), { status_raw: null, status: null, unknown: false }));
check("unknown status kept raw, never guessed", same(mapCrmStatus("Sold!", map), { status_raw: "Sold!", status: null, unknown: true }));

check("HTML entities decoded", decodeCrmText("Pitch&amp;Miss") === "Pitch&Miss" && decodeCrmText("St Mary&#039;s Road") === "St Mary's Road" && decodeCrmText("O&#x27;Neil") === "O'Neil" && decodeCrmText("&bogus;") === "&bogus;" && decodeCrmText(null) === null);
check("sale amount that rounds to 0 or overflows -> null", saleAmount("0.004") === null && saleAmount("99999999999") === null);

console.log("\nCRM times");
check("UTC stamp", crmStampToIso("2026-10-10 10:46:43", "UTC") === "2026-10-10T10:46:43.000Z");
check("London summer stamp", crmStampToIso("2026-10-10 10:46:43", "Europe/London") === "2026-10-10T09:46:43.000Z");
check("London winter stamp", crmStampToIso("2026-01-15 10:00:00", "Europe/London") === "2026-01-15T10:00:00.000Z");
check("one-digit hour and 12-hour times", appointmentToIso("2026-10-12", "9:05") === "2026-10-12T08:05:00.000Z" && appointmentToIso("2026-10-12", "2:30 PM") === "2026-10-12T13:30:00.000Z" && appointmentToIso("2026-10-12", "12:00 AM") === "2026-10-11T23:00:00.000Z");
check("impossible time or date -> null", crmStampToIso("2026-10-12 25:00:00", "UTC") === null && crmStampToIso("2026-02-31 10:00:00", "UTC") === null && crmStampToIso("2026-13-01", "UTC") === null && appointmentToIso("2026-10-12", "13:00 PM") === null);
check("bad stamp -> null", crmStampToIso("10/10/2026", "UTC") === null && crmStampToIso("", "UTC") === null);
check("round trip for modified-since", isoToCrmStamp("2026-10-10T09:46:43.000Z", "Europe/London") === "2026-10-10 10:46:43" && isoToCrmStamp("2026-10-10T09:46:43.000Z", "UTC") === "2026-10-10 09:46:43");
check("appointment is London wall time", appointmentToIso("2026-10-12", "18:30:00") === "2026-10-12T17:30:00.000Z" && appointmentToIso("2026-12-01", "") === "2026-12-01T00:00:00.000Z" && appointmentToIso("", "10:00") === null);

console.log("\nCRM lead row");
check("encoded status maps after decoding", parseCrmLead({ id: "y", leadstatus: "Booked&nbsp;", createdtime: "2026-10-10 10:00:00", modifiedtime: "2026-10-10 10:00:00" }, map, "UTC").status === "confirmed");
const lead = parseCrmLead(
  { id: "10x5", lead_no: "LEA5", lane: "23a Upton Rd", code: "bs78ab", leadstatus: "Booked", createdtime: "2026-10-10 10:00:00", modifiedtime: "2026-10-10 11:00:00", cf_855: "2026-10-12", cf_857: "18:30:00", cf_861: "0.00", cf_865: "JOHN smith", cf_879: "First Bristol" },
  map,
  "UTC",
);
check("parsed lead stores no street or number", !("lane" in lead) && lead.match.street === "Upton Rd" && lead.match.number === 23 && lead.match.suffix === "A");
check("parsed lead fields", lead.postcode === "BS7 8AB" && lead.postcode_sector === "BS7 8" && lead.status === "confirmed" && lead.sale_amount === null && lead.canvasser_first_name === "John" && lead.branch === "First Bristol");
check("unreadable created time throws", throws(() => parseCrmLead({ id: "x", createdtime: "", modifiedtime: "2026-10-10 11:00:00" }, map, "UTC")));
check("no name, phone, note or best-time field is ever requested", !CRM_LEAD_FIELDS.some((f) => ["firstname", "lastname", "phone", "cf_1014", "cf_1016", "description", "cf_867", "cf_881"].includes(f)));

console.log("\nCRM idempotency compare");
const rec = { crm_id: "10x5", lead_no: "LEA5", status_raw: "Sold", status: "sale" as const, crm_created_at: "2026-10-10T10:00:00.000Z", crm_modified_at: "2026-10-10T11:00:00.000Z", appointment_at: null, branch: "First Bristol", sale_amount: 8400, postcode: "BS7 8AB", postcode_sector: "BS7 8", uprn: 1, location: "SRID=4326;POINT(0 0)", match_tier: "exact" as const, canvasser_first_name: "John" };
const { location: _loc, ...storedRec } = rec;
void _loc;
const storedPoint = { type: "Point", coordinates: [0, 0] };
check("same values in database shape -> unchanged", recordUnchanged(rec, { ...storedRec, location: storedPoint, crm_created_at: "2026-10-10T10:00:00+00:00", crm_modified_at: "2026-10-10T11:00:00+00:00", sale_amount: "8400.00" as unknown as number }));
check("stored point in an unexpected format -> changed", !recordUnchanged(rec, { ...storedRec, location: "0101000020E6100000" }));
check("moved point -> changed", !recordUnchanged(rec, { ...storedRec, location: { type: "Point", coordinates: [0.0001, 0] } }));
check("changed status -> changed", !recordUnchanged(rec, { ...storedRec, location: storedPoint, status: "pm", status_raw: "Pitch&Miss" }));

console.log("\nCRM read-only guard");
check("only read operations listed", CRM_READ_OPERATIONS.join() === "getchallenge,login,listtypes,describe,query,logout");
for (const op of ["create", "update", "delete", "revise", "convertlead", "sync_write", ""]) {
  check(`refuses operation "${op}"`, throws(() => assertReadOnlyCall(op)));
}
check("allows a SELECT on Leads", !throws(() => assertReadOnlyCall("query", "SELECT id FROM Leads LIMIT 0, 100;")));
check("refuses a non-SELECT query", throws(() => assertReadOnlyCall("query", "UPDATE Leads SET x = 1;")));
check("refuses two statements", throws(() => assertReadOnlyCall("query", "SELECT id FROM Leads; SELECT id FROM Leads;")));
check("refuses other modules", throws(() => assertReadOnlyCall("query", "SELECT id FROM Users;")));

console.log("\nCRM repo scan");
const root = process.cwd();
const skip = new Set(["node_modules", ".next", ".git", ".handoff", "public"]);
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) files.push(full);
  }
};
for (const dir of ["app", "lib", "components", "scripts", "middleware.ts"]) {
  const full = path.join(root, dir);
  try {
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  } catch {
    // folder not present
  }
}
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
const self = "scripts/verify-crm.ts";
const callers = files.filter((f) => rel(f) !== self && readFileSync(f, "utf8").includes("webservice.php")).map(rel);
check("only lib/crm/client.ts names webservice.php", same(callers, ["lib/crm/client.ts"]));
const clientSource = readFileSync(path.join(root, "lib/crm/client.ts"), "utf8");
check("client names no write operation", !/["'`](create|update|delete|revise|convertlead)["'`]/i.test(clientSource));
const publicKey = files.filter((f) => rel(f) !== self && /NEXT_PUBLIC_CRM/.test(readFileSync(f, "utf8"))).map(rel);
check("no NEXT_PUBLIC_ CRM variable anywhere", publicKey.length === 0);
const fieldImports = files.filter((f) => rel(f).startsWith("app/(field)") || rel(f).startsWith("components/field")).filter((f) => /lib\/crm|crm_leads/.test(readFileSync(f, "utf8"))).map(rel);
check("no /field file reads CRM data", fieldImports.length === 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
