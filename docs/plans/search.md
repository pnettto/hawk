# Search (notes and tasks)

## Context

There's no search in Hawk. Notes are organised by `#tags` and found by scrolling the Notepad list. Tasks live in per-day blobs (`["logs", "YYYY-MM-DD"]`) and can only be reached by stepping through dates.

The client can't search on its own:

- `notesStore.allNotes` has every note's **metadata**, but the body only for notes that have been opened. The index has a 140-char `preview` and nothing more.
- `logsStore.byDate` holds only the days that were loaded (selected day ± prefetch, overview ranges).

So search has to run on the server, inside the Durable Object, where all of the data is local SQLite.

This builds on `deep-links.md`. Opening a result calls the router's `applyRoute`, which can open a note or open a day and highlight a task. Search can ship first if it calls the store setters directly, but the highlight-on-open behaviour comes from the deep-links work.

## Decisions

- **v1 scans; no index.** `GET /api/search` lists `["notes", "note", *]` and `["logs", *]` from the KV and matches in memory. This is a single-user DO with a few thousand notes and days at most, so each scan is a few MB of local SQLite reads and should take tens of ms. Measure before optimising. If it gets slow, v2 adds a SQLite FTS5 table in the same DO database as a derived index. That would be the first non-`kv` table holding data, so it needs a separate decision; CLAUDE.md says "don't introduce any other store".
- **One global search, not a per-list filter.** A command palette (⌘K / Ctrl+K, `/` when not typing, plus a nav button) searches everything. The Notepad filter menu stays as it is.
- **Simple, predictable matching.** Case- and diacritic-insensitive. Every term has to match (AND). `"quoted phrases"` match exactly. `#tag` tokens filter by tag instead of matching text. Leave out boolean operators and fuzzy matching in v1.
- **Hidden notes match on title and tags only, and never return a body snippet.** Search would otherwise show their content without the password. (The `stores/hidden.ts` header says hidden notes are "searched like any other". That comment needs updating to describe this rule.)
- **Trash is excluded by default.** Add an "Include trash" toggle later if it turns out to be needed.

## API

`GET /api/search?q=<query>&kind=all|notes|tasks&limit=30`

Response:

```ts
{
  notes: Array<{
    id: string; title: string; day?: string; tags: string[];
    updatedAt: number; hidden?: boolean;
    snippet?: string;                 // omitted for hidden notes
    matches: Array<[start, end]>;     // ranges in title/snippet for <mark>
    field: 'title' | 'tag' | 'body';
  }>;
  tasks: Array<{
    date: string; id: string; text: string; done: boolean; time?: string;
    parentText?: string;              // for subtasks
    comment?: string;                 // snippet when the comment matched
    matches: Array<[start, end]>;
  }>;
  truncated: boolean;
}
```

- Route goes in `server/app.ts` next to the notes routes and behind the normal auth plus general rate-limit bucket. It's read-only, so it emits no sync events.
- Handler goes in `server/routeHandlers/search.ts`. Matching goes in `server/utils/search.ts` (pure, unit-tested):
  - `normalize(s)` = `s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`.
  - `parseQuery(q)` returns `{ terms, phrases, tags }`. Queries under 2 characters (after trimming, ignoring tags) return empty, unless there are tags.
  - Notes: match against title, tags and stripped body. Reuse the stripping from `buildPreview` in `server/utils/notesStore.ts`, minus the length cap, so markdown syntax and the tag line don't match. Skip `deletedAt` notes and the empty local day drafts.
  - Tasks: match `text` and `comment`. Skip `key.length !== 2` rows (version history shares the `logs` prefix, the same guard as `getRangeLog`). Normalise with `normalizeDayLog`.
  - Ranking: title match > tag match > body match. Within a tier, more recent first: `updatedAt` for notes, date for tasks. Return open tasks before done ones on the same day.
  - Snippet: about 140 chars around the first body hit, cut at word boundaries, with `…` where it was cut.
  - Stop scanning a kind once it has `limit × 3` candidates and set `truncated: true`. Return the top `limit` per kind.
