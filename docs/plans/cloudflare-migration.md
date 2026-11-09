# Plan: move Hawk to Cloudflare (Workers + D1 + Durable Objects)

Status: proposal · Created 2026-11-09

## Goal

Run Hawk entirely on Cloudflare's free tier and replace Deno KV with D1 (SQLite), so that:

- notes get real full-text search (FTS5) on the server, with no note bodies downloaded to the client;
- data access becomes plain SQL instead of hand-maintained key layouts;
- live sync pushes changes over WebSockets instead of polling a KV event queue;
- files, database and server all live in one account (R2 is already there).

## Target architecture

```
Browser / Chrome extension (Svelte SPA)
   │ HTTPS                         │ WebSocket
   ▼                               ▼
Worker (Hono) ───────────────► Durable Object "SyncHub"
   │  auth, rate limit,            holds sockets, broadcasts
   │  /api/*, /shared/*            changes, hibernates when idle
   ├──► D1     notes, notes_fts, versions, day_logs, files, preferences
   ├──► R2     file bodies (same bucket, via binding)
   └──► Static Assets  app/dist (SPA fallback)
```

## Principles

- **Keep the HTTP API the same.** Same paths, request and response shapes. The frontend and the guest demo (`app/src/api/guest.ts`) shouldn't notice the backend changed. The only client change is the sync transport.
- **Keep behaviour the same.** Version history (15 snapshots, 60s coalescing), tag parsing, trash, day notes, public sharing rules (`isPublic`) all work exactly as today.
- **One data layer.** All SQL lives in `server/db/`. Route handlers call functions there; they never write SQL inline. This replaces `kvConn.ts`, `notesStore.ts` and the KV parts of `versioning.ts`.
- **Prod stays on Deno Deploy until cutover**, and stays available read-only for a while after it as a fallback.

## Schema (first draft)

```sql
notes(id PK, title, content, preview, tags JSON, day, day_order,
      is_public, created_at, updated_at, deleted_at, rev)
notes_fts  -- FTS5 over (title, content), kept in sync by triggers on notes
versions(kind, entity_id, saved_at, preview, payload JSON,
         PK(kind, entity_id, saved_at))          -- note | day-notes | day-tasks
day_logs(date PK, body JSON, rev)
files(id PK, name, mime, size, created_at, is_public, ...)
preferences(key PK, value JSON)
sync_cursor -- not needed: SyncHub holds live state in memory
```

Indexes: `notes(deleted_at, updated_at)`, `notes(day)`. Tag filtering can start as `json_each(tags)`; add a `note_tags` table only if it's slow.

The legacy schema-1 collection keys and `ensureNotesMigrated()` go away: the migration script reads notes after KV's own schema-2 migration has already run.

## Phases

### 0. Setup (~0.5 day)
- Cloudflare account resources: Worker `hawk`, D1 database `hawk`, bind the existing R2 bucket, SyncHub Durable Object class.
- `wrangler.jsonc` with bindings (`DB`, `FILES`, `SYNC_HUB`, assets), secrets (`API_KEY`).
- Dev: `wrangler dev` replaces `deno task dev:server`; Vite keeps proxying `/api` and `/shared` to it. Update `deno.jsonc` tasks (or move them to `package.json`).
- Decide the public URL (see open questions).

### 1. Port the runtime (~1 day)
Hono itself carries over. Replace the Deno-specific bits:
- `Deno.env.get(...)` → `c.env.*` (auth middleware, auth routes, r2).
- `Deno.readTextFile` for the share templates → import the HTML as text modules.
- `serveStatic` → Workers Static Assets with SPA fallback; `/api/*` and `/shared/*` run the Worker first.
- R2 via `aws4fetch` → R2 binding (`env.FILES.get/put/delete`). Drops the R2 access keys.
- Rate limiting → Workers rate-limiting binding, or a small D1 table if the binding doesn't fit the login bucket.
- Drop `server/future/` and `/api/entries` (the KV browser) or replace the latter with a read-only table dump for Admin.

### 2. Data layer on D1 (~2 days)
Port area by area, each with tests, in this order:
1. Preferences (smallest, proves the setup).
2. Notes + note meta + tags (`server/db/notes.ts`), including trash, restore, empty trash, public reads.
3. Versioning for notes, day notes and day tasks (`server/db/versions.ts`), same window and coalescing rules; pruning becomes one `DELETE`.
4. Day logs, including the compare-and-set in `setDayLog` (`UPDATE … WHERE rev = ?`).
5. File metadata. File bodies stay in R2 under `files/<id>`.

