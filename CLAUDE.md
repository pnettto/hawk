# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Working with this repo

## Take charge

Run commands yourself instead of handing the user step lists. Default to acting; don't ask "want me to run it?" for routine things. Only stop to confirm when a command is **dangerous** — destructive, hard to reverse, or affects shared/production infrastructure. Examples that require confirmation:

- `npm run deploy` / `wrangler deploy` (deploys to prod)
- `git push --force`, `git reset --hard`, `git clean -f`, branch deletes
- `rm -rf` on anything tracked
- Rotating secrets, deleting Durable Objects/R2 buckets, or any Cloudflare dashboard change to prod
- Data migrations or imports against the prod Durable Object

Routine actions that should be run without asking: building (`npm run build`), starting the dev server (`npm run dev`), running tests (`npm test`), type-checking (`npm run check`), editing files, restarting local processes.

## UI copy

Write interface text (labels, buttons, tooltips, dialogs, toasts, empty states, errors) the way a person would say it: direct, natural, and only what needs saying.

- Cut anything the reader can already see. In a confirm dialog the title asks, the buttons answer, and the body only adds what neither says — usually the consequence ("This can't be undone."). If there's nothing to add, leave the body out.
- Name actions by what they do: "Keep in Files" / "Delete file", not "OK" / "Cancel" when the choice is less obvious.
- Plain words, sentence case, no exclamation marks, no filler ("Please", "Successfully", "Are you sure you want to…").
- Errors say what went wrong in a few words ("Couldn't copy to the clipboard."); toasts confirm the result ("File deleted").
- Reuse existing phrasing for the same situation so the app speaks with one voice.

## UI and interaction

Interactions should feel direct and stay stable with a fast pointer or on a slow phone. Task reordering in `lib/daily/DayTasks.svelte` is the reference implementation.