- Guest mode: add `/api/search` to `app/src/api/guest.ts` and run the same matcher over its localStorage data. Tags already follow a mirror pattern (`server/utils/tags.ts` ↔ `app/src/lib/notes/tags.ts`), so mirror the matcher to `app/src/lib/search/match.ts` and give each copy the same test table.
- Client: `app/src/api/search.ts`, with `search(q, kind, signal)` going through `client.ts`.

## UI

`app/src/lib/search/SearchDialog.svelte`, mounted once in `App.svelte`, with state in `app/src/stores/search.ts` (`open`, `query`, `kind`, `results`, `loading`).

- **Open:** ⌘K/Ctrl+K anywhere. `/` when focus isn't in an input or editor, using the same guard as the Journal ←/→ handler. A search icon button in the nav next to `SavingIndicator`, with `aria-label="Search"`.
- **Look:** a transient overlay, so `--panel` and `--shadow-pop` are fine here. `--r-md` container, `--r-sm` input, and full-screen on narrow viewports.
  - Input at the top with placeholder "Search notes and tasks".
  - A segmented control: All · Notes · Tasks.
- **Results:** grouped under "Notes" and "Tasks", with matches wrapped in `<mark>`.
  - Note rows: title, or "Untitled". A day label for day notes ("Day note · May 14"), the snippet, and up to 3 tags.
  - Hidden note rows: title and a lock icon, no snippet.
  - Task rows: done indicator, text, date ("Wed, May 14"), time if set, and "in <parent>" for subtasks.
- **Behaviour:**
  - Debounce 150 ms. Abort the previous request with `AbortController`.
  - Show a quiet loading state only after 300 ms, so fast results don't flicker.
  - Keep the previous results visible while the next request is in flight.
- **Keyboard:** ↑/↓ moves the active row (`aria-activedescendant`, listbox pattern). Enter opens the result. ⌘/Ctrl+Enter on a task opens the day instead of only highlighting. Esc closes and restores focus to whatever had it.
- **Opening a result:**
  - Note → `/notes/<nid>` (selects the note; trashed notes aren't returned).
  - Day note → Journal's Day Notes tab for that date.
  - Task → `/journal/<date>?task=<id>`, which scrolls to it and highlights it.
- **Empty and error states:**
  - Nothing typed: show the last 5 queries, kept in `localStorage`, plus a one-line hint about `#tag` and quotes.
  - No results: "Nothing matches “…”".
  - Error: "Couldn't search right now."
- Remember the last query and kind for the session, so reopening the dialog shows the same results.

## Freshness

Search reads from the server, so unsaved local edits don't show up yet. Before each request, call `notesStore.flushSaves()` and `logsStore.flushOnHide()` (or a lighter `flushAll`), or just accept a short lag. Proposed: flush when the dialog opens, not on every keystroke.

## Performance guardrails

- Log scan time in the handler (`console.log` goes to Workers observability) for the first weeks.
- If p95 > 150 ms, try these in order:
  1. Cache the normalised corpus in DO memory, invalidated by the same writes that call `emitSyncEvent`.
  2. FTS5 table.

## Files touched

New:
- `server/routeHandlers/search.ts`
- `server/utils/search.ts` + test
- `app/src/api/search.ts`
- `app/src/lib/search/{SearchDialog.svelte,match.ts}` + tests
- `app/src/stores/search.ts`

Edited:
- `server/app.ts` (route)
- `app/src/api/guest.ts`
- `App.svelte` (mount, shortcut, nav button)
- `stores/hidden.ts` (comment)
- `DayTasks.svelte` (highlight, if deep links haven't landed yet)

## Verification

- Server unit tests:
  - Matching: diacritics, AND, phrases, `#tag`.
  - Ranking order.
  - Snippet boundaries.
  - Hidden notes never return a snippet.
  - Trash excluded.
  - Version-history rows skipped.
- App tests: the dialog's keyboard navigation and result opening (jsdom). Guest search against seeded data.
- Manual: search a word that exists only in an old, never-opened note body and only in a task from months ago. Open each result. Check mobile layout. Check `/` doesn't open search while typing in the editor.
- Timing: import a production export into `wrangler dev` (`POST /api/admin/import`), then time `/api/search` with a broad and a narrow query.

## Open questions

- Should hidden notes be searchable by title at all, or left out entirely? Proposed: by title, since the title already shows in the list.
- Should search also cover file names (`["files", "meta", *]`)? It's cheap to add as a third group later.
