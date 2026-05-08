# Hawk

A dark, minimal daily journal: hourly checklist for the day, free-form notes per day, and a markdown notes app with collections, sharing, and trash. Backend persists to Deno KV; the same UI also works as a Chrome new-tab extension.

## Stack

- **Backend**: Deno + Hono + Deno KV (`main.ts`, `server/`)
- **Frontend**: Svelte 5 + Vite + TypeScript (`app/`)
- **Editor**: Tiptap (rich markdown)

## Develop

Prereqs: Deno ≥ 2, Node ≥ 22, an `.env` with `API_KEY=...` at the repo root.

```sh
# Install frontend deps once
cd app && npm install && cd ..

# Run server (Hono on :8000) + Vite dev server (:5173) together with HMR
deno task dev
```

Open http://localhost:5173 — Vite proxies `/api`, `/shared`, and `/kv` to Hono.

If port 8000 is taken, override both ports:

```sh
PORT=8001 BACKEND_PORT=8001 deno task dev
```

## Build & run prod

```sh
deno task build   # vite build → app/dist
deno task start   # Hono serves app/dist on :8000
```

## Test

```sh
deno task test    # vitest (unit + component)
```

## Deploy

```sh
deno task deploy  # builds, then deno deploy
```

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
server/                 Hono route handlers, middleware, KV utils
main.ts                 Hono entry — serves API + app/dist
```

Frontend types in `app/src/types/models.ts` mirror the KV shapes used in `server/routeHandlers/notes.ts` and `server/routeHandlers/app.ts`.

## Chrome new-tab extension

The extension and the web app share the same Vite build. Two notable differences:

- **Backend URL**: in the extension, `fetch('/api/...')` would resolve to `chrome-extension://...`. The frontend reads an absolute base from (in order) `localStorage['hawk_api_base']` → `VITE_API_BASE` env at build time → `location.origin`. For the extension build, set `VITE_API_BASE` to your deployed Hono URL.
- **Manifest**: `app/public/manifest.json` is shipped into every `dist/`. Update its `host_permissions` to the same backend URL.

Build and load:

```sh
VITE_API_BASE=https://hawk.pnettto.deno.net deno task build
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
