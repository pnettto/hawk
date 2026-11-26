import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { emitSyncEvent, getClientIdFromCtx } from "../utils/syncEvents.ts";
import { getVersion, listVersions, maybeSnapshot, type SnapshotKind } from "../utils/versioning.ts";
import { ensureNotesMigrated } from "../utils/notesStore.ts";
import {
  type DayLog,
  dayNoteHistoryId,
  isSubstantialTaskListChange,
  type LegacyHourEntry,
  legacyHourEntriesToTasks,
  moveTasksBetween,
  normalizeDayLog,
  parseDayRaw,
  type Task,
  tasksPreview,
} from "../utils/dayLog.ts";

// Size cap inherited from Deno KV's 64 KiB value limit, kept so clients see the
// same behaviour. Fail loudly with a clear status.
const MAX_DAY_BYTES = 63 * 1024;

const dayKey = (dateStr: string) => ["logs", dateStr];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class DayTooLargeError extends Error {}

// ---- Legacy day-notes sweep ------------------------------------------------

const LOGS_SCHEMA_KEY = ["logs", "schema"];
const LOGS_SCHEMA_VERSION = 2;
let sweeping: Promise<void> | null = null;

// Strips the legacy `notes` array and `notesMarkdown` from every stored day,
// once (flag ["logs", "schema"] = 2). The notes migration runs first, so a
// database that still has blob notes gets them copied out as regular notes
// before they're removed. Same promise guard as ensureNotesMigrated.
export function ensureLogsSwept(): Promise<void> {
  sweeping ??= sweepLogs().catch((e) => {
    sweeping = null;
    throw e;
  });
  return sweeping;
}

// Tests reset the store between cases.
export function resetLogsSweepForTests() {
  sweeping = null;
}

async function sweepLogs() {
  const cur = await kv.get<number>(LOGS_SCHEMA_KEY);
  if ((cur.value ?? 0) >= LOGS_SCHEMA_VERSION) return;
  await ensureNotesMigrated();
  let stripped = 0;
  // Dates sort before "schema" and "version_*" rows, so the range skips them.
  for await (const entry of kv.list<unknown>({ start: ["logs", "0"], end: ["logs", ":"] })) {
    const dateStr = entry.key[1];
    if (entry.key.length !== 2 || typeof dateStr !== "string" || !DATE_RE.test(dateStr)) continue;
    const obj = parseDayRaw(entry.value);
    if (!("notes" in obj) && !("notesMarkdown" in obj)) continue;
    const { notes: _n, notesMarkdown: _m, ...rest } = obj;
    // A concurrent write already stores the day without them.
    await kv.atomic().check(entry).set(entry.key, JSON.stringify(rest)).commit();
    stripped++;
  }
  await kv.set(LOGS_SCHEMA_KEY, LOGS_SCHEMA_VERSION);
  console.log(`[logs] stripped legacy notes from ${stripped} days`);
}

export function retiredDayNotes(c: Context) {
  return c.json({ error: "Day notes moved to /api/notes/notes" }, 410);
}

// Read-modify-write one or more day blobs under optimistic versionstamp
// checks, so two task writes landing at the same moment both survive, and a write spanning several days changes all of them or none.
async function updateDays<R>(
  dates: string[],
  mutate: (logs: DayLog[]) => R,
): Promise<{ logs: DayLog[]; prevs: DayLog[]; result: R }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const curs = await Promise.all(dates.map((d) => kv.get<string>(dayKey(d))));
    const prevs = curs.map((cur) => normalizeDayLog(cur.value));
    const logs = prevs.map((p) => structuredClone(p));
    const result = mutate(logs);
    const bodies = logs.map((log) => JSON.stringify(log));
    if (bodies.some((b) => b.length > MAX_DAY_BYTES)) throw new DayTooLargeError();
    const op = kv.atomic();
    for (const cur of curs) op.check(cur);
    dates.forEach((d, i) => op.set(dayKey(d), bodies[i]));
    const res = await op.commit();
    if (res.ok) return { logs, prevs, result };
  }
  throw new Error("Day log write contention");
}

