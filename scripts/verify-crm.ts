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
  CRM_PRICE_TEXT_FIELDS,
  CRM_CONTACT_FIELDS,
  callbackReason,
  tidyName,
  tidyPhone,
  crmStampToIso,
  leadSaleAmount,
  priceInText,
  isoToCrmStamp,
  mapCrmStatus,
  normaliseCrmPostcode,
  parseCrmLead,
  parseStreetLine,
  postcodeSector,
  saleAmount,
  type AppCrmStatus,
} from "../lib/crm/parse";
import { cronAuthorised, lastSuccess, nextCursor, runInProgress, syncFreshness, whenWords, type SyncRun } from "../lib/crm/schedule";
import { keepsContact, purgeAfter, recordUnchanged } from "../lib/crm/sync";
import { CRM_CALLBACK_GROUP, validateOp, type CrmCallbackOp } from "../lib/sync/ops";
import { sendOp } from "../lib/sync/queue";
import { accountLabel, loginEmail, usernameFrom, USERNAME_DOMAIN } from "../lib/auth/username";
import { parseArgs as parseAccountArgs, temporaryPassword } from "./create-accounts";
import * as fieldCrm from "../lib/field/crm";
import {
  areaRankings,
  axisTicks,
  columnReadout,
  leadSplit,
  otherBreakdown,
  longerPeriod,
  parseInsightsView,
  periodOptions,
  rateFigures,
  heroFigures,
  sortedProps,
  confirmedByDay,
  confirmedPlace,
  crmHref,
  crmWindow,
  crmWindowBounds,
  crmWindowLine,
  minLeadsForAreas,
  outcomeColumns,
  parseCrmInsights,
  parseCrmPeriod,
  percent,
  pitchToSale,
  pounds,
  poundsShort,
  propRows,
  sitRate,
} from "../lib/admin/crm-insights";
import {
  cellBox,
  cellSquare,
  crmDoorTally,
  doorsInCell,
  heatCellFigures,
  crmChip,
  crmDoorCounts,
  crmDoorGroup,
  crmDoorLatest,
  crmViewDoorFilter,
  crmViewKind,
  filterCrmDoors,
  heatStep,
  parseCrmDoors,
  parseCrmView,
  parseHeatCells,
  withCrmView,
} from "../lib/admin/crm-map";

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
check("first name, email, notes and best time are never requested", !CRM_LEAD_FIELDS.some((f) => ["firstname", "mobile", "email", "cf_1016", "description", "salutationtype"].includes(f)));
check("CRM-5: the only contact fields read are title, surname and the two phones", same([...CRM_CONTACT_FIELDS], ["cf_877", "lastname", "phone", "cf_1014"]) && CRM_CONTACT_FIELDS.every((f) => (CRM_LEAD_FIELDS as readonly string[]).includes(f)));
check("the only free-text boxes read are Result and Rep Result (for a price)", same([...CRM_PRICE_TEXT_FIELDS], ["cf_867", "cf_881"]) && CRM_PRICE_TEXT_FIELDS.every((f) => (CRM_LEAD_FIELDS as readonly string[]).includes(f)));

console.log("\nCRM-3 sale price from Sale Amount, Result, Rep Result");
check("£ amount in Result", priceInText("Bristol Earl £2534") === 2534 && priceInText("Bristol\nCharlotte\n£5015") === 5015 && priceInText("Bristol £18,333 Mario") === 18333 && priceInText("£ 4166 Bruno") === 4166);
check("£ amount wins over an earlier bare number", priceInText("text 4792 then £2493 Earl 9:10") === 2493);
check("bare number when there is no £", priceInText("Bristol 4792 Ryan H") === 4792 && priceInText("Bristol 6250 Charlotte Robin") === 6250 && priceInText("Bristol 3196 Charlotte Robins") === 3196);
check("times are not prices", priceInText("11:57 1:11 2:30 3:21") === null && priceInText("11.45") === null && priceInText("Bristol Bruno £4910 text 12:53 16:39") === 4910);
check("phone numbers are not prices", priceInText("07583345144") === null && priceInText("0117 9649658") === null && priceInText("call 01179 649658") === null);
check("small and huge numbers are not prices", priceInText("Bristol 2 windows") === null && priceInText("1x bay 3 units") === null && priceInText("£50") === null && priceInText("250") === null && priceInText("£250000") === null);
check("blank or words only -> null", priceInText("") === null && priceInText(null) === null && priceInText("Bristol Bruno") === null);
check("Sale Amount first", same(leadSaleAmount("sale", "8400.00", "Bristol £5015", null), { amount: 8400, source: "sale_amount" }));
check("then Result, then Rep Result, Sold only", same(leadSaleAmount("sale", "0.00", "Bristol £5015", "£1"), { amount: 5015, source: "result" }) && same(leadSaleAmount("sale", "", "Bristol Bruno", "Rep £3,750"), { amount: 3750, source: "rep_result" }) && same(leadSaleAmount("sale", null, "", ""), { amount: null, source: null }));
check("never read a price from text on a lead that is not Sold", same(leadSaleAmount("pm", null, "Bristol Bruno £4000", "£4000"), { amount: null, source: null }) && same(leadSaleAmount(null, null, "£4000", null), { amount: null, source: null }));
const resultText = "Bristol Charlotte £5015";
const sold = parseCrmLead({ id: "10x9", leadstatus: "Sold", createdtime: "2026-10-08 10:00:00", modifiedtime: "2026-10-08 11:00:00", cf_861: "0.00000000", cf_867: resultText, cf_881: "Rep note" }, new Map([["Sold", "sale"]]), "UTC");
check("Sold lead takes its price from Result", sold.sale_amount === 5015 && sold.sale_amount_source === "result");
check("Result and Rep Result text never leave the parser", !Object.values(sold).some((v) => typeof v === "string" && (v.includes("Charlotte") || v.includes("Rep note"))) && !JSON.stringify(sold).includes("Charlotte"));

