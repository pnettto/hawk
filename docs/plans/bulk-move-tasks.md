# Move tasks to a chosen date, in bulk

## Context

Tasks can be moved between days in two ways today. Both copy and delete through the client (`app/src/stores/logs.ts`):

- **"Carry over to tomorrow"** in a task row's menu (`carryTaskOver`) calls `copyTaskTree` to add new tasks with **new ids** on the next day, then quietly removes the originals. Tomorrow is the only possible target, and it handles one task at a time.
- **"Bring over N unfinished tasks from <yesterday>"** (`carryOver`) shows only on an empty day. It copies and leaves the originals where they were.

Problems with this approach:

- The move isn't atomic. It's two separate `POST /api/day/tasks` writes, so if the second one fails, the task ends up duplicated or lost.
- The move can't be undone, because the originals are gone and the copies have new ids.
- Parent `done` and subtask times are dropped (`copyTaskTree` copies a subset of fields).
- `addTask` on a day that isn't loaded works out `order` from an empty list, so moved tasks can land between existing tasks instead of after them.
- A running focus timer pointing at the moved task gets stopped.

Goal: select several tasks and move them to any date in one step that's atomic and can be undone. Generalise single-task carry-over to use the same path.

## Decisions

- **The server does the move.** A new endpoint reads and writes both day blobs under one `kv.atomic()` with `check`s on both keys. Either both days change or neither does.
- **Ids are preserved.** A moved task keeps its id, so undo is just the reverse move and the focus timer can follow the task. Ids are UUIDs and unique per day. If the target day already has an id, which shouldn't happen, the server gives it a new id and remaps `parentId` for its subtasks.
- **Whole groups move.** Selection works on top-level rows. A selected group header takes its subtasks with it, the same way `removeTask` uses `withDescendants`. Subtasks can't be selected on their own in v1, so they're never left without a parent.
- **Every field is kept** (`text`, `done`, `time`, `comment`, `parentId`, `order` relative to the group). Moved untimed tasks go after the target's existing untimed tasks in their current relative order. Timed tasks keep their time and sort by it.
- **Selection is a mode.** A "Select" toggle sits next to the reorder toggle in the `DayTasks` toolbar. Selection affordances only appear while the mode is on, following CLAUDE.md's mode-toggle guidance. Select and reorder modes can't both be on.

## API

`POST /api/day/tasks/move` with body `{ from: "YYYY-MM-DD", to: "YYYY-MM-DD", ids: string[] }`

- Validate both dates. Reject `from === to` and an empty `ids` (400).
- In `server/routeHandlers/app.ts`, generalise `updateDay` into `updateDays(dates, mutate)`: read both keys, `structuredClone`, mutate, check the size cap on each, then `kv.atomic().check(a).check(b).set(a).set(b).commit()` with the existing retry loop.
- Mutation:
  1. Expand `ids` to include descendants.
  2. Remove them from the source.
  3. Re-number `order` so they go after `max(target untimed order)`.
  4. Resolve id clashes.
  5. Set `updatedAt` on each moved task.
  6. Append.
  Unknown ids are ignored. If nothing matched, return 200 with both days unchanged so a double-submit is harmless.
- Snapshot both days with `maybeSnapshot({ kind: "day-tasks", …, substantialChange: true })`, so each day's version history can roll it back.
- Emit `log.saved` for both dates, with `originClientId`.
- Response: `{ from: { tasks }, to: { tasks }, moved: string[] }`, where `moved` is the final ids after any remapping. Return 413 `"Day is too large"` if the target would go over `MAX_DAY_BYTES`.
- Guest mode: add the same operation to `app/src/api/guest.ts`.
- Client: `logsApi.moveTasks(from, to, ids)` in `app/src/api/logs.ts`.

## Store

`logsStore.moveTasks(from, to, ids, opts?: { quiet?: boolean })` in `stores/logs.ts`:

1. `await flushTasks(from)` so pending edits to those tasks are saved first and the move doesn't overwrite them. Flush `to` too if it has pending writes.
2. Optimistic update: remove the tasks and their descendants from `from`. If `to` is loaded, append them with the same ordering rule as the server.
3. Call the API inside `savingStore.track`. On success, replace both days with the response, the same way `restoreVersion` does, and bump `writeEpoch` so an in-flight stale load is ignored.
4. On failure, roll back both days and show "Couldn't move tasks."
5. Pomodoro: if `pomodoroStore` is focused on a moved task, retarget it to the new date with a new `pomodoroStore.retarget(dateStr, id)` instead of stopping it.
6. Unless `quiet`, toast "Moved 3 tasks to Fri, May 16", or "Moved “Buy milk” to …" for a single task, with an **Undo** action that calls `moveTasks(to, from, moved, { quiet: true })`.