- **Move the thing, not a stand-in.** During a gesture the element itself follows the pointer and the surrounding content makes room. Show the result while dragging, not only on release, and don't replace movement with a temporary drop border.
- **Preview in transforms; commit once.** Capture row geometry when the gesture starts and keep using it, computing insertion from stable midpoints. Offset rows with `transform`, animate `transform`/`opacity` only, and write the real order once when the gesture ends. Re-measuring transformed rows or writing state on every pointer move causes jitter and fights the animation.
- **Use Pointer Events for dragging.** `setPointerCapture` keeps the gesture alive outside the element; handle `pointercancel` and `lostpointercapture`; `touch-action: none` on the handle stops the page scrolling under a touch drag. `Escape` cancels.
- **Make edge cases easy.** Auto-scroll near the viewport edge with `requestAnimationFrame`. Clamp stale indexes if the list changes mid-gesture, and no-op if the dragged item disappeared.
- **Always provide a non-drag path.** Keyboard arrows on the focused handle reorder it. Controls get `aria-label`s and `aria-pressed`/`aria-disabled` where they map to state, comfortable touch targets, `:focus-visible`, and hover feedback.
- **Motion uses the shared tokens.** Use `--dur-fast`/`--dur-base` with `--ease-out`/`--ease-spring`, and `utils/safeFlip` for list movement. Keep transitions short; the global `prefers-reduced-motion` rule already removes them.
- **Keep transient states quiet.** Lift a moving row with elevation or background instead of accent-colored borders. Put a mode toggle next to the related action, and only show affordances such as reorder handles while that mode is on.
- **Save on settle, not on every frame.** Batch the final change through the existing saving/flush path so the UI never shows per-move network saves.
- **Prefer one predictable rule.** Simple, stable geometry (cross a row's midpoint to insert) beats special cases for each direction. If a gesture needs a branch per case, simplify until it doesn't.

Reuse the shared controls in `lib/ui/` and the global CSS/tokens before adding one-off markup or styles.

## Commands

| Task | Command |
| --- | --- |
| Dev (Worker + Vite together) | `npm run dev` |
| Worker only (`wrangler dev`, :8787) | `npm run dev:server` |
| Frontend only (Vite, :5173) | `npm run dev:client` |
| Production build | `npm run build` |
| Tests (vitest, server + app) | `npm test` |
| Single app test file | `cd app && npx vitest run path/to/file.test.ts` |
| Type-check (tsc for the Worker, svelte-check + tsc for the app) | `npm run check` |
| Deploy to prod | `npm run deploy` |

Local secrets for `wrangler dev` live in `.dev.vars` (`API_KEY=...`), git-ignored. If port 8787 is taken: `BACKEND_PORT=8788 npm run dev`.

## Where things live

Go straight to these instead of exploring. Frontend paths are under `app/src/`.

| Area | Files |
| --- | --- |
| Shell: nav, page switching, lazy routes | `App.svelte`, `stores/app.ts` (`Page`, `JournalTab`) |
| Journal: date picker, tasks, day notes | `routes/Journal.svelte`, `lib/daily/` (`DatePicker`, `DayTasks`, `DayNotes`, `quickTask.ts` for "14:30 Gym" parsing), `stores/logs.ts` |
| Focus timer (pomodoro) | `stores/pomodoro.ts` (focus/break phases, localStorage), `lib/daily/PomodoroWidget.svelte` (floating widget, mounted in `App.svelte`), start button on each task row in `DayTasks.svelte`; block lengths come from extension settings |
| Extensions (optional features) | `lib/extensions/registry.ts` (list, defaults, sanitising), `routes/Extensions.svelte` (toggles + settings), saved under the `extensions` key of the preferences blob. New features get a registry entry and an `extensionState($preferencesStore.extensions, id).enabled` check where they render |
| Overview (date-range roll-up) | `routes/Overview.svelte` |
| Notepad: list, filter menu, editor, sharing | `routes/Notes.svelte`, `lib/notes/` (`NotesColumn`, `NotesFilter`, `NoteEditor`, `NoteSharePopover`, `tags.ts`), `stores/notes.ts` |
| Rich text editor (Tiptap) | `lib/editor/` (`RichEditor`, `schema.ts`, `blocks.ts` for the +/"/" menu, `paste.ts`) |
| Editing sync and merging | `sync/docSession.ts`, `sync/merge.ts`, `stores/sync.ts` |
| Files | `routes/Files.svelte`, `stores/files.ts` |
| Settings and themes | `routes/Admin.svelte`, `lib/themes/`, `stores/preferences.ts`, `app/public/css/themes.css` |
| Shared UI: dialogs, toasts, popovers, time picker | `lib/ui/`, `stores/confirm.ts`, `stores/toast.ts` |
| Login, guest mode ("Let me test it") | `lib/auth/Auth.svelte`, `stores/auth.ts`, `api/guest.ts` |
| API client per resource | `api/*.ts` (`client.ts` is the base) |
| Shared types | `types/models.ts` |
| Global CSS, logo, favicon | `app/public/css/` (`variables.css`, `base.css`), `app/public/logo.svg`, `app/public/favicon.svg` |
| Server routes | `server/app.ts` (route table), `server/routeHandlers/*.ts` |
| Server storage helpers | `server/utils/` (`notesStore.ts`, `dayLog.ts`, `versioning.ts`, `syncEvents.ts`, `tags.ts`) |

Tests sit next to the code as `*.test.ts`.

## High-level architecture

**Worker → one Durable Object.** `server/worker.ts` is the Worker entry. Static Assets serve the SPA from `app/dist` (with SPA fallback); only `/api/*` and `/shared/*` run the Worker (`run_worker_first` in `wrangler.jsonc`), and it forwards them all to a single Durable Object instance, `HawkDO` named `"hawk"` (`server/hawkDO.ts`). The DO owns the data, runs the Hono app (`server/app.ts`), and holds the sync WebSockets. Single user means a single instance, so there are no cross-instance consistency issues, and in-memory state (rate limits) sees all traffic. In dev, Vite on `:5173` proxies `/api` (with `ws: true`) and `/shared` to `wrangler dev` on `:8787`.

**Middleware order in `server/app.ts`:** CORS → rate-limit (with carve-outs for `/api/login`'s stricter bucket and the cheap `/api/auth-check`/`/api/logout`) → auth (skipped for `/api/public/*` and login/logout/auth-check). `/api/sync/ws` never reaches Hono: `HawkDO.fetch` handles it and authenticates from the query string. When adding a new route, decide which buckets it falls into rather than re-implementing the carve-out. Rate limits are an in-memory `Map` in the DO (`server/middleware/rateLimit.ts`).

**Storage = the DO's SQLite behind a Deno.Kv-style API, plus R2 for file bodies.** `server/utils/sqliteKv.ts` implements the subset of `Deno.Kv` Hawk uses (`get`, `getMany`, `set`, `delete`, `list` by prefix/start/end, `atomic()` with `check`/`set`/`delete`) on one `kv` table, with an order-preserving key encoding so range lists behave like Deno KV. Handlers import `kv` from `server/utils/kvConn.ts`, initialised by the DO constructor. This kept the old Deno KV key layout intact; the data moved over key for key (`scripts/kv-to-cloudflare.ts`). Uploaded file *bodies* go to R2 through the `FILES` binding (`server/utils/r2.ts`, object key `files/<id>`); uploads stream through `FixedLengthStream` (the DO has 128 MB of memory) and require `Content-Length`. File *metadata* stays in KV at `["files", "meta", id]`. Legacy files without `storage: "r2"` still read from KV chunks; `POST /api/files/migrate` moves them. Don't introduce any other store. Key shapes are scattered across `server/routeHandlers/*.ts`; the patterns to know are:

- Notes: `["notes", "note", nid]` (full note) + `["notes", "meta", nid]` (list row), always written together by `server/utils/notesStore.ts` helpers. There are no folders: **tags are `#words` in the body**, parsed on save (`server/utils/tags.ts`, mirrored client-side in `app/src/lib/notes/tags.ts`). Trash is a `deletedAt` field. A note with `day: "YYYY-MM-DD"` is a journal day note — Journal's Day Notes tab and Notepad's "Day Notes" view show the same notes; the day's first note has the fixed id `day-<date>`.
- Notes schema migration: `ensureNotesMigrated()` runs once (flag `["notes", "schema"] = 2`) on the first notes request. It turned legacy collections (`["notes", "collections"]`, `["notes", "collection", cid]`) into a `#tag` line appended to each note, and copied day notes out of the day blob (with their history). Legacy keys are left in place, unread.
- Day log: `["logs", dateStr]` — tasks only for current clients (a legacy `notes` array may still be there; it's no longer read).
- Versions: `server/utils/versioning.ts` is the single helper for snapshotting notes, day-notes, and day-tasks. It keeps a sliding window of `MAX_VERSIONS = 15` per entity, **coalesces** edits within a 60s window into the latest snapshot unless the change is "substantial", and prunes oldest on every write. New version-history endpoints should call this helper, not roll their own keys.
- Size caps (`MAX_NOTE_BYTES`, `MAX_DAY_BYTES`, 63 KiB) are inherited from Deno KV and kept so clients behave the same.
- `GET /api/admin/export` / `POST /api/admin/import` dump and restore raw entries (wire format in `server/routeHandlers/admin.ts`), for backups and migration.

**Cross-device sync.** Every mutating route handler should call `emitSyncEvent({ type, ref, originClientId })` from `server/utils/syncEvents.ts`. The DO registers a broadcaster that sends the event to every open WebSocket except the originating tab's. Clients connect to `/api/sync/ws?token=…&clientId=…`; each socket is tagged with its `clientId`, which is how **echo suppression** works (handlers get `originClientId` via `getClientIdFromCtx(c)`, from the `X-Client-Id` header set by `app/src/api/client.ts`). Sockets use the **WebSocket Hibernation API**, so idle tabs cost nothing; clients send `"ping"` every 30s and the runtime auto-answers `"pong"` without waking the DO. Nothing is queued: events missed while disconnected aren't replayed. If you add a new mutating route without emitting an event, other tabs/devices won't see the change live — they'll only catch up on their next manual fetch.

**Frontend = Svelte 5 + Tiptap.** Lazy-loaded routes under `app/src/routes/`, building blocks under `app/src/lib/`. State lives in stores (`app/src/stores/`):

- `auth.ts` owns the bearer token; calling `markUnauthenticated()` is the canonical way to drop into the login overlay (the API client does this on 401, the sync store does this after 3 consecutive `hello`-less reconnect failures).
- `notes.ts`, `logs.ts`, `preferences.ts` each expose an `applySyncEvent(evt)` (or `loadFromServer()`) — that's what `stores/sync.ts` dispatches into when a WebSocket frame arrives.
- `sync.ts` is a WebSocket wrapper with jittered exponential backoff (1s → 30s, ±25% jitter) and a dead-socket check (no traffic for 75s → reconnect). It treats "3 closes in a row, never saw `hello`" as an auth problem and bounces to login.

**API base resolution (`app/src/api/client.ts`).** Order: `localStorage['hawk_api_base']` → build-time `VITE_API_BASE` → `PROD_API_BASE` if `location.protocol === 'chrome-extension:'` → `''` (same-origin). Each tab also gets a `sessionStorage`-scoped `clientId` (UUID) so two tabs in the same browser receive each other's edits live — switching to localStorage would coalesce them into one origin and break that.

**Public sharing.** `/shared/:nid` and `/shared/collection/:cid` (legacy: reads schema-1 collection keys, nothing in the UI links to it anymore) are SSR pages rendered server-side with `marked` (templates in `server/share_template.html` and `server/shared_collection_template.html`, imported as text modules). The matching unauth'd JSON endpoints under `/api/public/*` only serve notes/collections whose `isPublic` flag is true — protect that flag carefully on writes.

## Production environment

Deployment details (accounts, database instances, env vars, deploy quirks) live in `CLAUDE.local.md`, which is git-ignored because this repo is public. Don't move them back here, and don't commit secrets, data exports, or personal notes.