console.log("\nCRM-5 call-back list");
check("UTC, no outcome and Re-App are call-backs", callbackReason("utc", false, "", "") === "utc" && callbackReason(null, false, null, null) === "no_outcome" && callbackReason("re_app", false, "", "") === "reapp");
check("sold, P&M and booked are not call-backs", callbackReason("sale", false, "call back", "") === null && callbackReason("pm", false, "single sit", "") === null && callbackReason("confirmed", false, "", "") === null);
check("unknown status is never a call-back", callbackReason(null, true, "", "") === null);
check("blowout reasons from the notes", callbackReason("blowout", false, "Bristol\nhubby at work, single sit", "") === "single_sit" && callbackReason("blowout", false, "wasn't convenient", "") === "not_convenient" && callbackReason("blowout", false, "too busy today", "") === "no_time" && callbackReason("blowout", false, "RTA", "") === "rta" && callbackReason("blowout", false, "call back next week", "") === "rearrange" && callbackReason("blowout", false, "no answer at door", "") === "no_answer" && callbackReason("blowout", false, "utc 3:21", "") === "utc");
check("Rep Result notes count too", callbackReason("blowout", false, "", "single sit") === "single_sit");
check("a blowout with no reason is not a call-back", callbackReason("blowout", false, "Bristol Earl", "") === null && callbackReason("blowout", false, "", "") === null);
check("TITC / RITC / cancelled always keep it off", callbackReason("blowout", false, "TITC call back next week", "") === null && callbackReason("utc", false, "ritc", "") === null && callbackReason(null, false, "cancelled", "") === null && callbackReason("blowout", false, "single sit", "Cancelled by office") === null);
check("not interested / changed mind / wrong number / already done keep it off", callbackReason("utc", false, "not interested", "") === null && callbackReason("blowout", false, "changed her mind, call back", "") === null && callbackReason("utc", false, "wrong number", "") === null && callbackReason("blowout", false, "had windows done within 5 years", "") === null && callbackReason("re_app", false, "already had it done", "") === null);
check("'not in' is not 'not interested'", callbackReason("blowout", false, "not in when rep came", "") === "no_answer");
check("phones tidied", tidyPhone("07700 900 123") === "07700900123" && tidyPhone("+44 7700 900123") === "+447700900123" && tidyPhone("") === null && tidyPhone("123") === null && tidyPhone(null) === null);
check("names tidied", tidyName("SMITH") === "Smith" && tidyName("o'neil-jones") === "O'Neil-Jones" && tidyName("McDonald") === "McDonald" && tidyName("  ") === null && tidyName("MR AND MRS") === "Mr And Mrs");
const cbLead = parseCrmLead({ id: "10x77", leadstatus: "UTC", createdtime: "2026-10-01 10:00:00", modifiedtime: "2026-10-01 11:00:00", cf_877: "MRS", lastname: "ashworth", phone: "07700 900001", cf_1014: "" }, new Map([["UTC", "utc"]]), "UTC");
check("contact parsed: title, surname, phone (no first name anywhere)", cbLead.callback_reason === "utc" && cbLead.contact.title === "Mrs" && cbLead.contact.surname === "Ashworth" && cbLead.contact.phone === "07700900001" && cbLead.contact.alt_phone === null && !JSON.stringify(cbLead).includes("firstname"));
const altOnly = parseCrmLead({ id: "10x78", leadstatus: "UTC", createdtime: "2026-10-01 10:00:00", modifiedtime: "2026-10-01 11:00:00", phone: "", cf_1014: "0117 900 0000" }, new Map([["UTC", "utc"]]), "UTC");
check("alt phone is used when the main phone is blank", altOnly.contact.phone === "01179000000" && altOnly.contact.alt_phone === null);
const NOW5 = new Date("2026-10-11T12:00:00Z");
check("contacts kept only for call-backs under 90 days old", keepsContact({ callback_reason: "utc", crm_created_at: "2026-09-01T10:00:00Z" }, NOW5) && !keepsContact({ callback_reason: "utc", crm_created_at: "2026-07-01T10:00:00Z" }, NOW5) && !keepsContact({ callback_reason: null, crm_created_at: "2026-10-10T10:00:00Z" }, NOW5));
check("purge date = lead date + 90 days", purgeAfter("2026-10-01T10:00:00Z") === "2026-12-30");

console.log("\nCRM-5 B call results through the offline queue");
const CB_ID = "3f0c1d9e-4a6b-4c2d-9e8f-1a2b3c4d5e6f";
const ME = "00000000-0000-0000-0000-00000000000c";
const cbOp = (over: Partial<CrmCallbackOp["payload"]["callback"]> = {}, opOver: Partial<CrmCallbackOp> = {}): CrmCallbackOp => ({
  kind: "crm_callback",
  client_event_id: CB_ID,
  assignment_id: CRM_CALLBACK_GROUP,
  canvasser_id: ME,
  ...opOver,
  payload: { callback: { client_event_id: CB_ID, crm_id: "10x5", canvasser_id: ME, result: "no_answer", call_back_on: null, called_at: "2026-10-11T12:00:00.000Z", ...over } },
});
check("a plain call result is valid", validateOp(cbOp()) === null);
check("'later' needs a date, others must not carry one", validateOp(cbOp({ result: "later", call_back_on: "2026-10-14" })) === null && validateOp(cbOp({ result: "later" })) !== null && validateOp(cbOp({ result: "later", call_back_on: "14/10/2026" })) !== null && validateOp(cbOp({ call_back_on: "2026-10-14" })) !== null);
check("unknown result refused", validateOp(cbOp({ result: "sold" as never })) !== null);
check("ids must agree with the op", validateOp(cbOp({ client_event_id: "other" })) !== null && validateOp(cbOp({ canvasser_id: "other" })) !== null && validateOp(cbOp({}, { assignment_id: "a-prop" })) !== null);
check("crm_id must look like a CRM lead id", validateOp(cbOp({ crm_id: "LEA123" })) !== null);
console.log("\nCRM-5 U username accounts");
check("a username becomes a reserved-domain email", loginEmail(" Thomas ") === `thomas@${USERNAME_DOMAIN}` && USERNAME_DOMAIN.endsWith(".invalid"));
check("a real email is used as typed", loginEmail("Someone@Gmail.com") === "someone@gmail.com");
check("junk is refused", loginEmail("") === null && loginEmail("1abc") === null && loginEmail("a") === null && loginEmail("tom smith") === null);
check("username shown instead of the hidden email", usernameFrom(`tyron@${USERNAME_DOMAIN}`) === "tyron" && usernameFrom("a@gmail.com") === null && accountLabel(`tito@${USERNAME_DOMAIN}`) === "tito" && accountLabel("a@gmail.com") === "a@gmail.com" && accountLabel(null) === "");
const acc = parseAccountArgs(["--branch", "HO Bristol", "--user", "Thomas:Thomas:canvasser", "--user", "wayne:Wayne:admin", "--link", "me@gmail.com:Nomaan"]);
check("accounts script reads users, links and branch", acc.write === false && acc.branch === "HO Bristol" && acc.accounts.length === 3 && acc.accounts[0]?.email === `thomas@${USERNAME_DOMAIN}` && acc.accounts[1]?.kind === "user" && acc.accounts[2]?.kind === "link");
const refuses = (args: string[]) => { try { parseAccountArgs(args); return false; } catch { return true; } };
check("accounts script refuses bad input", refuses(["--user", "tom:Tom"]) && refuses(["--user", "tom:Tom:boss"]) && refuses(["--user", "tom:Tom:canvasser", "--user", "tom:Thomas:canvasser"]) && refuses(["--user", "a:Tom:canvasser", "--user", "b:tom:canvasser"]) && refuses(["--link", "nomaan:Nomaan"]) && refuses(["--user"]));
const pw = Array.from({ length: 50 }, () => temporaryPassword());
check("temporary passwords: 12 characters, no look-alikes, all different", pw.every((p) => p.length === 12 && !/[0O1lI]/.test(p)) && new Set(pw).size === 50);

