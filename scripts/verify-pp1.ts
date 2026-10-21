/**
 * PP-1 (owner 2026-10-21): pure checks for props in folders and the
 * Coverage folder filter. No network, no database.
 * Run: npm run verify:pp1
 */
import { filtersHref, parseFilters, visitScope, withoutFolder, withoutProp, NO_FILTERS } from "@/lib/admin/coverage-filters";
import { cleanFolderName, folderLine, groupByFolder, propState, type PropRow } from "@/lib/admin/props";

let failed = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed += 1;
}

// ---- PP-1: folders -----------------------------------------------------------

const TODAY = "2026-10-21";
const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";
const row = (id: string, folderId: string | null, archivedAt: string | null = null): PropRow => ({
  id,
  name: id,
  archivedAt,
  geometry: null,
  visits: [],
  folderId,
});
const all = [row("a", F1), row("b", F1, "2026-10-01"), row("c", F2), row("d", null), row("e", "gone")].map((r) => ({
  row: r,
  state: propState(r, TODAY),
}));
const folders = [
  { id: F2, name: "zeta" },
  { id: F1, name: "Test props" },
];

const open = groupByFolder(all, all, folders, false);
check("folders A–Z then No folder", open.map((g) => g.folder?.name ?? "none").join(",") === "Test props,zeta,none");
check("unknown folder counts as No folder", open[2]!.items.map((i) => i.row.id).join(",") === "d,e");
check("archived stays in its folder and is counted", open[0]!.counts.archived === 1 && open[0]!.counts.live === 1);
check("folder line", folderLine(open[0]!.counts) === "1 live · 1 archived");

const onlyA = all.filter((i) => i.row.id === "a");
const narrowed = groupByFolder(all, onlyA, folders, true);
check("search hides folders with no match", narrowed.length === 1 && narrowed[0]!.folder?.id === F1);
check("counts stay whole while narrowed", narrowed[0]!.counts.archived === 1);

const allFiled = all.filter((i) => i.row.folderId === F1 || i.row.folderId === F2);
check("No folder hidden when empty", groupByFolder(allFiled, allFiled, folders, false).every((g) => g.folder !== null));
check("empty named folder still shown", groupByFolder([], [], folders, false).length === 2);

check("folder name trimmed", cleanFolderName("  Fish   ponds ") === "Fish ponds");
check("empty folder name refused", cleanFolderName("   ") === null);
check("long folder name refused", cleanFolderName("x".repeat(61)) === null);

// ---- PP-1: Coverage ?folder= -------------------------------------------------

const withFolder = parseFilters({ folder: F1 }, TODAY);
check("folder parsed", withFolder.folder === F1);
check("folder opens on all time", withFolder.from === null && withFolder.to === null);
check("bad folder dropped", parseFilters({ folder: "nope" }, TODAY).folder === null);
check("folder href round-trips", filtersHref(withFolder, TODAY) === `/admin/coverage?folder=${F1}`);
check("remove folder → 30 days", (() => {
  const f = withoutFolder(withFolder, TODAY);
  return f.folder === null && f.from === "2026-09-22" && f.to === TODAY;
})());
check("remove prop inside folder → still all time", (() => {
  const f = withoutProp({ ...withFolder, prop: F2 }, TODAY);
  return f.folder === F1 && f.prop === null && f.from === null;
})());
check("folder scope is never null", visitScope([{ id: "v", propId: "a", visitNumber: 1, slot: null }], withFolder)?.has("v") === true);
check("no folder keeps scope null", visitScope([], NO_FILTERS) === null);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
