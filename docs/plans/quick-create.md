# Quick create from ⌘K

## Context

`search.md` plans a ⌘K / Ctrl+K palette for searching notes and tasks. This plan extends it: when nothing you're looking for exists yet, the text you just typed can become a task or a note without leaving the palette. It works like Linear or Raycast: type "Call dentist 14:30", press a key, and it's added to today.

Pieces that already exist:

- `app/src/lib/daily/quickTask.ts`: `parseQuickTask("14:30 Gym")` → `{ text: "Gym", time: "14:30" }`. The add-task box uses it.
- `logsStore.addTask(dateStr, { text, time })` creates a task and saves it right away.
- `notesStore.createNote({ tag?, day?, select? })` creates a note, saves it right away and selects it.
- Navigation to a day, a note or a highlighted task comes from `deep-links.md` (`/journal/<date>?task=<id>`, `/notes/<nid>`).

Depends on the search palette. If quick create ships first, it brings the palette shell itself (dialog, input, listbox, shortcut) and search results slot into the same list later.

## Behaviour

Once the trimmed input isn't empty, the palette shows two **create rows** under the search results:

| Row | Example |
| --- | --- |
| Add task | `Add task “Call dentist” · Today, 14:30` |
| New note | `New note “Call dentist”` |

The labels reuse existing copy: the task box's "Add task" and the Notepad button's "New note".

- **Where they appear:** the create rows always come after the search results, so results never jump around while they load.
- **Which row is active:**
  - No results: "Add task" is active, so Enter creates a task. That's the more frequent action.
  - Some results: the first result is active, as in `search.md`. The create rows are reachable with ↓ or the shortcuts below.
- **Shortcuts that work whatever row is active:**
  - **⌘/Ctrl+Enter**: add task
  - **⌘/Ctrl+Shift+Enter**: new note

  The create rows show these as `<kbd>` hints. This takes over the ⌘Enter variant `search.md` described for tasks. Plain Enter on a task result already opens its day and highlights it, so that variant wasn't needed. Update `search.md` to match.
- **Hidden in Tasks or Notes view:** the palette's segmented control (All · Notes · Tasks) hides the create row that doesn't fit. In Tasks view only "Add task" shows, and in Notes view only "New note".
- **Shown live:** the task row shows how the text will be read, as you type: cleaned text, date and time. That makes the parsing predictable before you commit.

### Add task

- **Text and time:** parsed with `parseQuickTask`, the same rules as the add-task box ("14:30 Gym", "Gym at 7pm", "9h standup").
- **Date:**
  1. Date words in the input (see below) win.
  2. Otherwise, if the Journal is the current page, use the date it's showing. People expect tasks to go to the day in front of them.
  3. Otherwise, today.

  The row always says which date it picked, as "Today", "Tomorrow" or "Thu, May 15", so nothing lands silently on the wrong day.
- **Date words:** a new `parseQuickDate`, kept separate from `parseQuickTask` so the in-day add box isn't affected. It strips a single leading or trailing date word or phrase:
  - `today`, `tomorrow` / `tmr`
  - weekday names, full or 3-letter, meaning the next one after today
  - `next week` (= +7 days)
  - `on May 20` / `20 May` / `2026-05-20`

  Strip date words first, then times, so "Gym tomorrow at 7pm" works.

  Edge case: a text that's *only* a date word ("Tomorrow") stays as text, the same way `parseQuickTask` keeps "3 apples" as text.
- **Changing the date:** the date on the row is a button (`--r-sm`) that opens the calendar popover from `bulk-move-tasks.md` (`CalendarGrid` with Today / Tomorrow / Next Monday shortcuts). This is the mouse and touch path; typing a date word is the keyboard path.
- **What happens:**
  1. `await logsStore.loadForDate(date)` if that day isn't loaded. `addTask` works out `order` from the day's loaded tasks, so on an unloaded day the new task would otherwise land at the top instead of the bottom.
  2. `logsStore.addTask(date, { text, time })`.
  3. Close the palette.
  4. Show a toast, "Task added to Thu, May 15", with an **Open** action that goes to `/journal/<date>?task=<id>`. The task is visible and can be deleted, so there's no Undo.
- **Stay open:** ⌘/Ctrl+Enter while holding **Alt** adds the task and keeps the palette open with the input cleared, for typing several in a row. The toast still confirms each one. Leave this out if it complicates the shortcut table; it's a nice-to-have.

### New note