async function updateDay<R>(
  dateStr: string,
  mutate: (log: DayLog) => R,
): Promise<{ log: DayLog; prev: DayLog; result: R }> {
  const { logs, prevs, result } = await updateDays([dateStr], ([log]) => mutate(log));
  return { log: logs[0], prev: prevs[0], result };
}

function requireDate(c: Context): string | null {
  const d = c.req.query("date");
  return d && DATE_RE.test(d) ? d : null;
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
  const raw = await c.req.text();
  if (!raw) return c.text("Empty body", 400);
  if (raw.length > MAX_DAY_BYTES) return c.json({ error: "Day is too large" }, 413);
  try {
    JSON.parse(raw);
  } catch {
    return c.json({ error: "Bad body" }, 400);
  }
  // Stored in the current shape, so an old client can't bring back day notes.
  await kv.set(dayKey(dateStr), JSON.stringify(normalizeDayLog(raw)));
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
  const parentId = typeof t.parentId === "string" && t.parentId && t.parentId !== t.id
    ? t.parentId
    : undefined;
  return {
    id: t.id,
    text: typeof t.text === "string" ? t.text : "",
    done: !!t.done,
    time,
    comment,
    parentId,
    cancelled: t.cancelled ? true : undefined,
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

// Body: { from, to, ids, orders? }. Moves tasks (with their subtasks) from
// one day to another in a single atomic write, keeping their ids. `orders`
// pins the order of specific top-level tasks, so undo can put them back
// exactly where they were.
export async function moveDayTasks(c: Context) {
  const body = await c.req.json().catch(() => null) as
    | { from?: unknown; to?: unknown; ids?: unknown; orders?: unknown }
    | null;
  const from = typeof body?.from === "string" && DATE_RE.test(body.from) ? body.from : null;
  const to = typeof body?.to === "string" && DATE_RE.test(body.to) ? body.to : null;
  if (!from || !to) return c.json({ error: "Missing date" }, 400);
  if (from === to) return c.json({ error: "Pick a different day" }, 400);
  const ids = Array.isArray(body!.ids)
    ? body!.ids.filter((id): id is string => typeof id === "string" && !!id)
    : [];
  if (!ids.length) return c.json({ error: "No tasks to move" }, 400);
  const orders: Record<string, number> = {};
  if (body!.orders && typeof body!.orders === "object") {
    for (const [id, v] of Object.entries(body!.orders as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) orders[id] = v;
    }
  }

  try {
    const { logs, prevs, result: moved } = await updateDays([from, to], ([src, dst]) => {
      const r = moveTasksBetween(src.tasks, dst.tasks, ids, { orders });
      src.tasks = r.from;
      dst.tasks = r.to;
      return r.moved;
    });
    if (moved.length) {
      // Keep each day's state from before the move, so history can undo it.
      for (const [i, dateStr] of [from, to].entries()) {
        await maybeSnapshot({
          kind: "day-tasks",
          id: dateStr,
          next: { tasks: prevs[i].tasks },
          preview: tasksPreview(prevs[i].tasks),
          substantialChange: true,
        });
      }
      await emitDaySaved(c, from);
      await emitDaySaved(c, to);
    }
    return c.json({ from: { tasks: logs[0].tasks }, to: { tasks: logs[1].tasks }, moved });
  } catch (e) {
    if (e instanceof DayTooLargeError) return c.json({ error: "Day is too large" }, 413);
    throw e;
  }
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
  // Day notes are regular notes now, restored through note history.
  if (target.kind !== "day-tasks") return retiredDayNotes(c);
  const v = await getVersion<DayVersionContent>(target.kind, target.id, savedAt);
  if (!v) return c.json({ error: "Version not found" }, 404);
  const restored = upgradeVersion(v.content);

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