console.log("\nCRM-5 C field screens (pure rules)");
{
  const NOW = new Date("2026-10-12T16:00:00Z"); // Mon 12 Oct, 17:00 London
  const base = { status: "utc", callback_reason: "utc", appointment_at: null, title: "Mrs", surname: "Ashworth", phone: "07700900001", alt_phone: null, uprn: 1, house_number: "14", building_name: null, street_name: "Upton Road", postcode_sector: "BS7 8", last_result: null, last_called_at: null, call_back_on: null };
  const row = (id: string, created: string, extra: Partial<fieldCrm.CallbackLead> = {}): fieldCrm.CallbackLead => ({ ...base, crm_id: id, crm_created_at: created, ...extra });
  const rows = [
    row("10x1", "2026-10-08T10:00:00Z"),
    row("10x2", "2026-10-01T10:00:00Z"),
    row("10x3", "2026-10-02T10:00:00Z", { last_result: "no_answer", last_called_at: "2026-10-12T09:00:00Z" }),
    row("10x4", "2026-10-03T10:00:00Z", { last_result: "no_answer", last_called_at: "2026-10-10T09:00:00Z" }),
    row("10x5", "2026-10-04T10:00:00Z", { last_result: "later", last_called_at: "2026-10-10T09:00:00Z", call_back_on: "2026-10-15" }),
    row("10x6", "2026-10-05T10:00:00Z", { last_result: "later", last_called_at: "2026-10-09T09:00:00Z", call_back_on: "2026-10-12" }),
    row("10x7", "2026-10-06T10:00:00Z", { last_result: "not_interested", last_called_at: "2026-10-09T09:00:00Z" }),
    row("10x8", "2026-10-07T10:00:00Z", { last_result: "rebooked", last_called_at: "2026-10-11T09:00:00Z" }),
  ];
  const sec = fieldCrm.sectionCallbacks(rows, [], NOW);
  check("to call: never called, no answer on an earlier day, later due today; oldest first", same(sec.toCall.map((r) => r.crm_id), ["10x2", "10x4", "10x6", "10x1"]));
  check("done today and later sections", same(sec.doneToday.map((r) => r.crm_id), ["10x3"]) && same(sec.later.map((r) => r.crm_id), ["10x5"]));
  check("rebooked and not interested leave the list", ![...sec.toCall, ...sec.doneToday, ...sec.later].some((r) => r.crm_id === "10x7" || r.crm_id === "10x8"));
  const withLocal = fieldCrm.sectionCallbacks(rows, [{ crm_id: "10x2", result: "wrong_number", called_at: "2026-10-12T15:30:00Z", call_back_on: null }], NOW);
  check("a call logged on the phone moves it at once (waiting to send)", withLocal.doneToday.some((r) => r.crm_id === "10x2" && r.pending && r.result === "wrong_number") && !withLocal.toCall.some((r) => r.crm_id === "10x2"));
  const synced = fieldCrm.sectionCallbacks(rows, [{ crm_id: "10x2", result: "no_answer", called_at: "2026-10-12T15:30:00Z", call_back_on: null, synced: true }], NOW);
  check("a synced local call is not 'waiting to send'", synced.doneToday.some((r) => r.crm_id === "10x2" && !r.pending));
  check("call-back lines", fieldCrm.callbackLine(sec.toCall[3]!, NOW) === "Unable to contact · Thu 8 Oct" && fieldCrm.callbackLine(sec.doneToday[0]!, NOW) === "No answer at 10:00 · back tomorrow");
  check("names: title + surname only; door line falls back", fieldCrm.contactName({ title: "Mr and Mrs", surname: "Hale" }) === "Mr and Mrs Hale" && fieldCrm.contactName({ title: null, surname: null }) === null && fieldCrm.doorLine({ house_number: null, building_name: null, street_name: null, postcode_sector: "BS7 8" }) === "Near BS7 8");
  check("later days: the next 7 days", same(fieldCrm.laterDays(NOW), ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]));
  const m = fieldCrm.periodSpan("month", NOW);
  const lm = fieldCrm.periodSpan("last_month", NOW);
  const wk = fieldCrm.periodSpan("week", NOW);
  check("periods in London time", m.from === "2026-09-30T23:00:00.000Z" && m.to === "2026-10-12T23:00:00.000Z" && m.line === "1 to 12 Oct" && lm.from === "2026-08-31T23:00:00.000Z" && lm.to === "2026-09-30T23:00:00.000Z" && wk.fromDay === "2026-10-12");
  check("winter midnight is UTC", fieldCrm.londonMidnight("2026-12-01") === "2026-12-01T00:00:00.000Z");
  const lead = (id: string, status: string | null, amount: number | null = null): fieldCrm.MyCrmLead => ({ crm_id: id, status, crm_created_at: "2026-10-12T09:00:00Z", appointment_at: null, sale_amount: amount, callback_reason: null, uprn: null, lon: null, lat: null, house_number: null, building_name: null, street_name: null, postcode_sector: null });
  const t = fieldCrm.myTotals([lead("1", "sale", 6240), lead("2", "sale", 3760), lead("3", "pm"), lead("4", "blowout"), lead("5", "utc"), lead("6", null), lead("7", "sale")]);
  check("my totals: leads, sold, value, pitched, sit rate", t.leads === 7 && t.sold === 3 && t.value === 10000 && t.salesWithAmount === 2 && t.pitched === 4 && t.sat === 4 && t.satOf === 6 && t.tones.other === 1);
  const board: fieldCrm.LeaderRow[] = [
    { canvasser: "Amy", branch: "HO Bristol", leads: 9, sold: 3, pitched: 5, revenue: 20000, sales_with_amount: 3 },
    { canvasser: "Bob", branch: "HO Bristol", leads: 9, sold: 2, pitched: 2, revenue: 30000, sales_with_amount: 2 },
    { canvasser: "Cat", branch: "First Bristol", leads: 9, sold: 2, pitched: 6, revenue: 9000, sales_with_amount: 2 },
    { canvasser: "Nomaan", branch: "HO Bristol", leads: 9, sold: 0, pitched: 0, revenue: 0, sales_with_amount: 0 },
  ];
  const me = { name: "Nomaan", branch: "HO Bristol" };
  const pitched = fieldCrm.rankBoard(board, "pitched", me);
  check("leaderboard by pitches is the default: most pitches first, you stay on with 0", fieldCrm.parseBoardMetric(null) === "pitched" && fieldCrm.parseBoardMetric("rate") === "pitched" && same(pitched.map((r) => `${r.rank}${r.canvasser}`), ["1Cat", "2Amy", "3Bob", "4Nomaan"]) && pitched[3]?.you === true);
  check("pitched rows: big number is pitches, line is sold · P&M", pitched[0]?.main === "6" && pitched[0]?.sub === "2 sold · 4 P&M" && fieldCrm.pitchSplit({ sold: 6, pitched: 15 }) === "6 sold · 9 P&M");
  const tie: fieldCrm.LeaderRow[] = [
    { canvasser: "Dee", branch: "HO Bristol", leads: 9, sold: 1, pitched: 5, revenue: 0, sales_with_amount: 0 },
    { canvasser: "Eve", branch: "HO Bristol", leads: 9, sold: 2, pitched: 5, revenue: 0, sales_with_amount: 0 },
    { canvasser: "Fay", branch: "HO Bristol", leads: 9, sold: 0, pitched: 4, revenue: 0, sales_with_amount: 0 },
  ];
  check("equal pitches share a rank; more sales listed first", same(fieldCrm.rankBoard(tie, "pitched", me).map((r) => `${r.rank}${r.canvasser}`), ["1Eve", "1Dee", "3Fay"]));
  const sales = fieldCrm.rankBoard(board, "sales", me);
  check("leaderboard by sales: ties share a rank, you stay on with 0", same(sales.map((r) => `${r.rank}${r.canvasser}`), ["1Amy", "2Cat", "2Bob", "4Nomaan"]) && sales[3]?.you === true);
  check("leaderboard by value; tabs are Pitched, Sales, Value", same(fieldCrm.rankBoard(board, "value", me).map((r) => r.canvasser), ["Bob", "Amy", "Cat", "Nomaan"]) && same(fieldCrm.BOARD_METRICS.map((m) => m.label), ["Pitched", "Sales", "Value"]));
  check("summary line by pitches, and ordinals", fieldCrm.boardSummary(pitched, 4, "this month") === "No pitches yet this month. 4 people booked leads" && fieldCrm.boardSummary(fieldCrm.rankBoard(board, "pitched", { name: "Amy", branch: "HO Bristol" }), 4, "this month") === "You're 2nd of 4 this month, by pitches" && fieldCrm.ordinal(1) === "1st" && fieldCrm.ordinal(12) === "12th" && fieldCrm.ordinal(23) === "23rd");
  check("week starts Monday (London)", fieldCrm.weekStart("2026-10-18") === "2026-10-12" && fieldCrm.weekStart("2026-10-12") === "2026-10-12");
}

