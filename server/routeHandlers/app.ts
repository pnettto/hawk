import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { emitSyncEvent, getClientIdFromCtx } from "../utils/syncEvents.ts";
import {
  getVersion,
  isSubstantialTextChange,
  listVersions,
  makePreview,
  maybeSnapshot,
  type SnapshotKind,
} from "../utils/versioning.ts";
import {
  type DayLog,
  type DayNote,
  dayNoteHistoryId,
  isSubstantialTaskListChange,
  type LegacyHourEntry,
  legacyHourEntriesToTasks,
  normalizeDayLog,
  type Task,
  tasksPreview,
} from "../utils/dayLog.ts";

// Deno KV rejects values over 64 KiB. Fail loudly with a clear status instead
// of letting the commit throw an opaque 500.
const MAX_DAY_BYTES = 63 * 1024;

const dayKey = (dateStr: string) => ["logs", dateStr];

class DayTooLargeError extends Error {}
class ConflictError extends Error {
  constructor(public current: DayNote) {
    super("conflict");
  }
}

// Read-modify-write the day blob under an optimistic versionstamp check, so a
// tasks write and a notes write landing at the same moment both survive.
async function updateDay<R>(
  dateStr: string,
  mutate: (log: DayLog) => R,
): Promise<{ log: DayLog; prev: DayLog; result: R }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await kv.get<string>(dayKey(dateStr));
    const prev = normalizeDayLog(cur.value);
    const log = structuredClone(prev);
    const result = mutate(log);
    const body = JSON.stringify(log);
    if (body.length > MAX_DAY_BYTES) throw new DayTooLargeError();
    const res = await kv.atomic().check(cur).set(dayKey(dateStr), body).commit();
    if (res.ok) return { log, prev, result };
  }
  throw new Error("Day log write contention");
}

function requireDate(c: Context): string | null {
  const d = c.req.query("date");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

async function emitDaySaved(c: Context, dateStr: string) {
  await emitSyncEvent({
    type: "log.saved",
    ref: dateStr,
    originClientId: getClientIdFromCtx(c),
  });
}

export async function getDayLog(c: Context) {
  const dateStr = requireDate(c);
  if (!dateStr) return c.json({ error: "Missing date parameter" }, 400);
  const result = await kv.get<string>(dayKey(dateStr));
  return c.json(normalizeDayLog(result.value), 200);
}

export async function getRangeLog(c: Context) {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end) {
    return c.json({ error: "Missing start or end date" }, 400);
  }

  const logs: Record<string, DayLog> = {};
  const entries = kv.list<string>({
    start: ["logs", start],
    end: ["logs", end + "￿"],
  });
  for await (const entry of entries) {
    // Skip version-history rows that share the "logs" prefix.
    const dateStr = entry.key[1];
    if (entry.key.length !== 2 || typeof dateStr !== "string") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    logs[dateStr] = normalizeDayLog(entry.value);
  }
  return c.json(logs, 200);
}

// Legacy whole-blob write, kept so not-yet-updated clients (an old tab, the
// installed extension) keep working until they reload.
export async function setDayLog(c: Context) {
  const dateStr = requireDate(c);
  if (!dateStr) return c.json({ error: "Missing date parameter" }, 400);
  const body = await c.req.text();
  if (!body) return c.text("Empty body", 400);
  if (body.length > MAX_DAY_BYTES) return c.json({ error: "Day is too large" }, 413);
  await kv.set(dayKey(dateStr), body);
  await emitDaySaved(c, dateStr);
  return c.text("Day log saved", 200);
}

// ---- Tasks ---------------------------------------------------------------

function sanitizeTask(t: Partial<Task>): Task | null {
  if (!t || typeof t.id !== "string" || !t.id) return null;
  const time = typeof t.time === "string" && /^\d{2}:\d{2}$/.test(t.time)
    ? t.time
    : undefined;
  const comment = typeof t.comment === "string" && t.comment ? t.comment : undefined;
  return {
    id: t.id,
    text: typeof t.text === "string" ? t.text : "",
    done: !!t.done,
    time,
    comment,
    order: typeof t.order === "number" ? t.order : Date.now(),
    updatedAt: Date.now(),
  };
}

