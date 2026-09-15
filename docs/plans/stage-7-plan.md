Stage 7 plan — sync queue + app-shell service worker
Planning only. Nothing below has been written.

What I found in the current code that shapes the plan
lib/field/db.ts is the only Dexie database (nakolabs-d2d-field, currently at version 2, one table assignments). Its comment explicitly reserves the version-3 bump for Stage 7's queue table. The queue goes in this DB, not a second one.
There are no field writes yet. components/field/field-prop.tsx only calls supabase.auth.getSession() and the todays_assignment RPC (read). So Stage 7 has no callers to migrate; it is genuinely a standalone module.
003_core.sql matters for the queue's wire contract:
knock_events.id defaults server-side, but leads.knock_event_id is a FK to it and leads_insert_canvasser requires the knock row to already exist and belong to the caller. To build a knock+lead pair offline, the device must generate knock_events.id itself (the generated Insert type allows id?; the table-level insert grant permits it).
leads has a column-level insert grant: id, client_event_id, knock_event_id, uprn, canvasser_id, booked_for, is_immediate, notes. Sending status fails with 42501. The queue's lead payload type must be the narrow Pick the brief describes in Stage 8.
Every unique constraint a canvasser can trip on these three tables (knock_events.id, knock_events.client_event_id, leads.client_event_id, leads.knock_event_id, property_observations.client_event_id) is on a value the device generated. So any 23505 on our inserts means "already there" and is safe to treat as success.
/field is a Server Component that calls getUser()/getOwnProfile server-side, and middleware.ts runs supabase.auth.getUser() on every /field navigation. Offline, the service worker has to answer the navigation before any of that runs. Both are fine as long as the SW serves cached HTML for /field.
middleware.ts matcher currently only excludes _next/static, _next/image, favicon.ico, health and image extensions. sw.js, the manifest, /maplibre/* and icons would all pass through middleware today.
MapLibre's worker is served from public/maplibre/*.mjs (unhashed, re-copied every build). It must be in the offline shell or the map never boots offline.
Map style: field-map.tsx fetches api.maptiler.com style JSON and falls back to an empty background style. Offline today = dots on a plain canvas. Stage 7 does not change this (see decisions).
No dexie-react-hooks, no test runner in package.json. Existing verification is scripts/verify-stage-N.ts with real JWTs.
1. File list
Sync queue
Action	Path	Purpose
modify
lib/field/db.ts
version(3) adds outbox and sync_meta tables; export row types. No upgrade clearing of assignments.
create
lib/sync/ops.ts
SyncOp discriminated union, narrow write types (KnockEventWrite, CanvasserLeadInsert = Pick<LeadsInsert, …>, PropertyObservationWrite), newClientEventId() (uuid v4 via crypto.randomUUID, fallback via getRandomValues).
create
lib/sync/queue.ts
The only write path. enqueue(op), flush(reason), retryFailed(id), discardFailed(id), getStatus(), subscribe(). Sends via lib/supabase/client.ts.
create
lib/sync/classify.ts
Pure function: Supabase/PostgREST error → duplicate | retryable | auth | permanent. Split out so the verify script can unit-check it in Node.
create
lib/sync/backoff.ts
Pure: delayMs(attempt) with cap + full jitter.
create
lib/sync/use-sync-status.ts
React hook: useSyncExternalStore over Dexie core liveQuery (no dexie-react-hooks). Returns { pending, failed, lastSyncAt, state }.
create
components/field/sync-provider.tsx
"use client". Mounts once; wires the flush triggers (below) and tears them down.
create
components/field/sync-status.tsx
Header line ("3 to send · last sent 14:02") plus a failed-row banner with Retry / Discard. British English.
create
app/(field)/layout.tsx
Server layout for the field group; renders <SyncProvider> and <RegisterServiceWorker> around children.
modify
components/field/field-prop.tsx
Add <SyncStatus /> to the header. Nothing else — no writes exist yet.
create
scripts/verify-stage-7.ts
Node harness for the server-side half of acceptance (replay same client_event_id twice → one row; 4xx classification; row counts per test prefix). See decision 11 for the browser half.
modify
package.json
verify:stage7 script only. No new dependencies.
Service worker
Action	Path	Purpose
create
public/sw.js
Hand-rolled, plain JS, served at scope /.
create
components/pwa/register-sw.tsx
"use client". Registers /sw.js in production only, after load; posts the page's loaded /_next/static/* URLs to the SW for warm-up.
create
app/manifest.ts
Next metadata route → /manifest.webmanifest. start_url: "/field", display: "standalone", scope: "/".
create
public/icons/icon-192.png, public/icons/icon-512.png, public/icons/apple-touch-icon.png
Home-screen icons. Artwork needed (decision 12).
create
public/offline.html
Tiny static fallback served only when /field is requested offline and has never been cached: "Open the app once with signal to prepare it for offline use."
modify
app/layout.tsx
metadata.appleWebApp (standalone on iOS), viewport.themeColor. Manifest link is automatic from app/manifest.ts.
modify
middleware.ts
Extend matcher exclusion: sw.js, manifest.webmanifest, offline.html, icons/, maplibre/.
modify
next.config.ts
headers(): /sw.js → Cache-Control: no-cache, must-revalidate so the browser always byte-checks for updates.
Not touched: supabase/migrations (no migration in Stage 7), lib/supabase/types.ts (no schema change), AGENTS.md/rules (already anticipate public/sw.js).

2. Dexie schema and client_event_id
lib/field/db.ts, version 3:

instance.version(3).stores({
  assignments: "assignment_id, work_date, canvasser_id",          // unchanged
  outbox:      "++seq, &client_event_id, assignment_id, canvasser_id, status, [assignment_id+seq], [status+assignment_id]",
  sync_meta:   "key",
});
OutboxRow:

{
  seq: number;                 // auto-increment PK = insertion order on this device
  client_event_id: string;     // uuid v4, unique index (&)
  kind: "knock_event" | "property_observation";
  assignment_id: string;
  canvasser_id: string;        // captured at enqueue, not at flush
  payload: SyncOp["payload"];  // typed per kind, see ops.ts
  status: "pending" | "synced" | "failed";
  attempts: number;
  created_at: string;          // ISO
  synced_at: string | null;
  last_error: { status?: number; code?: string; message: string } | null;
}
sync_meta is a key/value table: last_sync_at, last_canvasser_id (see decision 9).

Why ++seq as PK rather than client_event_id: the queue needs a strict, gap-tolerant insertion order that survives restart, and Dexie only auto-increments the primary key. client_event_id gets a unique (&) index instead, which makes enqueue itself idempotent — a second enqueue with the same id throws ConstraintError, which the queue swallows as "already queued". That protects Stage 8 against a double-tap producing two events.

How client_event_id is handled:

Generated once per door-visit action by the caller, before enqueue, via newClientEventId() in ops.ts. The queue never generates ids; it stores what it is given. This is what lets Stage 8 hand the same id to both the knock and the lead.
For kind: "knock_event" the payload is { knock: KnockEventWrite; lead?: CanvasserLeadInsert }. Both knock.client_event_id and lead.client_event_id equal the row's client_event_id; enqueue asserts this and rejects the op if they differ. knock.id is a second device-generated uuid, stored in the payload, and lead.knock_event_id references it — so the pair is fully formed offline and the retry after a partial failure re-sends the identical bytes.
payload uses the narrow CanvasserLeadInsert (Pick<Database["public"]["Tables"]["leads"]["Insert"], "id" | "client_event_id" | "knock_event_id" | "uprn" | "canvasser_id" | "booked_for" | "is_immediate" | "notes">). status cannot be expressed, closing the 42501 trap at the type level in Stage 7 rather than Stage 8.
Rows are not deleted on success; they flip to synced (decision 5).
There is no in_flight status. Cross-tab exclusivity comes from navigator.locks.request("d2d-outbox-flush", { ifAvailable: true }, …) (auto-released when a tab dies), with a plain in-memory flag as fallback where Web Locks is absent. A mid-flush kill therefore leaves rows as pending, never stuck.

3. Flush triggers, backoff, ordering
Triggers (all wired in sync-provider.tsx, each calls flush(reason)):

window online
document visibilitychange → visible, and window focus
window pageshow (bfcache restore)
mount (app open / restart)
enqueue — immediate attempt if navigator.onLine !== false
timer: setInterval 30 s, only while visibilityState === "visible" and pending > 0
navigator.onLine is a hint only (Safari lies); a false skips the attempt to save battery, a true proves nothing — the fetch failure and backoff handle reality. No Background Sync API: unsupported on iOS, and it would put a flush in the SW, which is a second sync path.

Flush algorithm:

Acquire the lock; if held, mark "rerun after" and return.
getSession() → uid. No session → state = auth_required, return.
Read status = pending ordered by seq; group by assignment_id, preserving seq order within each group.
Groups are processed one at a time, rows strictly serially. For each row:
canvasser_id !== uid → leave pending, count as "held" (decision 8).
sendOp(row) with a 10 s AbortController per request.
ok or duplicate → status = synced, synced_at, update sync_meta.last_sync_at.
permanent → status = failed, last_error; continue to the next row (decision 6).
auth → state = auth_required; abort the whole flush, rows stay pending.
retryable → attempts++, last_error; stop this assignment's group (head-of-line block keeps order); move to the next group.
Any retryable failure → schedule the next flush at delayMs(n); any success and no failures → reset n to 0.
sendOp for knock_event: insert knock (Prefer: return=minimal, no .select()) → classify; if ok/duplicate and payload.lead exists → insert lead → classify. If the lead step fails retryably, the row stays pending and the next attempt re-runs step 1 (→ 23505 → duplicate → ok) then step 2. That is exactly the Stage 8 replay-after-partial-failure acceptance.

Classification (classify.ts):

Signal	Class
PostgREST code === "23505" (HTTP 409)
duplicate → success
network error, abort/timeout, 5xx, 408, 429
retryable
401, or auth error from getSession/refresh
auth
any other 4xx (42501 RLS, 23503 FK, 23514 check, 400/403/422)
permanent → surfaced
Backoff (backoff.ts): full-jitter exponential, base 2 s, cap 5 min, delay = random(0.5, 1) × min(cap, base × 2^n). The counter is in memory only; a restart or any external trigger (online/focus) resets it, because those are signals that conditions changed. Retryable errors retry indefinitely — a knock is never dropped for connectivity. Only permanent stops retrying, and it stops immediately (no retry budget) because a 42501/23514 will never pass.

Ordering guarantee stated precisely: within one assignment_id, rows reach the server in seq order among rows that succeed; a retryable failure halts that assignment until the next flush; a permanent failure is parked and does not hold later rows hostage. Different assignments do not block each other.

Status to UI: { pending, failed, held, lastSyncAt, state: "idle" | "syncing" | "backoff" | "offline" | "auth_required" } via liveQuery counts plus an in-memory state emitter.

4. Service worker caching strategy
Single SW at /sw.js, scope /. Two caches: d2d-shell-v{SW_VERSION} (versioned, deleted on activate when the version changes) and d2d-static (content-hashed assets, unversioned).

Precached on install (stable URLs, cache.addAll):

/maplibre/maplibre-gl-worker.mjs, /maplibre/maplibre-gl-shared.mjs
/manifest.webmanifest, /icons/*
/offline.html
Warmed on first online load (not install — see decision 2): register-sw.tsx waits for load, collects every same-origin /_next/static/ URL from document.scripts, stylesheet <link>s and performance.getEntriesByType("resource"), and posts them to the SW, which cache.addAlls them into d2d-static. Includes the next/font woff2 files under /_next/static/media/.

Runtime handlers — the fetch listener uses an allowlist and only calls respondWith for same-origin GET requests matching one of:

Request	Strategy
/_next/static/**
cache-first (immutable hashed content; miss → network → put)
/maplibre/**
stale-while-revalidate (unhashed, changes on MapLibre upgrade)
navigation to /field or /field/**
network-first with 3 s timeout → cached HTML → /offline.html. Cache only when response.ok && !response.redirected && response.type === "basic"; cache key is the path without query. (Decision 1 explains why not literal cache-first.)
Everything else returns without respondWith and goes straight to the network untouched: /admin, /office, /login, /, /health, ?_rsc= payloads, any POST, and every cross-origin request. Supabase REST/Auth/Realtime (*.supabase.co) and MapTiler (api.maptiler.com) are cross-origin, so they are structurally incapable of being cached by this worker — there is no code path that stores them. The shell never contains data; Dexie owns the snapshot and the outbox. The SW also has no sync/periodicsync handlers and never touches IndexedDB.

Lifecycle: skipWaiting() on install, clients.claim() on activate, delete shell caches with a stale version. d2d-static is pruned on activate by response Date header older than 14 days, so a deploy stream does not grow storage without bound while chunks referenced by a still-cached HTML from this fortnight stay available.

Registration only from the field layout. Admin and office users never register a worker. Production only (process.env.NODE_ENV === "production") — Turbopack HMR and a SW do not mix.

Cold-open path offline, end to end: tap icon → navigation /field → SW: network fails fast (zero signal) → cached HTML → HTML references hashed chunks → d2d-static → app boots → FieldProp reads Dexie assignments → renders; SyncProvider starts, sees pending rows, backs off until online.

5. Dependencies
Reach for nothing new. Reasoning against the two obvious candidates:

next-pwa — effectively unmaintained against Next 15/Turbopack (webpack-plugin based), pulls in Workbox (~7 deps), generates a worker that runtime-caches API responses by default (violating the Dexie-owns-data rule unless carefully excluded), and hides the exact behaviour we need to reason about for acceptance. Rejected.
@serwist/next — the maintained successor. It does one thing better than hand-rolled: build-manifest injection for true install-time precache of hashed chunks. It costs a webpack/Turbopack integration surface, a config DSL, and Workbox-style runtime-caching defaults to disable. For this app the precache advantage is moot (see decision 2: there is nothing to cold-open until the device has been online once anyway). Rejected, with the note that it is the fallback if decision 2 goes the other way.
dexie-react-hooks — not needed; liveQuery is in Dexie 4 core and useSyncExternalStore is in React 19.
uuid — not needed; crypto.randomUUID (iOS 15.4+, all current Chromium) with a 12-line getRandomValues fallback.
fake-indexeddb (for Node testing of the queue) — tempting, rejected; the browser half of acceptance is tested in a real browser (decision 11).
Hand-rolled public/sw.js is ~150 lines of plain JS with no build step, which is exactly the size where owning it is cheaper than configuring a library around it.

6. Ambiguities and decisions needed before code
"Cache-first for the shell" vs network-first for /field HTML. I recommend network-first (3 s timeout) for the HTML and cache-first only for hashed assets. Literal cache-first on HTML means: (a) middleware's session-cookie refresh never runs on open when online; (b) after a deploy the app keeps booting the old build until the SW file itself changes, and public/sw.js does not change on deploys; (c) a logged-out user gets the shell instead of /login. Offline behaviour is identical either way. Please confirm the deviation or insist on literal cache-first (I would then add stale-while-revalidate on HTML and a manual SW_VERSION bump discipline).

Install-time precache of JS bundles is not achievable from a static public/sw.js because chunk names are content-hashed at build. Options: (a) warm on first online load + runtime cache-first (recommended; a device that has never been online has an empty Dexie and nothing to show anyway, so install-time precache buys no real capability); (b) adopt @serwist/next for manifest injection; (c) a postbuild script that rewrites public/sw.js from .next/app-build-manifest.json — fragile on Vercel because public/ is snapshotted during the build.

Two-step knock→lead vs one RPC. Stage 8's acceptance text ("knock inserted, lead not… retry completes cleanly") assumes two PostgREST inserts, which is what I planned. A single log_door_visit RPC with on conflict do nothing would be genuinely atomic and one round trip, but needs a migration (Stage 8, not 7) and changes that acceptance wording. The sendOp dispatcher is designed so either fits. Decide before Stage 8; Stage 7 proceeds with two-step.

knock_events.id generated on device — required for the offline lead FK. Separate uuid from client_event_id (recommended, keeps PK and idempotency key semantically distinct) or reuse the same string? Low stakes, but it fixes the payload shape.

Retain synced rows or delete them? I plan status = "synced" retention, because Stage 8 ("a logged door visibly changes state immediately, before sync") and Stage 9 offline both need a local record of today's knocks, and the outbox is the natural read model. Prune rule: delete synced rows when clearCachedToday runs or when work_date moves on. If you prefer a separate local knocks table in Stage 8, the outbox deletes on success instead.

Poison rows. A permanent 4xx on one row: park it and continue (recommended — one bad event should not stall a whole day's knocks) or strict head-of-line block per assignment (the most literal reading of "ordering preserved per assignment")? Server-side, occurred_at and sequence_position carry the true order, so arrival order does not affect coverage either way.

401 handling. Treat as auth_required (pause, banner "Sign in again to send N knocks", rows stay pending) rather than failed. The rule "a 4xx does not retry forever" is satisfied — it does not retry at all until auth changes — but it is not a row failure. Confirm.

Shared phone. Rows whose canvasser_id ≠ the signed-in user are held, not sent and not failed (sending would hit 42501 and wrongly park them). Confirm.

Offline identity — likely a Stage 6 gap the SW alone will not close. FieldProp keys the Dexie lookup on getSession()?.user.id. Once the access token has expired (1 h) and the device is offline, supabase-js attempts a refresh, which fails; depending on version, getSession() may return null, and the cold-open then shows the error state even with the shell served. I propose persisting last_canvasser_id in sync_meta on every successful online load and using it as the fallback key in getCachedToday. This touches Stage 6 code (field-prop.tsx/cache.ts) and must be verified empirically first (load prop, airplane mode, wait >1 h, force-quit, reopen). Needs your go-ahead as it is technically outside "sync queue".

Section 0 vs Stage list. Section 0 says "the queue module built in Stage 8"; the stage list builds it in Stage 7. I am following the stage list. Worth a one-word fix in the brief later.

Acceptance verification. Three of the five checks (50 events flush, mid-flush kill, browser restart) are browser-level and cannot run in Node without fake-indexeddb. Proposal: scripts/verify-stage-7.ts covers replay-idempotency and 4xx classification with real JWTs (matches the Stage 6 harness style), and a development-only window.__d2dSyncDebug = { enqueueSynthetic(n), flush, dump } (guarded by NODE_ENV === "development", tree-shaken from production) supports the manual browser steps, with the script counting resulting rows by a test-prefix. Alternative is a dev-only harness route — I would rather not add a route under /field.

Manifest identity. App name/short name shown on the home screen (currently nakolabs-d2d in metadata — canvassers will see this), theme colour, and icon artwork. I can generate placeholder PNGs from the existing palette tokens, but the name needs a decision.

iOS behaviour to be aware of, not a decision. An installed home-screen app has its own cookies and IndexedDB, partitioned from Safari. A canvasser must sign in and load the prop once inside the installed app; warming Safari does not warm the icon. Also, Safari evicts storage for non-installed sites after 7 days without use — installed apps are exempt, which is another reason to steer canvassers to the home-screen icon.

MapTiler tiles remain uncached. Offline, the map is dots on the fallback background exactly as it is today. Caching tiles is a data-cache concern outside "app shell"; if wanted, it is a separate later decision, not Stage 7.

Constants to confirm or adjust: timer 30 s; backoff base 2 s, cap 5 min; request timeout 10 s; HTML network-first timeout 3 s; static-cache prune age 14 days.

Stopping here as requested — no implementation begun.