console.log("\nCRM-5 C2 map layer");
{
  const L = (id: string, lon: number | null, created: string, status: string | null, reason: string | null = null): fieldCrm.MyCrmLead => ({ crm_id: id, status, crm_created_at: created, appointment_at: null, sale_amount: null, callback_reason: reason, uprn: null, lon, lat: lon === null ? null : 51.47, house_number: null, building_name: null, street_name: null, postcode_sector: null });
  const pts = fieldCrm.crmLeadPoints([L("10x1", -2.58, "2026-10-01T10:00:00Z", "pm"), L("10x2", -2.58, "2026-10-05T10:00:00Z", "sale"), L("10x3", null, "2026-10-06T10:00:00Z", "utc"), L("10x4", -2.581, "2026-10-02T10:00:00Z", null)]);
  check("map points: unplaced leads skipped, newest wins on a shared door, tone carried", pts.features.length === 2 && pts.features[0]?.properties?.crm_id === "10x2" && pts.features[0]?.properties?.tone === "sale" && pts.features[1]?.properties?.tone === "other");
  check("map layer windows: off by default", fieldCrm.parseMapLayerWindow(null) === 0 && fieldCrm.parseMapLayerWindow("30") === 30 && fieldCrm.parseMapLayerWindow("45") === 0);
  check("map card line", fieldCrm.crmLeadLine(L("10x9", 0, "2026-10-02T10:00:00Z", "blowout", "single_sit")) === "Blowout · single sit · Fri 2 Oct" && fieldCrm.crmLeadLine(L("10x9", 0, "2026-10-02T10:00:00Z", "utc", "utc")) === "Unable to contact · Fri 2 Oct");
  check("the layer starts off and is the canvasser's own leads", /useState<MapLayerWindow>\(0\)/.test(readFileSync("components/field/crm/crm-map-layer.tsx", "utf8")) && /fetchMyLeads/.test(readFileSync("components/field/crm/crm-map-layer.tsx", "utf8")));
}