// Body: { upsert?: Task[], remove?: string[] }. Merges by task id so two
// devices editing different tasks never overwrite each other.
export async function patchDayTasks(c: Context) {
  const dateStr = requireDate(c);
  if (!dateStr) return c.json({ error: "Missing date" }, 400);
  const snapshot = c.req.query("snapshot") === "true";
  const body = await c.req.json().catch(() => null) as
    | { upsert?: Partial<Task>[]; remove?: string[] }
    | null;
  if (!body) return c.json({ error: "Bad body" }, 400);
  const upserts = (body.upsert ?? []).map(sanitizeTask).filter((t): t is Task => !!t);
  const removes = new Set((body.remove ?? []).filter((id) => typeof id === "string"));

  try {
    const { log, prev } = await updateDay(dateStr, (log) => {
      const byId = new Map(log.tasks.map((t) => [t.id, t]));
      for (const id of removes) byId.delete(id);
      for (const t of upserts) {
        if (removes.has(t.id)) continue;
        byId.set(t.id, t);
      }
      log.tasks = Array.from(byId.values());
    });
    if (snapshot) {
      await maybeSnapshot({
        kind: "day-tasks",
        id: dateStr,
        next: { tasks: log.tasks },
        preview: tasksPreview(log.tasks),
        substantialChange: isSubstantialTaskListChange(prev.tasks, log.tasks),
      });
    }
    await emitDaySaved(c, dateStr);
    return c.json({ tasks: log.tasks });
  } catch (e) {
    if (e instanceof DayTooLargeError) return c.json({ error: "Day is too large" }, 413);
    throw e;
  }
}

// ---- Day notes -----------------------------------------------------------

// Body: { note: { id, title, markdown, order? }, baseRev?: number }.
// When baseRev is given and doesn't match the stored rev, nothing is written
// and the current note is returned with 409 so the client can merge.
export async function saveDayNote(c: Context) {
  const dateStr = requireDate(c);
  if (!dateStr) return c.json({ error: "Missing date" }, 400);
  const snapshot = c.req.query("snapshot") === "true";
  const body = await c.req.json().catch(() => null) as
    | { note?: Partial<DayNote>; baseRev?: number }
    | null;
  const input = body?.note;
  if (!input || typeof input.id !== "string" || !input.id) {
    return c.json({ error: "Bad body" }, 400);
  }

  try {
    const { log, prev } = await updateDay(dateStr, (log) => {
      const idx = log.notes.findIndex((n) => n.id === input.id);
      const existing = idx > -1 ? log.notes[idx] : null;
      if (existing && typeof body!.baseRev === "number" && existing.rev !== body!.baseRev) {
        throw new ConflictError(existing);
      }
      const next: DayNote = {
        id: input.id!,
        title: typeof input.title === "string" ? input.title : existing?.title ?? "",
        markdown: typeof input.markdown === "string"
          ? input.markdown
          : existing?.markdown ?? "",
        order: typeof input.order === "number"
          ? input.order
          : existing?.order ?? Date.now(),
        rev: (existing?.rev ?? 0) + 1,
        updatedAt: Date.now(),
      };
      if (idx > -1) log.notes[idx] = next;
      else log.notes.push(next);
    });
    const saved = log.notes.find((n) => n.id === input.id)!;
    if (snapshot) {
      const before = prev.notes.find((n) => n.id === input.id);
      await maybeSnapshot({
        kind: "day-notes",
        id: dayNoteHistoryId(dateStr, saved.id),
        next: { title: saved.title, markdown: saved.markdown },
        preview: makePreview(saved.markdown),
        substantialChange: isSubstantialTextChange(before?.markdown, saved.markdown),
      });
    }
    await emitDaySaved(c, dateStr);
    return c.json({ note: saved });
  } catch (e) {
    if (e instanceof ConflictError) return c.json({ note: e.current }, 409);
    if (e instanceof DayTooLargeError) return c.json({ error: "Day is too large" }, 413);
    throw e;
  }
}

export async function deleteDayNote(c: Context) {
  const dateStr = requireDate(c);
  const id = c.req.query("id");
  if (!dateStr || !id) return c.json({ error: "Missing parameter" }, 400);
  const { prev } = await updateDay(dateStr, (log) => {
    log.notes = log.notes.filter((n) => n.id !== id);
  });
  // Keep a recoverable copy in the note's history.
  const gone = prev.notes.find((n) => n.id === id);
  if (gone && gone.markdown.trim()) {
    await maybeSnapshot({
      kind: "day-notes",
      id: dayNoteHistoryId(dateStr, id),
      next: { title: gone.title, markdown: gone.markdown },
      preview: makePreview(gone.markdown),
      substantialChange: true,
    });
  }
  await emitDaySaved(c, dateStr);
  return c.json({ success: true });
}

