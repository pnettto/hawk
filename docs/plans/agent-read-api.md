# Read API for the Pi agent

## Context

The Pi `hawk` tool (`pi-agent-config/extensions/hawk-report`) can post notes, journal entries, notepad notes, tasks, files and reports, but it can't read anything back. This plan adds four read endpoints for it, plus the cleanup they depend on.

The endpoints use the same login and Bearer token as writes: `POST /api/login` → `{ token }`, sent as `Authorization: Bearer <token>`. There's no separate scope or read-only token. Anyone who can use the API can read everything, hidden notes included. Hawk has one password and no user accounts, so there's nothing finer-grained to check.

On the Pi side, reads don't go through the manual confirmation that uploads use. That's a change to the Pi tool, not to Hawk.

What exists today:

- **Raw note reads:** `GET /api/notes/notes/:nid` returns the stored note as-is (millisecond timestamps, internal fields), and `GET /api/notes/index` returns every note's list row, trash included.
- **Day reads:** `GET /api/day?date=` returns the day's tasks.
- **Search:** `GET /api/search` uses the matcher in `server/utils/search.ts`.
- **Not-found responses:** unknown `/api` routes answer with plain text `"Not found"`, and `app.onError` sends `err.stack` back to the client. Auth failures are already JSON `401`. Hawk has no HTML login page. Only paths outside `/api` and `/shared` fall through to the SPA's `index.html`.

## Decisions

- **Two note types, worked out from the stored fields:**
  - `notepad`: no `day`. Created from the Notepad.
  - `journal`: `day` set. Created inside a Journal day.

  Pi's `note` route already creates a note with no day, so it's a notepad note. `type=note` is accepted as another name for `notepad`. Reports are journal notes, so they come back as `type: "journal"`.
- **`source` instead of `author`.** Every note has the same author (the one user), so `author` would carry no information. Instead, a note records where it was created: `"web"`, `"pi"`, and so on.
  - It's set once, when the note is created, and later edits never change it. A Pi note edited in the browser stays `"pi"`.
  - Notes created before this ship have no source, which comes back as `null`. Don't backfill guesses.
- **Remove stranded notepad posts.** Pi's `notepad` route posts to `POST /api/day/notes`. That endpoint writes into the legacy `notes` array inside the day record (`["logs", date].notes`), which no client has read since schema 2. Those posts were never visible in Hawk.
  - Delete them rather than migrating them.
  - Retire the endpoints so nothing can end up there again.
  - Pi's `notepad` route moves to `POST /api/notes/notes`.
- **Trash:** list endpoints leave trashed notes out. `GET /api/notes/:id` still returns a trashed note, with `trashedAt` set, so the Pi report check can tell the note is trashed rather than gone.
- **Timestamps:** the read API returns ISO 8601 strings. The internal API keeps milliseconds.

## API

All endpoints are `GET` and require auth. Errors use the existing shape `{ "error": "<message>" }`.

