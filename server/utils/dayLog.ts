// Day log model. Stored as a JSON string at ["logs", dateStr].
//
// Current shape:
//   { tasks: Task[] }
//
// Legacy shape (still readable — normalized on every read):
//   { "9": HourEntry, "10-30": HourEntry, ... }
// Hour slots become timed tasks. The first write through the new endpoints
// persists the normalized form and drops the legacy keys.
//
// Day blobs used to carry notes too (`notes: DayNote[]`, before that a single
// `notesMarkdown`). Those became regular notes in the notes schema-2
// migration (notesStore.ts), which reads them with its own reader; the logs
// sweep (ensureLogsSwept) then strips them from every stored day.

export interface Task {
  id: string;
  text: string;
  done: boolean;
  // "HH:MM" (24h) or absent for untimed tasks.
  time?: string;
  comment?: string;
  // Set on a subtask: the id of the task it belongs to.
  parentId?: string;
  // Manual sort key among untimed tasks (defaults to creation time).
  order: number;
  updatedAt?: number;
}

export interface DayLog {
  tasks: Task[];
}

export interface LegacyHourEntry {
  checked: boolean;
  text: string;
  comment: string;
}

// The id the single legacy notesMarkdown field had as a day note. Its version
// history lives under the bare dateStr id (see dayNoteHistoryId).
export const LEGACY_NOTE_ID = "main";

const HOUR_KEY = /^\d{1,2}(?:-\d{1,2})?$/;

export function hourKeyToTime(key: string): string {
  const [h, m = 0] = key.split("-").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Legacy comments were contenteditable HTML; tasks now carry plain text.
export function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function legacyHourEntriesToTasks(
  entries: Record<string, LegacyHourEntry>,
): Task[] {
  const out: Task[] = [];
  for (const [key, e] of Object.entries(entries)) {
    if (!e || typeof e !== "object") continue;
    const comment = htmlToText(e.comment ?? "");
    if (!e.text && !comment && !e.checked) continue;
    const time = hourKeyToTime(key);
    out.push({
      id: `legacy-${key}`,
      text: e.text ?? "",
      done: !!e.checked,
      time,
      comment: comment || undefined,
      order: timeToMinutes(time),
    });
  }
  return out;
}

export function parseDayRaw(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw as Record<string, unknown> : {};
}

export function normalizeDayLog(raw: unknown): DayLog {
  const obj = parseDayRaw(raw);
  let tasks: Task[] = Array.isArray(obj.tasks) ? (obj.tasks as Task[]) : [];

  if (!Array.isArray(obj.tasks)) {
    const hours: Record<string, LegacyHourEntry> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (HOUR_KEY.test(k) && v && typeof v === "object") {
        hours[k] = v as LegacyHourEntry;
      }
    }
    tasks = legacyHourEntriesToTasks(hours);
  }

  return { tasks };
}

// Version-history ids. Day tasks are one entity per day; day notes are one
// entity per note, except the migrated legacy note which keeps the bare date
// so its pre-migration history stays reachable.
export function dayNoteHistoryId(dateStr: string, noteId: string): string {
  return noteId === LEGACY_NOTE_ID ? dateStr : `${dateStr}~${noteId}`;
}

export function tasksPreview(tasks: Task[]): string {
  const parts: string[] = [];
  for (const t of tasks) {
    if (parts.join(" • ").length > 80) break;
    if (t.text) parts.push(`${t.done ? "✓ " : ""}${t.time ? t.time + " " : ""}${t.text}`);
  }
  return parts.join(" • ").slice(0, 80);
}

export function isSubstantialTaskListChange(prev: Task[], next: Task[]): boolean {
  const a = new Map(prev.map((t) => [t.id, t]));
  const b = new Map(next.map((t) => [t.id, t]));
  if (a.size !== b.size) return true;
  let differing = 0;
  for (const [id, t] of b) {
    const p = a.get(id);
    if (!p) return true;
    if (p.text !== t.text || p.done !== t.done || p.time !== t.time || p.comment !== t.comment) {
      differing++;
    }
    if (differing > 3) return true;
  }
  return false;
}

// Same order the client lists tasks in: timed first by time, then untimed by
// manual order.
export function compareTasks(a: Task, b: Task): number {
  if (a.time && b.time) return a.time.localeCompare(b.time) || a.order - b.order;
  if (a.time) return -1;
  if (b.time) return 1;
  return a.order - b.order;
}

export interface MoveResult {
  from: Task[];
  to: Task[];
  // Final ids of the moved tasks on the target day (after any remapping).
  moved: string[];
}

// Move tasks (with their subtasks) from one day's list to another's. Ids are
// kept unless the target already has one, which gets a fresh id. Moved
// top-level tasks go after the target's untimed tasks in their current
// relative order, unless `orders` pins an explicit order (used by undo to put
// tasks back exactly where they were). Unknown ids are ignored. Mirrored in
// app/src/lib/daily/moveTasks.ts.
export function moveTasksBetween(
  from: Task[],
  to: Task[],
  ids: string[],
  opts: { orders?: Record<string, number>; now?: number; newId?: () => string } = {},
): MoveResult {
  const now = opts.now ?? Date.now();
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const picked = new Set(ids.filter((id) => from.some((t) => t.id === id)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of from) {
      if (t.parentId && picked.has(t.parentId) && !picked.has(t.id)) {
        picked.add(t.id);
        grew = true;
      }
    }
  }
  if (!picked.size) return { from, to, moved: [] };

  const moving = from.filter((t) => picked.has(t.id));
  // A task whose parent stays behind becomes top-level on the target.
  const isRoot = (t: Task) => !t.parentId || !picked.has(t.parentId);
  const roots = moving.filter(isRoot).sort(compareTasks);
  let next = Math.max(0, ...to.filter((t) => !t.parentId && !t.time).map((t) => t.order));
  const rootOrder = new Map<string, number>();
  for (const r of roots) {
    const pinned = opts.orders?.[r.id];
    rootOrder.set(r.id, typeof pinned === "number" ? pinned : ++next);
  }

  const taken = new Set(to.map((t) => t.id));
  const idMap = new Map<string, string>();
  for (const t of moving) {
    let id = t.id;
    while (taken.has(id)) id = newId();
    taken.add(id);
    idMap.set(t.id, id);
  }

  const moved: Task[] = moving.map((t) => {
    const root = isRoot(t);
    const out: Task = {
      ...t,
      id: idMap.get(t.id)!,
      order: root ? rootOrder.get(t.id)! : t.order,
      updatedAt: now,
    };
    if (root) delete out.parentId;
    else out.parentId = idMap.get(t.parentId!)!;
    return out;
  });

  return {
    from: from.filter((t) => !picked.has(t.id)),
    to: [...to, ...moved],
    moved: moved.map((t) => t.id),
  };
}
