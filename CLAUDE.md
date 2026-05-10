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

**Storage = Deno KV only.** Connection lives in `server/utils/kvConn.ts`: `Deno.openKv(KV_URL)` if set, else native KV. Don't introduce a second store. Key shapes are scattered across `server/routeHandlers/*.ts`; the patterns to know are:

- Notes: `["notes", "note", nid]`, `["notes", "index", cid, nid]`, trash mirrors under `["notes", "trash", …]`.
- Day log: `["logs", "day", dateStr]` with separate "notes" / "tasks" components.
- Versions: `server/utils/versioning.ts` is the single helper for snapshotting notes, day-notes, and day-tasks. It keeps a sliding window of `MAX_VERSIONS = 15` per entity, **coalesces** edits within a 60s window into the latest snapshot unless the change is "substantial", and prunes oldest on every write. New version-history endpoints should call this helper, not roll their own keys.
- Sync log: `["sync", "event", <ulid>]` (90s TTL) plus `["sync", "version"]` (`Deno.KvU64`).

**Cross-device sync.** Every mutating route handler should call `emitSyncEvent({ type, ref, cid?, originClientId })` from `server/utils/syncEvents.ts`. That atomically increments the version counter and writes a TTL'd event row. Clients open `/api/sync/stream` (`server/routeHandlers/sync.ts`) which `kv.watch`es the version key and `kv.list`s events past their last-seen ULID. **Echo suppression** is by `originClientId`: handlers grab it via `getClientIdFromCtx(c)` (reads `X-Client-Id` header set by `app/src/api/client.ts`), and the client ignores events whose `originClientId` matches its own. If you add a new mutating route without emitting an event, other tabs/devices won't see the change live — they'll only catch up on their next manual fetch.

**Frontend = Svelte 5 + Tiptap.** Lazy-loaded routes under `app/src/routes/`, building blocks under `app/src/lib/`. State lives in stores (`app/src/stores/`):

- `auth.ts` owns the bearer token; calling `markUnauthenticated()` is the canonical way to drop into the login overlay (the API client does this on 401, the sync store does this after 3 consecutive `hello`-less reconnect failures).
- `notes.ts`, `logs.ts`, `preferences.ts` each expose an `applySyncEvent(evt)` (or `loadFromServer()`) — that's what `stores/sync.ts` dispatches into when an SSE frame arrives.
- `sync.ts` is an EventSource wrapper with jittered exponential backoff (1s → 30s, ±25% jitter). It treats "3 errors in a row, never saw `hello`" as an auth problem and bounces to login.

**API base resolution (`app/src/api/client.ts`).** Order: `localStorage['hawk_api_base']` → build-time `VITE_API_BASE` → `PROD_API_BASE` if `location.protocol === 'chrome-extension:'` → `''` (same-origin). Each tab also gets a `sessionStorage`-scoped `clientId` (UUID) so two tabs in the same browser receive each other's edits live — switching to localStorage would coalesce them into one origin and break that.

**Public sharing.** `/shared/:nid` and `/shared/collection/:cid` are SSR pages rendered server-side with `marked` (templates in `server/share_template.html` and `server/shared_collection_template.html`). The matching unauth'd JSON endpoints under `/api/public/*` only serve notes/collections whose `isPublic` flag is true — protect that flag carefully on writes.

## Production environment

**Platform:** Deno Deploy (new console at https://console.deno.com), org `pnettto`, app `hawk`. Public URL: https://hawk.pnettto.deno.net. Observability/logs: https://console.deno.com/pnettto/hawk/observability/logs.

**Stack:**
- Backend: Hono (`npm:hono@^4.11.1`), entry point `main.ts`, run with `deno run --allow-net --allow-env --allow-read --unstable-kv --env main.ts`.
- Frontend: Svelte 5 + Vite, source in `app/`, built to `app/dist/`, served as static assets by the same Hono app in prod (same-origin).
- Storage: Deno KV via `Deno.openKv()` (no URL → native Deploy KV). Connection lives in `server/utils/kvConn.ts`.

**KV on Deploy:**
- Database: `Zbc218-production`, instance currently attached to Production timeline is named `backup` (yes, oddly named). Created ~4 months ago. There's also a `Zbc218-preview` DB for preview/branch timelines.
- Auth tokens are baked into a deployment at build time. After detaching/swapping a KV instance, **redeploy** — otherwise the running runtime gets `InvalidAuthorizationHeader` calling `kvdb.localhost` (Deploy's internal KV proxy host). The SSE sync stream (`server/routeHandlers/sync.ts`, `kv.watch` + `kv.list`) is the loudest symptom.

**Env vars on prod (set in console.deno.com → Settings → Environment Variables):**
- `ALLOWED_ORIGINS` = `https://hawk.pnettto.deno.net`
- `API_KEY` — secret
- `BACKUP_KEY` — secret
- `KV_URL` — **not set** (intentional; lets `Deno.openKv()` pick native KV).

**Local env** (`.env` at repo root) only carries `API_KEY` and is loaded by `--env` on the dev server task. CORS in `main.ts:58` is `origin: "*"` so cross-origin clients (Chrome extension, alt domains) are accepted.

**Deploy flow:**
- `deno task deploy` runs `deno task build` then `deno deploy --org pnettto --app hawk --prod`. The deploy wrapper temporarily un-ignores `app/dist` in `.gitignore`/`app/.gitignore` so Vite's build output ships (because `deno deploy` respects `.gitignore` — denoland/deploy_feedback#940) — `trap` restores them after.
- `deno task build` does `cd app && npm install && npm run build` (Vite build into `app/dist`).
- There is **no preview/branch deploy task** — `deno deploy` without `--prod` would target a preview timeline if invoked.

**Dev topology:**
- `deno task dev` runs two processes via `concurrently`: Hono on `:8000` and Vite on `:5173`. Vite proxies `/api`, `/shared`, `/kv` → `localhost:8000`. Configure backend port with `BACKEND_PORT` env (default 8000).

**Chrome extension (Hawk):** `app/public/manifest.json` — new-tab override, MV3. `host_permissions` lists only `https://hawk.pnettto.deno.net/*`. The same Svelte SPA is loaded as the extension page; `app/src/api/client.ts` detects `location.protocol === 'chrome-extension:'` and hardcodes API base to the prod URL unless overridden by `VITE_API_BASE` (build-time) or a `hawk_api_base` localStorage key (runtime). To point a built extension at a local backend you must add `http://localhost:8000/*` to `host_permissions` and rebuild.

**Routes that matter for ops:**
- `/api/sync/stream` (SSE) — exempt from auth middleware (auths from query string) and rate limit; reconnects with jittered backoff client-side (`app/src/stores/sync.ts`).
- `/api/login` — its own stricter rate-limit bucket.
- `/api/public/notes/:id` — public sharing endpoint, served without auth when a note's `isPublic` is true.

**Things to remember when touching prod:**
- A stale KV token after console-side changes ⇒ redeploy fixes it.
- Don't set `KV_URL` on Deploy unless you mean to bypass native KV.
- The Production instance attachment is named `backup` — don't "fix" the name without confirming; renaming/swapping instances detaches the active token until a redeploy.