Rebuild `carryTaskOver` on top of `moveTasks(date, date+1, [id])`. Leave `carryOver` ("Bring over…", which copies and keeps the originals) unchanged. It does something different, and the user chooses it on an empty day.

## UI

In `app/src/lib/daily/DayTasks.svelte`:

- **Toolbar:** a "Select tasks" icon toggle next to the reorder toggle, with `aria-pressed` and title/label "Select tasks" / "Done selecting". Turning it on clears reorder mode and the other way round. Esc exits, unless a popover is open.
- **Rows in select mode:**
  - The done checkbox is replaced by a selection indicator, so tapping a row selects it instead of completing it. The indicator is round, per the shape rules.
  - Clicking anywhere on a top-level row toggles it, and text fields are read-only in this mode. Selected rows get a background lift, not an accent border, per the "keep transient states quiet" rule.
  - Subtasks of a selected group show as included, dimmed, and can't be toggled.
  - Shift+click selects a range. ⌘/Ctrl+A selects all top-level rows. Space toggles the focused row and ↑/↓ moves focus.
  - Every row has an `aria-label` and `aria-pressed`/`aria-checked` to match.
- **Selection bar:** replaces the toolbar's left side while selection isn't empty. It reads "3 selected" and has these buttons:
  - **Move to…**
  - **Delete**: deletes them with one undo toast, using a new `removeTasks(date, ids)` that batches deletes into one write.
  - **Select unfinished**: quick select. Moving all unfinished tasks forward is the most common case.
  - **Clear**
  On mobile the bar sticks to the bottom of the list.
- **"Move to…" popover** (`app/src/lib/daily/MoveToDatePopover.svelte`):
  - Shortcut buttons (`--r-sm`): Today, Tomorrow, Next Monday, Next week (+7 days). Hide any shortcut that equals the source date.
  - Below them, a month calendar grid. Pull the grid out of `DatePicker.svelte` into a reusable `lib/ui/CalendarGrid.svelte` with its arrow-key navigation, then use it in both places. The source date is shown but disabled.
  - Picking a date moves right away and closes the popover. There's no confirm step, because Undo is in the toast.
  - Selection mode ends after a successful move.
- **Single-task path:** replace "Carry over to tomorrow" in the row menu with **"Move to…"**, which opens the same popover anchored to the row. Tomorrow is the first shortcut, so it's no slower.
- **Motion:** rows leaving the list use the existing `safeFlip` list movement, so the remaining rows close the gap smoothly.

## Edge cases

- **The selected day changes while tasks are selected:** clear the selection, the same way menus already reset on `dateStr` change.
- **A sync event removes a selected task:** drop its id from the selection. If the selection ends up empty, the bar disappears.
- **Concurrent edit on the target day from another device:** handled by the atomic `check`/retry. The other device gets `log.saved` and refetches.
- **Moving to a day not loaded locally:** only the source updates optimistically. The response's `to` tasks are cached so navigating there is instant.
- **Done tasks:** they can be selected and moved. "Select unfinished" leaves them out.
- **Timed tasks:** they keep their time. Shifting times is out of scope.

## Files touched

Server:
- `server/routeHandlers/app.ts` (`updateDays`, `moveDayTasks`)
- `server/app.ts` (route)
- tests next to them

App:
- `api/logs.ts`
- `api/guest.ts`
- `stores/logs.ts` (`moveTasks`, `removeTasks`, `carryTaskOver` rewrite)
- `stores/pomodoro.ts` (`retarget`)
- `lib/daily/DayTasks.svelte`
- new `lib/daily/MoveToDatePopover.svelte`
- new `lib/ui/CalendarGrid.svelte`
- `lib/daily/DatePicker.svelte` (use the grid)
- tests (`DayTasks.test.ts`, `logs` store test, `ActionMenu` labels)

## Verification

- Server tests:
  - The move keeps ids and fields and takes descendants along.
  - Ordering on the target is correct.
  - Id-clash remapping works.
  - Unknown ids are a no-op.
  - The 413 cap applies.
  - Both days are snapshotted and both sync events fire.
  - A forced `check` failure on one key retries and never half-applies.
- Store tests: optimistic update and rollback on API failure. Undo restores the exact original state, including `order`. Pending edits are flushed before the move.
- Component tests: the select-mode toggle, shift-range, ⌘A, the "Select unfinished" helper, and that a row click selects instead of toggling done.
- Manual in two tabs: move 3 tasks, one of them a group, to next Monday. The other tab updates both days live, and Undo brings them back in place. Move the task with a running focus timer and the timer keeps running on the new date. Check the mobile layout of the bar and popover.

## Open questions

- Should "Move to…" offer a copy mode, "Copy to…" (keep the originals)? It can be added later to the same popover.
- Should subtasks be movable on their own, becoming top-level on the target day? v1 says no.
