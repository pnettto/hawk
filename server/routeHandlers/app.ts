import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { emitSyncEvent, getClientIdFromCtx } from "../utils/syncEvents.ts";
import {
  getVersion,
  isSubstantialTasksChange,
  isSubstantialTextChange,
  listVersions,
  makePreview,
  maybeSnapshot,
  type SnapshotKind,
} from "../utils/versioning.ts";

interface HourEntry {
  checked: boolean;
  text: string;
  comment: string;
}
type DayLog = { notesMarkdown?: string } & Record<
  string,
  HourEntry | string | undefined
>;

const HOUR_KEY = /^\d{1,2}(?:-\d{1,2})?$/;

function parseDayLog(raw: unknown): DayLog {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DayLog;
    } catch {
      return {};
    }
  }
  return raw as DayLog;
}

function pickHourEntries(log: DayLog): Record<string, HourEntry> {
  const out: Record<string, HourEntry> = {};
  for (const [k, v] of Object.entries(log)) {
    if (HOUR_KEY.test(k) && v && typeof v === "object" && "text" in v) {
      out[k] = v as HourEntry;
    }
  }
  return out;
}

// ... existing functions
export async function getDayLog(c: Context) {
  const dateStr = c.req.query("date");
  if (!dateStr) return c.json({ error: "Missing date parameter" }, 400);

  const result = await kv.get<string>(["logs", dateStr]);
  if (!result.value) return c.json({}, 200);

  console.log(`[GET /api/day] ✓ Retrieved log for ${dateStr}`);
  return c.text(result.value, 200);
}

export async function getRangeLog(c: Context) {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end) {
    return c.json({ error: "Missing start or end date" }, 400);
  }

  const logs: Record<string, unknown> = {};
  // Use start and end to fetch the range from KV
  const entries = kv.list({
    start: ["logs", start],
    end: ["logs", end + "\uffff"],
  });

  for await (const entry of entries) {
    const dateStr = entry.key[1] as string;
    try {
      logs[dateStr] = typeof entry.value === "string"
        ? JSON.parse(entry.value)
        : entry.value;
    } catch {
      logs[dateStr] = entry.value;
    }
  }

  console.log(`[GET /api/range] ✓ Retrieved ${Object.keys(logs).length} days`);
  return c.json(logs, 200);
}

export async function setDayLog(c: Context) {
  const dateStr = c.req.query("date");
  if (!dateStr) return c.json({ error: "Missing date parameter" }, 400);
  const snapshotFlag = c.req.query("snapshot") === "true";
  const sectionParam =
    (c.req.query("section") as "notes" | "tasks" | "both" | undefined) ??
      "both";

  const body = await c.req.text();
  if (!body) return c.text("Empty body", 400);

  // Read the existing blob *before* overwriting so we can compare for the
  // snapshot decision. Then write the new body.
  let prev: DayLog = {};
  if (snapshotFlag) {
    const prevRes = await kv.get<string>(["logs", dateStr]);
    prev = parseDayLog(prevRes.value);
  }

  await kv.set(["logs", dateStr], body);
  console.log(
    `[POST /api/day] ✓ Saved log for ${dateStr} (${body.length} bytes)`,
  );

  if (snapshotFlag) {
    const next = parseDayLog(body);

    // Always call maybeSnapshot when explicitly triggered; coalesce-in-place
    // (≤24h, non-substantial change) prevents duplicate-content noise without
    // a separate diff guard. A guard against `prev === next` would miss the
    // common case where the live blob was already saved seconds before.
    if (sectionParam === "notes" || sectionParam === "both") {
      const prevMd = prev.notesMarkdown ?? "";
      const nextMd = next.notesMarkdown ?? "";
      await maybeSnapshot({
        kind: "day-notes",
        id: dateStr,
        next: { notesMarkdown: nextMd },
        preview: makePreview(nextMd),
        substantialChange: isSubstantialTextChange(prevMd, nextMd),
      });
    }

    if (sectionParam === "tasks" || sectionParam === "both") {
      const prevTasks = pickHourEntries(prev);
      const nextTasks = pickHourEntries(next);
      await maybeSnapshot({
        kind: "day-tasks",
        id: dateStr,
        next: { hourEntries: nextTasks },
        preview: makePreview(nextTasks),
        substantialChange: isSubstantialTasksChange(prevTasks, nextTasks),
      });
    }
  }

  await emitSyncEvent({
    type: "log.saved",
    ref: dateStr,
    originClientId: getClientIdFromCtx(c),
  });

  return c.text("Day log saved", 200);
}

