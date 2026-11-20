# Deep links

## Context

Hawk's navigation lives entirely in Svelte stores. `appStore` (`app/src/stores/app.ts`) holds `currentPage`, `selectedDate`, `journalTab` and the overview range. `notesStore` holds `filter` and `selectedNid`. The URL never changes, which causes four problems:

- Nothing can be linked to or bookmarked: a note, a day, a tag view.
- Reloading always lands on Journal/today, with only the journal tab and notes filter remembered through `localStorage`.
- The browser Back button leaves the app. On mobile it should close an open note and go back to the list, because the layout is master-detail.
- Search (see `search.md`) needs a single way to say "open this note" or "open this day and highlight this task".

The only URL handling today is `?pomodoro=resume` in `stores/pomodoro.ts`, which the service worker sets when it opens a window.

Hosting is already set up for this. `wrangler.jsonc` uses `not_found_handling: "single-page-application"`, Vite dev falls back to `index.html`, and `app/index.html` loads assets with absolute paths, so nested paths like `/notes/abc` load correctly. Only `/api/*` and `/shared/*` reach the Worker. The **Chrome extension** is the exception: `chrome-extension://<id>/index.html` has no SPA fallback, so it has to use hash URLs.

## Decisions

- **Path URLs on the web and hash URLs in the extension.** Both go through one router module, so the rest of the app never needs to know which one is active.
- **No router dependency.** The app has a few flat routes and lazy-loads pages in `App.svelte` already. A small pure parse/format module plus a sync layer is enough and easy to test.
- **Stores stay the source of truth.** The URL reflects store state and is written back into the stores on boot and on `popstate`. Components keep calling `appStore.setCurrentPage`, `notesStore.selectNote`, and so on. No call site has to change.
- **Use push for "places" and replace for small steps.** Changing page, opening or closing a note, or changing a notes filter pushes a history entry. Stepping the date with ←/→ or the arrows, or switching journal tabs, replaces it. Otherwise clicking through 20 days would fill up the Back stack.
- **The URL wins over `localStorage`.** At `/` the remembered journal tab and notes filter still apply. A specific URL overrides them for that visit and doesn't change the remembered default.

## URL scheme

| URL | State |
| --- | --- |
| `/` | Journal, today, remembered tab |
| `/journal/2026-05-14` | Journal, that date, Tasks tab |
| `/journal/2026-05-14/notes` | Journal, that date, Day Notes tab |
| `/journal/2026-05-14?task=<id>` | As above, scroll to the task and briefly highlight it (used by search) |
| `/journal/overview?from=2026-05-01&to=2026-05-14&view=tasks` | Overview range and sub-tab |
| `/notes` | Notepad with the remembered filter |
| `/notes/all`, `/notes/day`, `/notes/untagged`, `/notes/trash` | That filter |
| `/notes/tag/<tag>` | Tag filter (tag is URL-encoded) |
| `/notes/<nid>` | Open the note. The filter stays as remembered, or falls back to one that contains the note |
| `/files`, `/extensions`, `/settings` | Those pages (`admin` maps to `/settings`) |

Hash form in the extension: `index.html#/notes/<nid>`, with the same paths after the `#`.

Reserved: `/api`, `/shared`, and the static asset paths (`/css`, `/data`, `/*.svg`, `/sw.js`, `/theme-init.js`, `/manifest.json`). None of them collide with the routes above. Note ids can't be `all`, `day`, `untagged`, `trash` or `tag`. Server ids are UUIDs and day-note ids look like `day-YYYY-MM-DD`, so they never do.

## Implementation

1. **`app/src/router/routes.ts`** (pure, no DOM):
   - `type Route = { page: 'journal'; date?: string; tab?: JournalTab; task?: string } | { page: 'overview'; from?; to?; view? } | { page: 'notes'; filter?: NotesFilter; nid?: string } | { page: 'files' | 'extensions' | 'settings' }`
   - `parseRoute(pathAndQuery: string): Route`. Unknown or malformed input (bad date, empty tag) falls back to `{ page: 'journal' }`. Dates are validated with the same `^\d{4}-\d{2}-\d{2}$` check the server uses.
   - `formatRoute(route: Route): string`, the canonical path. `/journal/<today>` becomes `/` so the default URL stays clean.
   - `routeFromState(app, notes): Route` and a matching `applyRoute(route)` that calls the existing store setters.
   - `routes.test.ts`: round trips, fallbacks, encoding (tags with unicode, `#`, spaces), and the reserved filter names.