- **Title and tags:** the typed text becomes the note's **title**, and `#tags` in it move to the body's tag line, the way `createNote({ tag })` does today. For example, "Trip ideas #travel" gives the title "Trip ideas" and a body ending `#travel`. Extend `createNote` to take `title` and `tags: string[]`, and save the title through the doc session (`setTitle`) so it's synced and merged like a typed title.
- **What happens:**
  1. Create and select the note.
  2. Navigate to `/notes/<nid>`.
  3. Close the palette.
  4. Focus the editor **body**, not the title, because the title is already written.

  The open note is the confirmation, so there's no toast.
- **Day notes:** if the Journal's Day Notes tab is open, also offer a third row: `New day note “…” · Thu, May 15`. It calls `createNote({ day, dayOrder })` the way `NotesColumn` does for the Day view. Proposed for v1, since it costs one row in a context where it's clearly what you'd want.

## Implementation

1. **`app/src/lib/daily/quickTask.ts`**: add `parseQuickDate(input, today: Date) → { text, date?: string }` and `parseQuickEntry(input, today)` that combines it with time parsing. Write a table of tests in `quickTask.test.ts`: weekday rollover (typing "mon" on a Monday means next Monday), month/day formats, the date-only edge case, and combinations with time.
2. **`app/src/stores/notes.ts`**: `createNote` gains `title?: string` and `tags?: string[]`. Build the tag line from all tags. Test that a created note has the right title, body and `tags` and saves once.
3. **`app/src/stores/palette.ts`** (or `stores/search.ts`, if search has landed): add `createItems` derived from `query`, `kind`, the current page and date. Each item has `{ kind: 'task' | 'note' | 'day-note', label, detail, run() }`, so the dialog just renders a list.
4. **`app/src/lib/search/SearchDialog.svelte`**: render create rows as `role="option"` after the results, in the same `aria-activedescendant` navigation, with the active-row rule above and the two shortcuts. The task row's date is a button that opens the calendar. Opening the calendar keeps the palette open, and Esc closes the calendar first.
5. **Guest mode:** nothing extra needed. It goes through the same stores, and `api/guest.ts` already handles tasks and notes.
6. **Recent queries** (from `search.md`): don't save a query that was used to create something, so recents stay a list of searches.

## UI copy

- Rows:
  - `Add task “…”`
  - `New note “…”`
  - `New day note “…”`

  Long text is cut with an ellipsis, and the date/time detail goes in a muted span after it.
- Toast: "Task added to Today" / "Task added to Thu, May 15", with the action "Open".
- Errors come from the existing store paths ("Couldn't save…"). Nothing new is needed.

## Edge cases

- **Text that's only a time ("14:30"):** `parseQuickTask` leaves it as text. That's fine, and the row shows exactly that.
- **Very long input:** the task text is stored as typed. A note title stays a single line, with newlines impossible in an `<input>`.
- **A note or task with that exact text already exists:** offer the create rows anyway. The matching result is listed above them, so the duplicate is visible.
- **Palette opened while editing a note or task:** creating something flushes nothing extra. `selectNote` already flushes the previous note, and adding a task doesn't touch other rows.
- **The day changes at midnight while the palette is open:** "Today" is worked out when the item runs, not when the row was first shown.

## Files touched

- `app/src/lib/daily/quickTask.ts` + test
- `app/src/stores/notes.ts` + test
- `app/src/stores/palette.ts` (or `search.ts`)
- `app/src/lib/search/SearchDialog.svelte` + test
- `docs/plans/search.md` (shortcut note)

## Verification

- Unit tests for date parsing and `createNote` title/tags.
- Component tests:
  - With no results, Enter adds a task.
  - With results, Enter opens the first result.
  - ⌘Enter and ⌘⇧Enter create a task and a note from any active row.
  - Switching to Notes view hides "Add task".
- Manual:
  - "Dentist tomorrow 14:30" from the Notepad lands on tomorrow at 14:30, and the toast's Open highlights it.
  - "Trip ideas #travel" opens a note titled "Trip ideas" tagged `#travel`, with the cursor in the body.
  - On the Journal showing next Friday, a task without a date lands on that Friday.
  - Second tab: both changes appear live.
  - Mobile: the palette goes full screen and the create rows can be tapped.

## Open questions

- Should Enter create the task when there are results but none match closely, for example only body matches? Proposed: no. A fixed rule (results first) is easier to learn than a guess.
- Should date words also work in the in-day add box ("Gym tomorrow" moving it to tomorrow)? Proposed: no, that box belongs to the day on screen.
