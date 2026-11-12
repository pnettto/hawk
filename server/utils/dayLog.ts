// Day log model. Stored as a JSON string at ["logs", dateStr].
//
// Current shape:
//   { tasks: Task[], notes: DayNote[] }
//
// Legacy shape (still readable — normalized on every read):
//   { notesMarkdown?: string, "9": HourEntry, "10-30": HourEntry, ... }
// Hour slots become timed tasks; notesMarkdown becomes the note with id
// LEGACY_NOTE_ID. The first write through the new endpoints persists the
// normalized form and drops the legacy keys.

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

export interface DayNote {
  id: string;
  title: string;
  markdown: string;
  order: number;
  // Bumped on every write — clients send it back as baseRev so the server can
  // detect a concurrent edit from another device instead of clobbering it.
  rev: number;
  updatedAt: number;
}

export interface DayLog {
  tasks: Task[];
  notes: DayNote[];
}

export interface LegacyHourEntry {
  checked: boolean;
  text: string;
  comment: string;
}

// The note migrated from the single legacy notesMarkdown field. Its version
// history keeps living under the bare dateStr id (see dayNoteHistoryId).
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

function parseRaw(raw: unknown): Record<string, unknown> {
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
  const obj = parseRaw(raw);
  let tasks: Task[] = Array.isArray(obj.tasks) ? (obj.tasks as Task[]) : [];
  let notes: DayNote[] = Array.isArray(obj.notes) ? (obj.notes as DayNote[]) : [];

  if (!Array.isArray(obj.tasks)) {
    const hours: Record<string, LegacyHourEntry> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (HOUR_KEY.test(k) && v && typeof v === "object") {
        hours[k] = v as LegacyHourEntry;
      }
    }
    tasks = legacyHourEntriesToTasks(hours);
  }

  if (!Array.isArray(obj.notes)) {
    const md = typeof obj.notesMarkdown === "string" ? obj.notesMarkdown : "";
    notes = md.trim()
      ? [{
        id: LEGACY_NOTE_ID,
        title: "",
        markdown: md,
        order: 0,
        rev: 1,
        updatedAt: 0,
      }]
      : [];
  }

  return { tasks, notes };
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
