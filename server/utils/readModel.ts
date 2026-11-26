// Read API resource shapes (docs/api.md). Pure: handlers in
// routeHandlers/readApi.ts load the data and pass it in. The read API speaks
// ISO 8601 timestamps; the internal API keeps milliseconds.
import type { NoteMetadata, StoredNote } from "./notesStore.ts";
import type { Task } from "./dayLog.ts";

export type NoteType = "notepad" | "journal";

export interface NoteListItem {
  id: string;
  title: string;
  type: NoteType;
  date: string | null;
  source: string | null;
  // Same value as `source`: who created the note ("pi", "web", …).
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string;
  tags: string[];
  hidden: boolean;
  trashedAt: string | null;
  // List only; left out for hidden notes.
  preview?: string;
}

export interface NoteResource extends Omit<NoteListItem, "preview"> {
  content: string;
}

export interface TaskResource {
  id: string;
  text: string;
  status: "open" | "done" | "cancelled";
  time: string | null;
  comment: string | null;
  parentId: string | null;
  order: number;
  updatedAt: string | null;
}

export function iso(ms: number | undefined | null): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Journal notes belong to a day; everything else was written in the Notepad.
export function noteType(meta: Pick<NoteMetadata, "day">): NoteType {
  return meta.day ? "journal" : "notepad";
}

export const noteUrl = (origin: string, id: string) => `${origin}/notes/${encodeURIComponent(id)}`;
export const journalUrl = (origin: string, date: string) => `${origin}/journal/${date}`;

function baseOf(n: NoteMetadata | StoredNote, origin: string): Omit<NoteListItem, "preview"> {
  return {
    id: n.id,
    title: n.title ?? "",
    type: noteType(n),
    date: n.day ?? null,
    source: n.source ?? null,
    author: n.source ?? null,
    createdAt: iso(n.createdAt),
    updatedAt: iso(n.updatedAt),
    url: noteUrl(origin, n.id),
    tags: n.tags ?? [],
    hidden: !!n.hidden,
    trashedAt: iso(n.deletedAt),
  };
}

export function toNoteResource(note: StoredNote, origin: string): NoteResource {
  return { ...baseOf(note, origin), content: note.content ?? "" };
}

export function toNoteListItem(meta: NoteMetadata, origin: string): NoteListItem {
  const item: NoteListItem = baseOf(meta, origin);
  if (!meta.hidden) item.preview = meta.preview ?? "";
  return item;
}

export function toTaskResource(task: Task): TaskResource {
  return {
    id: task.id,
    text: task.text ?? "",
    status: task.cancelled ? "cancelled" : task.done ? "done" : "open",
    time: task.time ?? null,
    comment: task.comment ?? null,
    parentId: task.parentId ?? null,
    order: task.order,
    updatedAt: iso(task.updatedAt),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The user a Pi report id belongs to: `pi-report-<user>-<date>`, with an
// optional `-replacement-<uuid>` suffix. The old `pi-report-<date>` form has
// no user (""). Null when the id isn't a report for `date`.
export function reportUser(id: string, date: string): string | null {
  const m = new RegExp(
    `^pi-report-(?:(.+)-)?${escapeRe(date)}(?:-replacement-[A-Za-z0-9-]+)?$`,
  ).exec(id);
  if (!m) return null;
  // The old form never had a replacement suffix.
  if (m[1] === undefined && id !== `pi-report-${date}`) return null;
  return m[1] ?? "";
}

export interface ReportPick<T> {
  active: T | null;
  alternatives: string[];
  // Nothing active, but a trashed report matched.
  trashedOnly: boolean;
}

// The active Pi report for a day: the newest untrashed match. The other
// matches are listed as alternatives. `user` keeps only that user's ids.
export function pickReport<T extends NoteMetadata>(metas: T[], date: string, user?: string): ReportPick<T> {
  const matches = metas.filter((m) => {
    if (m.day !== date) return false;
    const owner = reportUser(m.id, date);
    if (owner === null) return false;
    return user === undefined || owner === user;
  });
  const live = matches.filter((m) => !m.deletedAt).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return {
    active: live[0] ?? null,
    alternatives: live.slice(1).map((m) => m.id),
    trashedOnly: !live.length && matches.length > 0,
  };
}