| Status | When |
| --- | --- |
| 200 | Found |
| 400 | Bad parameter: malformed date, unknown `type`, `limit` outside 1–200 |
| 401 | Missing or wrong token (already the auth middleware's answer) |
| 404 | The item doesn't exist, or the `/api` route is unknown (now JSON) |
| 429 | Rate limited (existing general bucket) |

### Note resource

```jsonc
{
  "id": "dbcd2f8e-…",                 // the id in its link, /notes/<id>
  "title": "…",
  "type": "notepad" | "journal",
  "date": "2026-11-20" | null,        // the Journal day; null for notepad notes
  "source": "pi" | "web" | null,      // null for notes created before this ships
  "createdAt": "2026-11-20T09:12:03.000Z",
  "updatedAt": "2026-11-20T10:01:44.000Z",
  "url": "https://hawk.pnetto.store/notes/dbcd2f8e-…",
  "tags": ["work"],
  "hidden": false,
  "trashedAt": null,                  // ISO string when in the trash
  "content": "# Full Markdown…"
}
```

`url` is built from the request's origin, with the id run through `encodeURIComponent`.

### `GET /api/notes/:id`

Returns one note resource, or 404 `{ "error": "Note not found" }`.

### `GET /api/notes?type=&date=&q=&limit=`

Every filter is optional.

| Param | Meaning |
| --- | --- |
| `type` | `notepad` (alias `note`) or `journal` |
| `date` | `YYYY-MM-DD`; only journal notes on that day |
| `q` | Same syntax as ⌘K search: AND terms, `"phrases"`, `#tag` |
| `limit` | Default 50, max 200 |

```jsonc
{
  "items": [ /* note resource without `content`, plus `preview` */ ],
  "truncated": false
}
```

- Newest `updatedAt` first.
- `preview` is the existing 140-character `buildPreview` text. Hidden notes get no preview.
- Without `q`, the list reads only the metadata rows (`["notes", "meta", *]`). With `q`, it scans full notes through the search matcher, the same way `/api/search` does.

### `GET /api/tasks?date=YYYY-MM-DD`

`date` is required (400 without it). The server runs in UTC, so a default "today" could be the wrong day for the caller.

```jsonc
{
  "date": "2026-11-20",
  "url": "https://hawk.pnetto.store/journal/2026-11-20",
  "tasks": [
    {
      "id": "…", "text": "Review the PR",
      "status": "open" | "done",
      "time": "09:30" | null,
      "comment": "…" | null,
      "parentId": "…" | null,         // set on subtasks
      "order": 1763600000000,
      "updatedAt": "…" | null
    }
  ]
}
```

A day with no record returns 200 with `tasks: []`, not 404. An empty day is a valid answer.

### `GET /api/reports/:date`

Returns the active Pi report for the date: the note resource plus `alternatives`.

- **Which notes count:** notes that aren't trashed, with `day === date`, whose id is one of:
  - `pi-report-<user>-<date>`
  - `pi-report-<date>`, the old form
  - `pi-report-<user>-<date>-replacement-<uuid>`
- **Which one wins:** the newest `updatedAt`. Other matches go in `alternatives: [id, …]`.
- **Narrowing by user:** an optional `?user=<name>` keeps only that user's ids.
- **No match:** 404 `{ "error": "Report not found" }`. If only trashed reports match, the body also has `"trashed": true`, so Pi can say why.

## Implementation

1. **Hide the internals in `server/app.ts`:**
   - `notFound` returns `c.json({ error: "Not found" }, 404)` for `/api/*`.
   - `onError` stops sending `stack`. It keeps logging it with `console.error`.
2. **Add `source` in `server/utils/notesStore.ts`:**
   - Add `source?: string` to `StoredNote` and `NoteMetadata`, and copy it in `metaOf`.
   - In `server/routeHandlers/notes.ts`, `saveNote` takes `source` only when the note is created (no stored note yet). It's validated as `/^[a-z0-9-]{1,32}$/` and ignored otherwise. On updates it's never changed.
   - The web client's `createNote` (`app/src/stores/notes.ts`) sends `source: "web"`, and `api/guest.ts` mirrors the field.
   - Add `source` to `app/src/types/models.ts`.
3. **Build the resources in `server/utils/readModel.ts`** (new, pure functions):
   - `toNoteResource(note, origin)` and `toNoteListItem(meta, origin)`
   - `noteType(meta)`, `toTaskResource(task)`
   - `pickReport(metas, date, user?)`, which returns `{ active, alternatives, trashedOnly }`
4. **Add the handlers in `server/routeHandlers/readApi.ts`** (new): `getNoteResource`, `listNoteResources`, `listTasks`, `getReport`. Reuse `listMeta`, `noteKey`, `normalizeDayLog` and the search matcher, and run `ensureNotesMigrated()` first, the way the note handlers do. These are reads, so they emit no sync events.
5. **Register the routes in `server/app.ts`:** `GET /api/notes` and `GET /api/notes/:id` go after the existing `/api/notes/index`, `/api/notes/days` and `/api/notes/notes/*` routes, so those keep matching first. Note ids are UUIDs, `day-…` or `pi-report-…`, so they never collide with `index`, `days` or `notes`. Also add `GET /api/tasks` and `GET /api/reports/:date`. They all use the general rate-limit bucket and normal auth, so no new carve-outs are needed.
6. **Remove the stranded notepad posts:**
   - **Retire the endpoints:** `POST /api/day/notes` and `DELETE /api/day/notes` return `410 { "error": "Day notes moved to /api/notes/notes" }`. Delete `saveDayNote` and `deleteDayNote`.
   - **Drop the field:** `DayLog` becomes tasks only (`server/utils/dayLog.ts`), and `normalizeDayLog` drops `notes`/`notesMarkdown`. Every later write to a day then stores it without them.
   - **Sweep once:** a one-off sweep strips the `notes` array and `notesMarkdown` from every `["logs", date]` record still holding them. It runs once behind a flag key `["logs", "schema"] = 2`, with the same promise-guard pattern as `ensureNotesMigrated`, on the first `/api/day*` or `/api/range` request.
   - **Make sure nothing else still needs the field:** the schema-2 note migration reads blob notes through `normalizeDayLog`, so it gets its own small reader for the raw `notes` array before the sweep runs. A brand-new database still migrates correctly that way.
   - **Back up first:** before deploying, take a full backup with `GET /api/admin/export` (kept outside the repo), and confirm the list with `scripts/list-stranded-notepad.sh`. The orphaned `day-notes` version rows for the deleted notes are left in place. They're unreachable and small; removing them is out of scope.
7. **Write `docs/api.md`** (new): the endpoint reference above, for the Pi side. Add a row to the CLAUDE.md "Where things live" table pointing at `readApi.ts`/`readModel.ts`, and update the day-log notes in CLAUDE.md (no more legacy `notes` array).

## Pi tool follow-up (`pi-agent-config`, separate change)

- **Read actions** `read` (by id), `list`, `tasks` and `report-read`, with no confirmation step. They log in the same way and call the endpoints above. A 404 maps to "not found", and 401 to "login failed".
- **`notepad` route:** move it to `POST /api/notes/notes` with no `day`. It then does the same thing as `note`; either keep both or make one an alias.
- **Send `source`:** `note`, `journal`, `notepad` and report posts send `source: "pi"`.
- **`check`:** can switch to `GET /api/reports/:date` instead of rebuilding the lookup from the index.

## Edge cases

- **Hidden notes:** content is returned like any other note, since the caller is authenticated. The list leaves out `preview`, matching search.
- **Day notes with fixed ids** (`day-<date>`, `day-<date>-<legacyId>`): they're regular journal notes and need nothing special.
- **Size:** notes are capped at 63 KiB, so a full `content` response is always small. The list never includes `content`.
- **`limit` with `q`:** scanning stops once `limit` matches are found, and `truncated: true` tells the caller there may be more.
- **Old clients still posting day notes:** they get a 410 and show their existing "Couldn't save" error instead of losing the note silently.

## Files touched

- `server/app.ts`
- `server/routeHandlers/readApi.ts` (new) + test
- `server/utils/readModel.ts` (new) + test
- `server/routeHandlers/notes.ts`, `server/utils/notesStore.ts` (`source`; schema-2 reader)
- `server/routeHandlers/app.ts`, `server/utils/dayLog.ts` + `app.test.ts` (retire day notes, sweep)
- `app/src/stores/notes.ts`, `app/src/api/guest.ts`, `app/src/types/models.ts` (`source: "web"`)
- `docs/api.md` (new), `CLAUDE.md`

## Verification

- **`readModel` unit tests:**
  - Type detection.
  - The note resource shape, with ISO dates and an encoded `url`.
  - `pickReport` covering per-user, old-form and replacement ids, trashed-only, multiple matches and the `user` filter.
- **Handler tests:**
  - 401 without a token, and JSON 404 for both a missing note and an unknown `/api` route.
  - 400 for a bad date, type or limit.
  - List filters, the `notepad`/`note` alias, trash excluded, the limit and `truncated`.
  - A trashed note by id returns `trashedAt`.
  - Tasks for an empty day return `[]`.
- **`source` tests:** set on create, kept on update, invalid values ignored.
- **Day-notes removal:**
  - The day-notes endpoints return 410.
  - The sweep strips `notes`/`notesMarkdown`, leaves tasks unchanged, runs only once, and the schema-2 migration still copies blob notes on a fresh database.
- **Checks and local run:** `npm test` and `npm run check`, then curl each endpoint against `npm run dev`.
- **After deploy:** confirm with a fresh `GET /api/admin/export` that no `["logs", date]` value still has `notes` or `notesMarkdown`. `scripts/list-stranded-notepad.sh` can't confirm this anymore, because `/api/range` stops returning `notes` once `normalizeDayLog` drops them.