console.log("\nCRM-4 scheduled sync");
const SECRET = "0123456789abcdef0123456789abcdef";
check("cron refuses without the right secret", !cronAuthorised(null, SECRET) && !cronAuthorised("Bearer wrong", SECRET) && !cronAuthorised(`Bearer ${SECRET}x`, SECRET) && !cronAuthorised(`bearer ${SECRET}`, SECRET));
check("cron refuses when no secret (or a short one) is configured", !cronAuthorised("Bearer ", undefined) && !cronAuthorised("Bearer ", "") && !cronAuthorised("Bearer short", "short"));
check("cron accepts the right secret", cronAuthorised(`Bearer ${SECRET}`, SECRET));
const NOW = new Date("2026-10-11T13:40:00Z"); // 14:40 London (BST)
const run = (started: string, finished: string | null, cursor: string | null, error: string | null = null): SyncRun => ({ started_at: started, finished_at: finished, max_modified_seen: cursor, error });
const ok1 = run("2026-10-11T13:00:00Z", "2026-10-11T13:00:20Z", "2026-10-11T12:59:00Z");
const ok0 = run("2026-10-11T12:30:00Z", "2026-10-11T12:30:15Z", "2026-10-11T12:20:00Z");
const failed = run("2026-10-11T13:30:00Z", "2026-10-11T13:30:05Z", null, "CRM said no");
check("a run that started under 15 min ago and has not finished blocks the next", runInProgress([run("2026-10-11T13:30:00Z", null, null)], NOW) && !runInProgress([run("2026-10-11T13:20:00Z", null, null)], NOW) && !runInProgress([ok1], NOW));
check("cursor = newest successful run, failed runs ignored", nextCursor([failed, ok1, ok0]) === "2026-10-11T12:59:00Z" && lastSuccess([failed]) === null && nextCursor([]) === null);
check("time words in London", whenWords("2026-10-11T13:00:20Z", NOW) === "14:00" && whenWords("2026-10-10T20:00:00Z", NOW) === "yesterday 21:00" && whenWords("2026-10-08T20:00:00Z", NOW) === "8 Oct 21:00");
check("fresh: CRM updated 14:00", JSON.stringify(syncFreshness([ok1, ok0], NOW)) === JSON.stringify({ text: "CRM updated 14:00", stale: false }));
check("newest run failed -> warning", syncFreshness([failed, ok1], NOW).stale && syncFreshness([failed, ok1], NOW).text === "CRM sync failed; last updated 14:00");
check("over 2 hours in the day -> warning", syncFreshness([ok1], new Date("2026-10-11T16:30:00Z")).text === "CRM not updated since 14:00" && syncFreshness([ok1], new Date("2026-10-11T16:30:00Z")).stale);
const evening = run("2026-10-10T20:00:00Z", "2026-10-10T20:00:10Z", "2026-10-10T19:58:00Z");
check("overnight gap is fine until 07:00", !syncFreshness([evening], new Date("2026-10-11T05:30:00Z")).stale && syncFreshness([evening], new Date("2026-10-11T07:30:00Z")).stale);
check("never synced -> warning", syncFreshness([], NOW).stale && syncFreshness([], NOW).text === "CRM not synced yet");

console.log("\nCRM idempotency compare");
const rec = { crm_id: "10x5", lead_no: "LEA5", status_raw: "Sold", status: "sale" as const, crm_created_at: "2026-10-10T10:00:00.000Z", crm_modified_at: "2026-10-10T11:00:00.000Z", appointment_at: null, branch: "First Bristol", sale_amount: 8400, postcode: "BS7 8AB", postcode_sector: "BS7 8", uprn: 1, location: "SRID=4326;POINT(0 0)", match_tier: "exact" as const, canvasser_first_name: "John", callback_reason: null };
const { location: _loc, ...storedRec } = rec;
void _loc;
const storedPoint = { type: "Point", coordinates: [0, 0] };
check("same values in database shape -> unchanged", recordUnchanged(rec, { ...storedRec, location: storedPoint, crm_created_at: "2026-10-10T10:00:00+00:00", crm_modified_at: "2026-10-10T11:00:00+00:00", sale_amount: "8400.00" as unknown as number }));
check("stored point in an unexpected format -> changed", !recordUnchanged(rec, { ...storedRec, location: "0101000020E6100000" }));
check("moved point -> changed", !recordUnchanged(rec, { ...storedRec, location: { type: "Point", coordinates: [0.0001, 0] } }));
check("changed status -> changed", !recordUnchanged(rec, { ...storedRec, location: storedPoint, status: "pm", status_raw: "Pitch&Miss" }));

console.log("\nCRM-2 periods");
const T = "2026-10-10"; // a Saturday
check("period parse, default last 12 months", parseCrmPeriod("ytd") === "ytd" && parseCrmPeriod("nope") === "12m" && parseCrmPeriod(undefined) === "12m");
check("this week = Mon 5 to Mon 12 (exclusive), by day", same(crmWindow("week", T), { from: "2026-10-05", to: "2026-10-12", byDay: true }));
check("this month = 1 Oct to 1 Nov", same(crmWindow("month", T), { from: "2026-10-01", to: "2026-11-01", byDay: true }));
check("last 3 months = 11 Jul to tomorrow", same(crmWindow("3m", T), { from: "2026-07-11", to: "2026-10-11", byDay: true }));
check("last 12 months = from 1 Nov 2025, by month", same(crmWindow("12m", T), { from: "2025-11-01", to: "2026-10-11", byDay: false }));
check("year to date = from 1 Jan", same(crmWindow("ytd", T), { from: "2026-01-01", to: "2026-10-11", byDay: false }));
check("all time is open", same(crmWindow("all", T), { from: null, to: null, byDay: false }));
check("bounds are London midnights (BST and GMT)", same(crmWindowBounds(crmWindow("month", T)), { p_from: "2026-09-30T23:00:00.000Z", p_to: "2026-11-01T00:00:00.000Z" }) && same(crmWindowBounds(crmWindow("all", T)), {}));
check("window lines", crmWindowLine("week", crmWindow("week", T), T) === "Mon 5 to Sun 11 Oct" && crmWindowLine("12m", crmWindow("12m", T), T) === "Nov 2025 to today" && crmWindowLine("month", crmWindow("month", T), T) === "1 to 10 Oct" && crmWindowLine("3m", crmWindow("3m", T), T) === "11 Jul to today" && crmWindowLine("all", crmWindow("all", T), T) === "All time");
check("CRM links open the CRM view", crmHref("12m") === "/admin/insights?view=crm" && crmHref("week") === "/admin/insights?view=crm&crm=week" && parseInsightsView("crm") === "crm" && parseInsightsView(undefined) === "canvassing");
const opts = periodOptions(T);
check("period sheet spans", opts.length === 6 && opts[3]?.span === "Since 1 Nov 2025" && opts[4]?.span === "Since 1 Jan" && opts[5]?.span === "Every CRM lead" && opts[0]?.span === "Mon 5 to Sun 11 Oct");
check("empty period offers a longer one", longerPeriod("week") === "month" && longerPeriod("12m") === "all" && longerPeriod("all") === null && longerPeriod("ytd") === "12m");

