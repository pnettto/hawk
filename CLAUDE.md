# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Working with this repo

## Take charge

Run commands yourself instead of handing the user step lists. Default to acting; don't ask "want me to run it?" for routine things. Only stop to confirm when a command is **dangerous** — destructive, hard to reverse, or affects shared/production infrastructure. Examples that require confirmation:

- `deno task deploy` (deploys to prod)
- `git push --force`, `git reset --hard`, `git clean -f`, branch deletes
- `rm -rf` on anything tracked
- Detaching/swapping databases, rotating keys, or any console.deno.com change to prod
- Schema migrations against the prod KV

Routine actions that should be run without asking: building (`deno task build`), starting the dev server (`deno task dev`), running tests (`deno task test`), type-checking (`cd app && npm run check`), editing files, restarting local processes.

## UI copy

Write interface text (labels, buttons, tooltips, dialogs, toasts, empty states, errors) the way a person would say it: direct, natural, and only what needs saying.

- Cut anything the reader can already see. In a confirm dialog the title asks, the buttons answer, and the body only adds what neither says — usually the consequence ("This can't be undone."). If there's nothing to add, leave the body out.
- Name actions by what they do: "Keep in Files" / "Delete file", not "OK" / "Cancel" when the choice is less obvious.
- Plain words, sentence case, no exclamation marks, no filler ("Please", "Successfully", "Are you sure you want to…").
- Errors say what went wrong in a few words ("Couldn't copy to the clipboard."); toasts confirm the result ("File deleted").
- Reuse existing phrasing for the same situation so the app speaks with one voice.

## Commands

| Task | Command |
| --- | --- |
| Dev (Hono + Vite together) | `deno task dev` |
| Server only | `deno task dev:server` |
| Frontend only | `deno task dev:client` |
| Production build | `deno task build` |
| Run prod server locally | `deno task start` |
| Tests (vitest) | `deno task test` |
| Single test file | `cd app && npx vitest run path/to/file.test.ts` |
| Type-check (svelte-check + tsc) | `cd app && npm run check` |
| Deploy to prod | `deno task deploy` |

The npm-flavoured tasks (`build`, `test`, `dev:client`) are wrapped in `sh -c '…'` in `deno.jsonc` so the real Node binary runs them — Deno's task shell would otherwise intercept the npm script and re-execute through its compat layer. Keep that wrapper if you edit those tasks.

If port 8000 is taken, override both ports together: `PORT=8001 BACKEND_PORT=8001 deno task dev`.

## High-level architecture

**Single Hono app, dual surface.** `main.ts` mounts the API under `/api/*`, then falls through to `serveStatic({ root: "./app/dist" })` so the same process serves the SPA in prod. In dev, Vite on `:5173` proxies `/api`, `/shared`, `/kv` → Hono on `:8000`; there is no separate API server.

