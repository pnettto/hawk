// GET /api/search?q=…&kind=all|notes|tasks&limit=30
//
// v1 scans: notes and day logs are listed straight from the KV and matched in
// memory (server/utils/search.ts). Read-only, so no sync events.
import type { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { buildPreview, ensureNotesMigrated, type StoredNote } from "../utils/notesStore.ts";
import { normalizeDayLog } from "../utils/dayLog.ts";
import { type DayDoc, type NoteDoc, parseQuery, searchNotes, searchTasks } from "../utils/search.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 100;

async function* noteDocs(): AsyncGenerator<NoteDoc> {
  for await (const e of kv.list<StoredNote>({ prefix: ["notes", "note"] })) {
    const n = e.value;
    if (!n || typeof n !== "object" || n.deletedAt) continue;
    yield {
      id: n.id,
      title: n.title ?? "",
      body: buildPreview(n.content, Infinity),
      tags: n.tags ?? [],
      updatedAt: n.updatedAt ?? 0,
      day: n.day,
      hidden: n.hidden,
    };
  }
}

// Newest day first. Dates sort before "version_*" rows, so the range skips
// most of those; the length check catches the rest.
async function* dayDocs(): AsyncGenerator<DayDoc> {
  for await (const e of kv.list<string>({ start: ["logs", "0"], end: ["logs", ":"] }, { reverse: true })) {
    const date = e.key[1];
    if (e.key.length !== 2 || typeof date !== "string" || !DATE_RE.test(date)) continue;
    const { tasks } = normalizeDayLog(e.value);
    if (tasks.length) yield { date, tasks };
  }
}

export async function search(c: Context) {
  const q = parseQuery(c.req.query("q") ?? "");
  const kind = c.req.query("kind") ?? "all";
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(c.req.query("limit")) || 30));
  if (!q) return c.json({ notes: [], tasks: [], truncated: false });

  const started = Date.now();
  const empty = { results: [], truncated: false };
  if (kind !== "tasks") await ensureNotesMigrated();
  const notes = kind === "tasks" ? empty : await searchNotes(noteDocs(), q, limit);
  const tasks = kind === "notes" ? empty : await searchTasks(dayDocs(), q, limit);
  console.log(`[search] ${kind} in ${Date.now() - started}ms (${notes.results.length} notes, ${tasks.results.length} tasks)`);

  return c.json({
    notes: notes.results,
    tasks: tasks.results,
    truncated: notes.truncated || tasks.truncated,
  });
}