2. **`app/src/router/location.ts`**: a thin adapter that picks `pathname+search` or `hash` from `location.protocol === 'chrome-extension:'`, and exposes `read()`, `push(url)`, `replace(url)` and `onChange(cb)` (`popstate`/`hashchange`).
3. **`app/src/router/sync.ts`**, started once from `App.svelte` after auth:
   - On start, parse the current location and run `applyRoute`. Wait until `notesStore.loaded` before selecting a note id.
   - Subscribe to the derived route string. When it differs from the location, `push` or `replace` according to the rule above. Comparing strings is enough to prevent loops; no "applying" flag is needed.
   - On `popstate`, parse and apply.
   - Keep `?pomodoro=resume` working. The pomodoro module strips its param with `replaceState` before the router reads the URL. Check the order, or let the router ignore unknown query params.
4. **Before auth:** don't touch the URL while the login overlay shows, so the deep link survives logging in. Guest mode works the same way.
5. **Missing targets:**
   - Note id not in the index: toast "Couldn't find that note", then replace with `/notes`.
   - Trashed note: switch to the Trash filter and open it there.
   - Hidden note: open it as usual. The editor's conceal screen handles the rest.
   - `?task=` id not found on that day: open the day without highlighting anything, and show no error.
6. **Task highlight:** `DayTasks.svelte` reads a one-shot `highlightTaskId` from `appStore`, scrolls the row into view once tasks load, and applies a short background highlight using `--dur-base`/`--ease-out`. The `prefers-reduced-motion` rule already disables the animation. Clear the id afterwards so it doesn't fire again.
7. **Mobile Back:** opening a note pushes `/notes/<nid>`, so Back pops to `/notes` → `clearSelectedNote()`. Remove or adapt any in-app back button logic so it calls `history.back()` when the previous entry is the list. Otherwise it should replace.
8. **Copy link:** add "Copy link" to the note menu (`NoteEditor`) and the day/task row menus. Build the URL from `apiOrigin()` (`api/client.ts`) so the extension copies the web URL and not `chrome-extension://…`. Label it differently from public sharing: "Copy link" opens the URL for you (login required), and "Copy public link" stays in `NoteSharePopover`. Toast: "Link copied". Error: "Couldn't copy to the clipboard."
9. **Service worker:** `openWindow('/')` keeps working. Optionally open `/journal/<today>` so a notification click lands on the timer's tab.
10. **Page titles:** set `document.title` per route ("Hawk · May 14", "Hawk · <note title>"), so history entries and tabs can be told apart.

## Edge cases

- **Unsaved work:** navigation is in-app, so there's no `beforeunload`. `selectNote` already flushes the previous note. Back and forward go through the same setters, so they're covered.
- **Concurrent edits:** routes don't carry data, so sync is unaffected.
- **Invalid date ranges:** `setOverviewRange` already swaps when start > end.
- **Hidden note titles:** nothing in the URL leaks content. The URL has the id and the title only goes in `document.title`. If titles count as sensitive, use "Hidden note" there.

## Files touched

New: `app/src/router/{routes,location,sync}.ts` + tests.
Edited: `App.svelte` (start sync), `stores/app.ts` (`highlightTaskId`), `lib/daily/DayTasks.svelte` (highlight, copy link), `lib/notes/NoteEditor.svelte` (copy link, mobile back), `stores/pomodoro.ts` (param ordering), optionally `public/sw.js`.

## Verification

- `npm test`: routes unit tests, plus a jsdom test where `applyRoute` and `routeFromState` round-trip through the real stores.
- Manual, `npm run dev`: reload on each URL in the table. Back/forward through page → note → note → tag. ←/→ ten days, then Back once leaves the Journal instead of stepping a day. Mobile viewport Back closes the note.
- Log out on `/notes/<nid>`, log back in, and the note opens.
- Preview deploy: hard-load `/notes/<nid>` on the Worker URL and confirm the SPA fallback serves it.
- Extension (load unpacked from `app/dist`): `#/journal/…` works and "Copy link" yields a web URL.

## Open questions

- Should a `/journal/<date>` link also remember that tab as the default? Proposed answer: no, links shouldn't change preferences.
- Should non-today days get `/` or explicit URLs? Proposed: `/` only for today on the Tasks tab with no params.
