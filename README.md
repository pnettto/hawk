# Hawk

A dark, minimal daily journal: hourly checklist for the day, free-form notes per day, and a markdown notes app with collections, sharing, and trash. Runs on Cloudflare Workers; the same UI also works as a Chrome new-tab extension.

## Stack

- **Backend**: Hono on Cloudflare Workers + one Durable Object (SQLite) + R2 for files (`server/`)
- **Frontend**: Svelte 5 + Vite + TypeScript (`app/`)
- **Editor**: Tiptap (rich markdown)

## Develop

Prereqs: Node ≥ 22, a `.dev.vars` with `API_KEY=...` at the repo root (read by `wrangler dev`).

```sh
npm install && (cd app && npm install)

# Worker on :8787 (wrangler dev, local Durable Object + R2) + Vite on :5173
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` (including the sync WebSocket) and `/shared` to the Worker.

If port 8787 is taken: `BACKEND_PORT=8788 npm run dev`.

## Build

```sh
npm run build     # vite build → app/dist
```

## Test

```sh
npm test          # vitest: server unit tests, then frontend unit + component
npm run check     # tsc for the Worker, svelte-check + tsc for the app
```

## Deploy

```sh
npm run deploy    # builds, then wrangler deploy
```

Secrets: `npx wrangler secret put API_KEY`.

## Project layout

```
app/                    Svelte 5 + Vite frontend
  src/
    api/                Typed fetch wrappers (per resource)
    stores/             Svelte stores: auth, app, logs, notes, toast
    routes/             Page-level components (lazy-loaded)
    lib/                Reusable building blocks
      auth/             Login overlay
      daily/            DatePicker, DailyLog, DayNotes
      notes/            NoteList, NoteEditor, NoteSharePopover
      editor/           RichEditor (Tiptap wrapper)
      ui/               Toast, ZenMode
    types/              Shared model types
    utils/              Pure helpers (date, debounce, constants)
  public/               Static assets served as-is
server/
  worker.ts             Worker entry: forwards /api and /shared to the Durable Object
  hawkDO.ts             The Durable Object: storage, Hono app, sync WebSockets
  app.ts                Hono routes and middleware
  routeHandlers/        Route handlers
  utils/sqliteKv.ts     Deno.Kv-style store on the Durable Object's SQLite
scripts/                One-off tools (Deno KV → Cloudflare migration)
wrangler.jsonc          Worker config: assets, Durable Object, R2, envs
```

Frontend types in `app/src/types/models.ts` mirror the KV shapes used in `server/routeHandlers/notes.ts` and `server/routeHandlers/app.ts`.

## Chrome new-tab extension

The extension and the web app share the same Vite build. Two notable differences:

- **Backend URL**: in the extension, `fetch('/api/...')` would resolve to `chrome-extension://...`. The frontend reads an absolute base from (in order) `localStorage['hawk_api_base']` → `VITE_API_BASE` env at build time → `location.origin`. For the extension build it defaults to the prod Worker URL; set `VITE_API_BASE` to point it elsewhere.
- **Manifest**: `app/public/manifest.json` is shipped into every `dist/`. Update its `host_permissions` to the same backend URL.

Build and load:

```sh
npm run build
# Then in chrome://extensions: enable Developer mode → Load unpacked → pick app/dist/
```

The Vite production build emits no `eval`, so it's compatible with Manifest V3 CSP.

## Backlog

- Add search: type a word to go to day
- Report: mood stats in period, finished tasks in period
- Save settings automatically for the next load
- Auto backup
- Export function: to markdown, csv
- Settings page: customize time window, theme
- Notifications
- Sync with Calendar
- Add note per task instead of general one
- Full week view (report)