function dayKindFor(section: string | undefined): SnapshotKind {
  return section === "tasks" ? "day-tasks" : "day-notes";
}

export async function listDayVersions(c: Context) {
  const dateStr = c.req.query("date");
  const section = c.req.query("section");
  if (!dateStr) return c.json({ error: "Missing date" }, 400);
  if (section !== "notes" && section !== "tasks") {
    return c.json({ error: "section must be 'notes' or 'tasks'" }, 400);
  }
  const versions = await listVersions(dayKindFor(section), dateStr);
  return c.json(versions);
}

export async function getDayVersion(c: Context) {
  const dateStr = c.req.query("date");
  const section = c.req.query("section");
  const savedAtStr = c.req.query("savedAt");
  if (!dateStr || !savedAtStr) {
    return c.json({ error: "Missing parameter" }, 400);
  }
  if (section !== "notes" && section !== "tasks") {
    return c.json({ error: "section must be 'notes' or 'tasks'" }, 400);
  }
  const savedAt = Number(savedAtStr);
  if (!Number.isFinite(savedAt)) return c.json({ error: "Bad savedAt" }, 400);
  const v = await getVersion(dayKindFor(section), dateStr, savedAt);
  if (!v) return c.json({ error: "Version not found" }, 404);
  return c.json(v);
}

export async function restoreDayVersion(c: Context) {
  const dateStr = c.req.query("date");
  const section = c.req.query("section");
  const savedAtStr = c.req.query("savedAt");
  if (!dateStr || !savedAtStr) {
    return c.json({ error: "Missing parameter" }, 400);
  }
  if (section !== "notes" && section !== "tasks") {
    return c.json({ error: "section must be 'notes' or 'tasks'" }, 400);
  }
  const savedAt = Number(savedAtStr);
  if (!Number.isFinite(savedAt)) return c.json({ error: "Bad savedAt" }, 400);

  const target = await getVersion<
    { notesMarkdown?: string; hourEntries?: Record<string, HourEntry> }
  >(dayKindFor(section), dateStr, savedAt);
  if (!target) return c.json({ error: "Version not found" }, 404);

  const liveRes = await kv.get<string>(["logs", dateStr]);
  const live = parseDayLog(liveRes.value);

  // Snapshot the current section before overwriting (force-append).
  if (section === "notes") {
    const currentMd = live.notesMarkdown ?? "";
    await maybeSnapshot({
      kind: "day-notes",
      id: dateStr,
      next: { notesMarkdown: currentMd },
      preview: makePreview(currentMd),
      substantialChange: true,
    });
    live.notesMarkdown = target.content.notesMarkdown ?? "";
  } else {
    const currentTasks = pickHourEntries(live);
    await maybeSnapshot({
      kind: "day-tasks",
      id: dateStr,
      next: { hourEntries: currentTasks },
      preview: makePreview(currentTasks),
      substantialChange: true,
    });
    // Replace all hour-key entries with the snapshot's set.
    for (const k of Object.keys(live)) {
      if (HOUR_KEY.test(k)) delete live[k];
    }
    const restoredTasks = target.content.hourEntries ?? {};
    for (const [k, v] of Object.entries(restoredTasks)) {
      live[k] = v;
    }
  }

  const newBody = JSON.stringify(live);
  await kv.set(["logs", dateStr], newBody);

  await emitSyncEvent({
    type: "log.saved",
    ref: dateStr,
    originClientId: getClientIdFromCtx(c),
  });

  return c.json({ success: true, dayLog: live });
}