**Middleware order in `main.ts`:** CORS → rate-limit (with carve-outs for `/api/sync/stream`, `/api/login`'s stricter bucket, and the cheap `/api/auth-check`/`/api/logout`) → auth (skipped for `/api/public/*`, login/logout/auth-check, and the SSE stream which authenticates from its own query string). When adding a new route, decide which buckets it falls into rather than re-implementing the carve-out.

**Storage = Deno KV, plus Cloudflare R2 for file bodies.** KV connection lives in `server/utils/kvConn.ts`: `Deno.openKv(KV_URL)` if set, else native KV. Uploaded file *bodies* go to an R2 bucket via its S3 API (`server/utils/r2.ts`, `aws4fetch`, object key `files/<id>`); file *metadata* stays in KV at `["files", "meta", id]`. Legacy files without `storage: "r2"` still read from KV chunks; `POST /api/files/migrate` moves them. Don't introduce any other store. Key shapes are scattered across `server/routeHandlers/*.ts`; the patterns to know are:

- Notes: `["notes", "note", nid]` (full note) + `["notes", "meta", nid]` (list row), always written together by `server/utils/notesStore.ts` helpers. There are no folders: **tags are `#words` in the body**, parsed on save (`server/utils/tags.ts`, mirrored client-side in `app/src/lib/notes/tags.ts`). Trash is a `deletedAt` field. A note with `day: "YYYY-MM-DD"` is a journal day note — Journal's Day Notes tab and Notepad's "Day Notes" view show the same notes; the day's first note has the fixed id `day-<date>`.
- Notes schema migration: `ensureNotesMigrated()` runs once (flag `["notes", "schema"] = 2`) on the first notes request. It turned legacy collections (`["notes", "collections"]`, `["notes", "collection", cid]`) into a `#tag` line appended to each note, and copied day notes out of the day blob (with their history). Legacy keys are left in place, unread.
- Day log: `["logs", dateStr]` — tasks only for current clients (a legacy `notes` array may still be there; it's no longer read).
- Versions: `server/utils/versioning.ts` is the single helper for snapshotting notes, day-notes, and day-tasks. It keeps a sliding window of `MAX_VERSIONS = 15` per entity, **coalesces** edits within a 60s window into the latest snapshot unless the change is "substantial", and prunes oldest on every write. New version-history endpoints should call this helper, not roll their own keys.
- Sync log: `["sync", "queue", N]` (90s TTL) plus `["sync", "tail"]` (`Deno.KvU64`, the latest N).

**Cross-device sync.** Every mutating route handler should call `emitSyncEvent({ type, ref, cid?, originClientId })` from `server/utils/syncEvents.ts`. That atomically increments the version counter and writes a TTL'd event row. Clients open `/api/sync/stream` (`server/routeHandlers/sync.ts`), which polls the `["sync", "tail"]` counter and reads each new `["sync", "queue", N]` event (not `kv.watch`/`kv.list`, which Deploy's KV proxy rejects intermittently; see `server/utils/syncEvents.ts`). **Echo suppression** is by `originClientId`: handlers grab it via `getClientIdFromCtx(c)` (reads `X-Client-Id` header set by `app/src/api/client.ts`), and the client ignores events whose `originClientId` matches its own. If you add a new mutating route without emitting an event, other tabs/devices won't see the change live — they'll only catch up on their next manual fetch.

**Frontend = Svelte 5 + Tiptap.** Lazy-loaded routes under `app/src/routes/`, building blocks under `app/src/lib/`. State lives in stores (`app/src/stores/`):

- `auth.ts` owns the bearer token; calling `markUnauthenticated()` is the canonical way to drop into the login overlay (the API client does this on 401, the sync store does this after 3 consecutive `hello`-less reconnect failures).
- `notes.ts`, `logs.ts`, `preferences.ts` each expose an `applySyncEvent(evt)` (or `loadFromServer()`) — that's what `stores/sync.ts` dispatches into when an SSE frame arrives.
- `sync.ts` is an EventSource wrapper with jittered exponential backoff (1s → 30s, ±25% jitter). It treats "3 errors in a row, never saw `hello`" as an auth problem and bounces to login.

**API base resolution (`app/src/api/client.ts`).** Order: `localStorage['hawk_api_base']` → build-time `VITE_API_BASE` → `PROD_API_BASE` if `location.protocol === 'chrome-extension:'` → `''` (same-origin). Each tab also gets a `sessionStorage`-scoped `clientId` (UUID) so two tabs in the same browser receive each other's edits live — switching to localStorage would coalesce them into one origin and break that.

**Public sharing.** `/shared/:nid` and `/shared/collection/:cid` (legacy: reads schema-1 collection keys, nothing in the UI links to it anymore) are SSR pages rendered server-side with `marked` (templates in `server/share_template.html` and `server/shared_collection_template.html`). The matching unauth'd JSON endpoints under `/api/public/*` only serve notes/collections whose `isPublic` flag is true — protect that flag carefully on writes.

## Production environment

Deployment details (accounts, database instances, env vars, deploy quirks) live in `CLAUDE.local.md`, which is git-ignored because this repo is public. Don't move them back here, and don't commit secrets, data exports, or personal notes.