console.log("\nCRM-2 figures");
const doc = parseCrmInsights({
  totals: { leads: 100, sale: 5, pm: 15, blowout: 40, utc: 20, re_app: 2, confirmed: 3, pending: 0, no_outcome: 15, revenue: "40000.00", sales_with_amount: 4, placed: 60 },
  months: [{ month: "2026-09", leads: 60, sale: 3, pm: 9, blowout: 24, utc: 12, revenue: 24000, sales_with_amount: 2 }, { month: "2026-10", leads: 40, sale: 2, pm: 6 }],
  days: null,
  sectors: [{ sector: "BS7 8", leads: 30, sale: 3, pitched: 8 }, { sector: "BS5 6", leads: 25, sale: 0, pitched: 5 }, { sector: "BS4 4", leads: 22, sale: 1, pitched: 2 }, { sector: "BS1 1", leads: 3, sale: 3, pitched: 3 }],
  props: [{ id: "p1", name: "Upton", leads: 10, sale: 2, pitched: 4, revenue: 20000, sales_with_amount: 2 }, { id: "p2", name: "Elm", leads: 8, sale: 1, pitched: 1, revenue: 6000, sales_with_amount: 1 }, { id: "p3", name: "Ash", leads: 0 }],
  confirmed: [
    { crm_id: "c2", at: "2026-10-07T17:00:00+00:00", sector: "BS5 6", uprn: null, branch: "HO Bristol", canvasser: "Bob" },
    { crm_id: "c1", at: "2026-10-06T09:30:00+00:00", sector: "BS7 8", uprn: 1, house_number: "21", street_name: "Upton Road", branch: "First Bristol", canvasser: "Amy" },
  ],
});
check("rates: pitch → sale 25%, sit rate 25%", percent(pitchToSale(doc.totals)) === "25%" && percent(sitRate(doc.totals)) === "25%" && percent(pitchToSale({ sale: 0, pm: 0 })) === "–");
check("money", pounds(40000) === "£40,000" && pounds(null) === "–" && poundsShort(3480310) === "£3.5m" && poundsShort(48200) === "£48k" && poundsShort(1250) === "£1.3k");
check("hero figures", heroFigures(doc.totals).map((t) => t.value).join("|") === "100|5|£40k");
const rates = rateFigures(doc.totals);
check("rates with their working", rates.map((t) => t.value).join("|") === "25%|25%|£10,000" && rates[0]?.detail === "5 of 20" && rates[1]?.detail === "20 of 80" && rates[2]?.detail === "1 sale has no amount");
check("CRM-3: part-priced period says how many sales are unpriced", heroFigures(doc.totals)[2]?.note === "1 of 5 sales unpriced");
const unpriced = heroFigures({ ...doc.totals, revenue: 0, sales_with_amount: 0 })[2];
check("CRM-3: sales with no amounts never read as £0", unpriced?.value === "–" && unpriced?.note === "No sale amounts recorded");
const noSales = heroFigures({ ...doc.totals, sale: 0, revenue: 0, sales_with_amount: 0 })[2];
check("CRM-3: no sales at all is £0 with no note", noSales?.value === "£0" && noSales?.note === undefined);
check("CRM-3: Other is spelled out, largest first", otherBreakdown({ leads: 100, sale: 5, pm: 15, blowout: 50, utc: 10, re_app: 3, confirmed: 2, pending: 1, no_outcome: 14, revenue: 0, sales_with_amount: 0 }) === "14 no outcome recorded · 3 re-app · 2 booked · 1 uncontacted");
check("CRM-3: empty Other -> null", otherBreakdown({ leads: 10, sale: 5, pm: 5, blowout: 0, utc: 0, re_app: 0, confirmed: 0, pending: 0, no_outcome: 0, revenue: 0, sales_with_amount: 0 }) === null);
const split = leadSplit(doc.totals);
check("where leads went adds up", split.reduce((a, r) => a + r.count, 0) === 100 && split[4]?.count === 20 && split[0]?.percent === "5%" && split[3]?.label === "Unable to contact");
const cols = outcomeColumns(doc, crmWindow("12m", T), T);
check("12 month columns, gaps filled", cols.length === 12 && cols[0]?.key === "2025-11" && cols[10]?.leads === 60 && cols[11]?.segments.other === 32 && cols[0]?.leads === 0);
const allCols = outcomeColumns(doc, crmWindow("all", T), T);
check("all time starts at the first month with a lead", allCols.length === 2 && allCols[0]?.key === "2026-09");
const dayDoc = parseCrmInsights({ days: [{ day: "2026-10-06", leads: 4, sale: 1 }] });
const dayCols = outcomeColumns(dayDoc, crmWindow("week", T), T);
check("this week = 7 day columns", dayCols.length === 7 && dayCols[1]?.leads === 4 && dayCols[0]?.label === "5 Oct");
const areas = areaRankings(doc.sectors, minLeadsForAreas("12m"));
check("areas: 20+ leads only, best and worst never overlap", areas.ranked === 3 && areas.best[0]?.sector === "BS7 8" && areas.worst[0]?.sector === "BS5 6" && !areas.worst.some((w) => areas.best.some((b) => b.sector === w.sector)) && minLeadsForAreas("week") === 5);
const pr = propRows(doc.props);
check("props: empty props dropped, sorted by sales", pr.map((r) => r.id).join() === "p1,p2" && percent(pr[0]!.pitchToSale) === "50%");
const high = sortedProps(pr, "high");
const low = sortedProps(pr, "low");
check("props sort three ways", sortedProps(pr, "sales")[0]?.value === "£20,000" && high[0]?.value === "£10,000" && low[0]?.id === "p2" && high[0]?.sub === "£20,000 from 2 sales" && sortedProps(pr, "sales")[0]?.sub === "50% of pitches sold");
check("chart readout", columnReadout(cols[11]!, T, "leads").title === "Oct 2026 so far" && columnReadout(cols[10]!, T, "leads").line === "60 leads, 3 sold, £24k" && columnReadout(cols[10]!, T, "value").line === "£24,000 from 3 sold");
check("axis ticks: at most N, always the last", axisTicks(12, 12).length === 12 && axisTicks(92, 6).length <= 6 && axisTicks(92, 6).at(-1) === 91 && axisTicks(0, 6).length === 0);
const conf = confirmedByDay(doc.confirmed);
check("confirmed grouped by London day, earliest first", conf.length === 2 && conf[0]?.label === "Tue 6 Oct" && conf[0]?.rows[0]?.time === "10:30" && conf[0]?.rows[0]?.place === "21 Upton Road" && conf[1]?.rows[0]?.place === "BS5 6 area" && conf[1]?.rows[0]?.meta === "HO Bristol, Bob");
check("confirmed place with a building only", confirmedPlace({ houseNumber: null, buildingName: "Creswicke House", streetName: "Upton Road", sector: null }) === "Creswicke House, Upton Road");
check("a broken document reads as empty, never a crash", parseCrmInsights(null).totals.leads === 0 && parseCrmInsights({ months: "x" }).months.length === 0);