// ---- Version history -----------------------------------------------------

type DayVersionContent = {
  // Current shapes
  tasks?: Task[];
  title?: string;
  markdown?: string;
  // Legacy shapes
  notesMarkdown?: string;
  hourEntries?: Record<string, LegacyHourEntry>;
};

function historyTarget(c: Context): { kind: SnapshotKind; id: string } | null {
  const dateStr = requireDate(c);
  const section = c.req.query("section");
  if (!dateStr) return null;
  if (section === "tasks") return { kind: "day-tasks", id: dateStr };
  if (section === "notes") {
    const noteId = c.req.query("note");
    if (!noteId) return null;
    return { kind: "day-notes", id: dayNoteHistoryId(dateStr, noteId) };
  }
  return null;
}

// Present every stored version in the current shape, whatever it was saved as.
function upgradeVersion(content: DayVersionContent) {
  return {
    tasks: content.tasks ??
      (content.hourEntries ? legacyHourEntriesToTasks(content.hourEntries) : undefined),
    title: content.title,
    markdown: content.markdown ?? content.notesMarkdown,
  };
}

export async function listDayVersions(c: Context) {
  const target = historyTarget(c);
  if (!target) return c.json({ error: "Bad parameters" }, 400);
  return c.json(await listVersions(target.kind, target.id));
}

export async function getDayVersion(c: Context) {
  const target = historyTarget(c);
  const savedAt = Number(c.req.query("savedAt"));
  if (!target || !Number.isFinite(savedAt)) {
    return c.json({ error: "Bad parameters" }, 400);
  }
  const v = await getVersion<DayVersionContent>(target.kind, target.id, savedAt);
  if (!v) return c.json({ error: "Version not found" }, 404);
  return c.json({ savedAt: v.savedAt, content: upgradeVersion(v.content) });
}

export async function restoreDayVersion(c: Context) {
  const dateStr = requireDate(c);
  const target = historyTarget(c);
  const savedAt = Number(c.req.query("savedAt"));
  if (!dateStr || !target || !Number.isFinite(savedAt)) {
    return c.json({ error: "Bad parameters" }, 400);
  }
  const v = await getVersion<DayVersionContent>(target.kind, target.id, savedAt);
  if (!v) return c.json({ error: "Version not found" }, 404);
  const restored = upgradeVersion(v.content);

  if (target.kind === "day-tasks") {
    const { log, prev } = await updateDay(dateStr, (log) => {
      log.tasks = restored.tasks ?? [];
    });
    // Snapshot the pre-restore state so the restore itself is reversible.
    await maybeSnapshot({
      kind: "day-tasks",
      id: dateStr,
      next: { tasks: prev.tasks },
      preview: tasksPreview(prev.tasks),
      substantialChange: true,
    });
    await emitDaySaved(c, dateStr);
    return c.json({ success: true, tasks: log.tasks });
  }

  const noteId = c.req.query("note")!;
  const { log, prev } = await updateDay(dateStr, (log) => {
    const idx = log.notes.findIndex((n) => n.id === noteId);
    const existing = idx > -1 ? log.notes[idx] : null;
    const next: DayNote = {
      id: noteId,
      title: restored.title ?? existing?.title ?? "",
      markdown: restored.markdown ?? "",
      order: existing?.order ?? Date.now(),
      rev: (existing?.rev ?? 0) + 1,
      updatedAt: Date.now(),
    };
    if (idx > -1) log.notes[idx] = next;
    else log.notes.push(next);
  });
  const before = prev.notes.find((n) => n.id === noteId);
  if (before) {
    await maybeSnapshot({
      kind: "day-notes",
      id: target.id,
      next: { title: before.title, markdown: before.markdown },
      preview: makePreview(before.markdown),
      substantialChange: true,
    });
  }
  await emitDaySaved(c, dateStr);
  return c.json({ success: true, note: log.notes.find((n) => n.id === noteId) });
}