### 3. Live sync via Durable Object (~1 day)
- One `SyncHub` instance (single user). Worker route `/api/sync/ws` authenticates (token in query string, as the SSE route does now) and forwards the upgrade to it.
- Put the token in the first WebSocket message instead of the URL if possible, so it doesn't end up in request logs.
- Use the WebSocket Hibernation API so an idle hub costs nothing.
- `emitSyncEvent(...)` keeps its signature; it now calls the hub, which broadcasts to every socket except the one whose `clientId` matches `originClientId`.
- Client: `app/src/stores/sync.ts` swaps `EventSource` for `WebSocket`, keeping the backoff, the "never saw hello → login" rule, and the `applySyncEvent` dispatch. Stores don't change.
- On reconnect the client does what it does today after a gap: refetch the notes index and open note.

### 4. Search (~1 day)
- `GET /api/notes/search?q=&limit=` → FTS5 `MATCH` on live notes, ranked with `bm25`, returning `{id, title, snippet, day, tags}` with `snippet()` highlights. Prefix matching on the last word for search-as-you-type.
- UI in the notes column: search field, results list with highlighted snippets, keyboard navigation, shortcut.
- Guest demo: same endpoint implemented in `guest.ts` as a simple substring match over localStorage notes.

### 5. Data migration (~0.5–1 day)
1. On current prod, run `POST /api/files/migrate` so no file bodies remain in KV.
2. Export: `GET /api/entries` (already dumps every KV entry, auth'd) → `kv-export.json`. Keep this file as a backup. **It contains every note, private ones included, and the repo is public:** store it outside the repo (the `.gitignore` entries are only a safety net) and never commit it, `seed.sql`, or anything derived from them.
3. Transform script (`scripts/kv-to-d1.ts`): map key shapes to rows, write `seed.sql`.
4. Import: `wrangler d1 execute hawk --remote --file seed.sql` (runs outside the Worker, so no CPU limits).
5. Verify: compare counts per table with the export (live notes, trashed notes, versions, day logs, files), spot-check a few notes and a shared note page.

Do a full dry run against a staging D1 database first.

### 6. Cutover (~0.5 day) — confirm with the owner before each step
1. Announce a short freeze; stop editing on all devices.
2. Final export → import (phase 5) into prod D1.
3. Deploy the Worker; point the domain at it.
4. Update the Chrome extension: `host_permissions` and the prod API base in `app/src/api/client.ts`. Rebuild and reload.
5. Smoke test: login, edit a note on two devices (live sync), search, upload/download a file, open a shared link.
6. Leave Deno Deploy running read-only for ~2 weeks as a fallback, then retire it.

### 7. Cleanup (~0.5 day)
- Remove Deno KV code, `kvConn.ts`, the KV sync queue, `server/future/`.
- Rewrite `CLAUDE.md` (architecture, commands, production environment, "don't introduce another store" rule).
- Backups: a scheduled Worker (cron trigger) that exports D1 to R2 daily, on top of D1's built-in point-in-time recovery.

**Total: about 6–8 days.**

## Testing
- Data layer tests run against a real local D1 via `@cloudflare/vitest-pool-workers`.
- Keep existing frontend tests green (`deno task test` / `npm test`).
- Before cutover: run the app against a D1 seeded from a copy of prod data, and use it for a day.

## Free-tier limits to watch
- **10 ms CPU per request** on the free Workers plan. Normal requests are far below that; rendering a very large shared note with `marked` is the one to measure. Bulk work (import, reindex) runs through `wrangler`, not the Worker.
- D1 free: 5 GB storage, 5M rows read and 100k rows written per day: plenty for one user.
- Durable Objects on the free plan must use the SQLite storage backend. SyncHub needs no storage, so this doesn't matter.

## Risks
- **Sync regressions** are the most visible failure. Keep the client's merge logic (`app/src/sync/merge.ts`) untouched, and test two tabs plus the extension before cutover.
- **Migration mistakes** in key-to-row mapping. Mitigated by the dry run, count checks, and keeping the raw export.
- **Extension pinned to the old URL.** Ship the new build at cutover; the Deno Deploy fallback keeps old builds working (read-only) meanwhile.

## Open questions
- Public URL: a `*.workers.dev` subdomain, or a custom domain (needs a domain on Cloudflare)?
- Keep the KV browser in Admin as a read-only table viewer, or drop it?
- Should cutover move the share links (`/shared/:nid`)? Old links on `hawk.pnettto.deno.net` could redirect from a stub left on Deno Deploy.