console.log("\nCRM-2 map");
const doorsRaw = [
  { uprn: 1, lon: -2.5, lat: 51.4, latest_status: "sale", latest_at: "2025-03-12T10:00:00+00:00", leads: 3, sale: 1, pm: 1, blowout: 1, utc: 0, other: 0 },
  { uprn: 2, lon: -2.6, lat: 51.45, latest_status: null, latest_at: null, leads: 1, sale: 0, pm: 0, blowout: 0, utc: 0, other: 1 },
  { uprn: null, lon: 1, lat: 1 },
];
const crmDoors = parseCrmDoors(doorsRaw);
check("doors parsed, broken rows dropped", crmDoors.length === 2 && crmDoors[1]?.latestStatus === null);
check("groups: confirmed, re-app and no outcome are Other", crmDoorGroup("confirmed") === "other" && crmDoorGroup(null) === "other" && crmDoorGroup("pm") === "pm");
check("door filter", filterCrmDoors(crmDoors, "sale").length === 1 && filterCrmDoors(crmDoors, "other").length === 1 && filterCrmDoors(crmDoors, "all").length === 2);
check("door words", crmDoorLatest(crmDoors[0]!) === "Sold, 12 Mar 2025" && crmDoorCounts(crmDoors[0]!) === "3 CRM leads: 1 sold, 1 pitch & miss, 1 blowout" && crmDoorCounts(crmDoors[1]!) === "1 CRM lead" && crmDoorLatest(crmDoors[1]!) === "No outcome");
check("view parse", parseCrmView("heat-rate") === "heat-rate" && parseCrmView("doors-pm") === "doors-pm" && parseCrmView("doors-x") === "off" && parseCrmView(undefined) === "off");
check("view parts", crmViewKind("heat-leads") === "heat" && crmViewKind("doors-all") === "doors" && crmViewDoorFilter("doors-blowout") === "blowout" && crmViewDoorFilter("heat-rate") === "all");
check("chip words", crmChip("off") === "CRM" && crmChip("doors-all") === "CRM doors" && crmChip("doors-sale") === "CRM: Sold" && crmChip("heat-rate") === "CRM: sale rate");
check("the CRM layer rides along every filter link", withCrmView("/admin/coverage", "heat-rate") === "/admin/coverage?crm=heat-rate" && withCrmView("/admin/coverage?prop=x", "doors-sale") === "/admin/coverage?prop=x&crm=doors-sale" && withCrmView("/admin/coverage?prop=x", "off") === "/admin/coverage?prop=x");
const cells = parseHeatCells([{ lon: -2.6, lat: 51.45, leads: 20, sales: 3, pitched: 6, revenue: "1" }, { lon: -2.6, lat: 51.46, leads: 6, sales: 0, pitched: 1 }, { lat: 1 }]);
check("heat cells parsed", cells.length === 2 && cells[0]?.revenue === 1);
check("heat steps: rate needs 3 pitched; leads step up", heatStep(cells[0]!, "rate") === 3 && heatStep(cells[1]!, "rate") === -1 && heatStep(cells[1]!, "leads") === 0 && heatStep(cells[0]!, "leads") === 2);
const sq = cellSquare({ lon: -2.6, lat: 51.45 }).coordinates[0]!;
const widthM = (sq[1]![0]! - sq[0]![0]!) * 111_320 * Math.cos((51.45 * Math.PI) / 180);
const heightM = (sq[2]![1]! - sq[1]![1]!) * 111_320;
const tally = crmDoorTally(crmDoors);
check("picker counts per outcome", tally.all === 2 && tally.sale === 1 && tally.other === 1 && tally.pm === 0);
const fig = heatCellFigures(cells[1]!);
check("tapped square figures", fig.figures.map((f) => f.value).join("|") === "6|0|0%|–" && fig.line === "1 pitched, pitch → sale 0%");
const box = cellBox({ lon: -2.5, lat: 51.4 });
check("a square's doors", box[0][0] < -2.5 && box[1][1] > 51.4 && doorsInCell(crmDoors, { lon: -2.5, lat: 51.4 }) === 1 && doorsInCell(crmDoors, { lon: 0, lat: 0 }) === 0);
check("heat squares are 250 m across", Math.abs(widthM - 250) < 0.5 && Math.abs(heightM - 250) < 0.5 && sq.length === 5);

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
const textFieldUsers = files.filter((f) => rel(f) !== self && /cf_867|cf_881/.test(readFileSync(f, "utf8"))).map(rel);
check("only lib/crm/parse.ts reads the Result / Rep Result boxes", same(textFieldUsers, ["lib/crm/parse.ts"]));
const routeSrc = readFileSync("app/api/cron/crm-sync/route.ts", "utf8");
check("cron route checks the secret before anything else", routeSrc.indexOf("cronAuthorised(") > 0 && routeSrc.indexOf("cronAuthorised(") < routeSrc.indexOf("createServiceClient()") && /401/.test(routeSrc));
check("cron route replies with counts only and logs nothing", !/console\.|summary\.(statusCounts|priceSources|soldWithoutPrice|newest)/.test(routeSrc) && /log: \(\) => \{\}/.test(routeSrc));
const mw = readFileSync("middleware.ts", "utf8");
check("middleware skips /api/cron (no session redirect)", mw.includes("api/cron/"));
const m036 = readFileSync("supabase/migrations/036_crm_sync_schedule.sql", "utf8");
check("036 keeps the URL and secret in Vault, never in the file", m036.includes("vault.decrypted_secrets") && !/https:\/\/[a-z0-9-]+\.vercel\.app/.test(m036) && !/Bearer [A-Za-z0-9]{16,}/.test(m036));
const m037 = readFileSync("supabase/migrations/037_crm_canvasser.sql", "utf8");
check("037: contacts readable only by their canvasser, purged after 90 days", /create policy crm_contacts_select_own/.test(m037) && !/crm_contacts.*to authenticated\s+using \(\(select public\.app_role\(\)\) in/.test(m037) && /crm-contacts-purge/.test(m037) && /purge_after < current_date/.test(m037));
check("037: no first name column anywhere", !/first_?name\s+text/i.test(m037.replace(/canvasser_first_name/g, "")));
check("037: call results are insert-only (no update or delete grant)", /grant select, insert on public\.crm_callbacks to authenticated/.test(m037) && !/grant[^;]*(update|delete)[^;]*crm_callbacks/i.test(m037));
check("036 tick is not callable through the API", /revoke all on function public\.crm_sync_tick\(\) from anon, authenticated/.test(m036));
const clientSource = readFileSync(path.join(root, "lib/crm/client.ts"), "utf8");
check("client names no write operation", !/["'`](create|update|delete|revise|convertlead)["'`]/i.test(clientSource));
const publicKey = files.filter((f) => rel(f) !== self && /NEXT_PUBLIC_CRM/.test(readFileSync(f, "utf8"))).map(rel);
check("no NEXT_PUBLIC_ CRM variable anywhere", publicKey.length === 0);
// CRM-5 C (AGENTS.md P4b exception): /field reads CRM data ONLY through the
// own-leads / totals RPCs from 037, and only from lib/field/crm-data.ts.
const fieldFiles = files.filter((f) => rel(f).startsWith("app/(field)") || rel(f).startsWith("components/field") || rel(f).startsWith("lib/field"));
const fieldImports = fieldFiles
  .filter((f) => /lib\/crm\/|lib\/admin\/crm|components\/admin|from\("crm_(leads|contacts|sync_runs|status_map)"\)|crm_insights|crm_heat_grid|crm_door_history|crm_canvasser_names|admin_set_crm_name/.test(readFileSync(f, "utf8")))
  .map(rel);
check("no /field file reads admin CRM data or CRM tables directly", fieldImports.length === 0);
const fieldRpcs = fieldFiles.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/rpc\("(\w*crm\w*)"/g)].map((m) => `${rel(f)}:${m[1]}`));
check(
  "CRM-5 C: /field calls only my_crm_leads, my_crm_callbacks and crm_leaderboard, from lib/field/crm-data.ts",
  fieldRpcs.every((r) => /^lib\/field\/crm-data\.ts:(my_crm_leads|my_crm_callbacks|crm_leaderboard)$/.test(r)) && fieldRpcs.length === 3,
);
const tel = fieldFiles.filter((f) => /tel:/.test(readFileSync(f, "utf8"))).map(rel).sort();
check("phone numbers only on the call-back list and its sheet", same(tel, ["components/field/crm/call-result-sheet.tsx", "components/field/crm/callbacks-pane.tsx"]));
const layerFiles = fieldFiles.filter((f) => /field-crm-leads|CRM_MAP_RING/.test(readFileSync(f, "utf8"))).map(rel).sort();
check("CRM-5 C2: the CRM colour layer lives only in field-map.tsx (rings) and lib/field/crm.ts (colours)", same(layerFiles, ["components/field/field-map.tsx", "lib/field/crm.ts"]));
check("the CRM field screens never touch a customer first name", !fieldFiles.filter((f) => /crm/.test(rel(f))).some((f) => /first_?name/i.test(readFileSync(f, "utf8"))));

async function sendChecks(): Promise<void> {
  console.log("\nCRM-5 B sendOp (fake client, no network)");
  const calls: { table: string; row: unknown }[] = [];
  const fakeDb = (status: number, error: { message: string; code?: string } | null) =>
    ({ from: (table: string) => ({ insert: (row: unknown) => ({ abortSignal: () => { calls.push({ table, row }); return Promise.resolve({ error, status }); } }) }) }) as never;
  const okSend = await sendOp(fakeDb(201, null), { kind: "crm_callback", payload: cbOp().payload });
  check("sendOp inserts into crm_callbacks only", okSend.outcome === "ok" && okSend.step === "callback" && calls.length === 1 && calls[0]?.table === "crm_callbacks");
  const dupSend = await sendOp(fakeDb(409, { message: "duplicate key", code: "23505" }), { kind: "crm_callback", payload: cbOp().payload });
  check("re-sync of the same call is a duplicate, not an error", dupSend.outcome === "duplicate");
  const rlsSend = await sendOp(fakeDb(403, { message: "new row violates row-level security policy", code: "42501" }), { kind: "crm_callback", payload: cbOp().payload });
  check("someone else's lead is refused, not retried", rlsSend.outcome !== "ok" && rlsSend.outcome !== "duplicate" && rlsSend.outcome !== "retryable");
}

void sendChecks().then(() => {
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
});
