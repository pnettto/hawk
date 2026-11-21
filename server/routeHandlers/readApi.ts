// Read API for agents such as the Pi `hawk` tool. Reference: docs/api.md.
//
// Same auth as everything else under /api. Resources are built in
// utils/readModel.ts (ISO timestamps, links back into the app). Read-only, so
// no sync events.
import type { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import {
  buildPreview,
  ensureNotesMigrated,
  listMeta,
  metaOf,
  type NoteMetadata,
  noteKey,
  type StoredNote,
} from "../utils/notesStore.ts";
import { compareTasks, normalizeDayLog } from "../utils/dayLog.ts";
import { noteMatches, parseQuery } from "../utils/search.ts";
import {
  journalUrl,
  type NoteType,
  noteType,
  pickReport,
  toNoteListItem,
  toNoteResource,
  toTaskResource,
} from "../utils/readModel.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const originOf = (c: Context) => new URL(c.req.url).origin;
const bad = (c: Context, error: string) => c.json({ error }, 400);

// GET /api/notes/:id — one note with its content. Trashed notes are still
// returned, with `trashedAt` set.
export async function getNoteResource(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Note not found" }, 404);
  await ensureNotesMigrated();
  const note = (await kv.get<StoredNote>(noteKey(id))).value;
  if (!note) return c.json({ error: "Note not found" }, 404);
  return c.json(toNoteResource(note, originOf(c)));
}

function parseType(raw: string | undefined): NoteType | undefined | null {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "notepad" || raw === "note") return "notepad";
  if (raw === "journal") return "journal";
  return null;
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_LIMIT ? n : null;
}

// GET /api/notes?type=&date=&q=&limit= — newest first, trash left out.
export async function listNoteResources(c: Context) {
  const type = parseType(c.req.query("type"));
  if (type === null) return bad(c, "Unknown type");
  const date = c.req.query("date") || undefined;
  if (date !== undefined && !DATE_RE.test(date)) return bad(c, "Bad date");
  const limit = parseLimit(c.req.query("limit"));
  if (limit === null) return bad(c, `Limit must be 1–${MAX_LIMIT}`);
  const rawQ = (c.req.query("q") ?? "").trim();

  const keep = (n: Pick<NoteMetadata, "day" | "deletedAt">) =>
    !n.deletedAt &&
    (type === undefined || noteType(n) === type) &&
    (date === undefined || n.day === date);

  let metas: NoteMetadata[];
  let truncated = false;
  if (!rawQ) {
    metas = (await listMeta()).filter(keep);
  } else {
    const q = parseQuery(rawQ);
    metas = [];
    if (q) {
      await ensureNotesMigrated();
      // Stops at the first `limit` matches; `truncated` says there may be more.
      for await (const e of kv.list<StoredNote>({ prefix: ["notes", "note"] })) {
        const n = e.value;
        if (!n || typeof n !== "object" || !keep(n)) continue;
        const doc = {
          id: n.id,
          title: n.title ?? "",
          body: buildPreview(n.content, Infinity),
          tags: n.tags ?? [],
          updatedAt: n.updatedAt ?? 0,
          day: n.day,
          hidden: n.hidden,
        };
        if (!noteMatches(doc, q)) continue;
        if (metas.length >= limit) {
          truncated = true;
          break;
        }
        metas.push(metaOf(n));
      }
    }
  }

  metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (metas.length > limit) {
    truncated = true;
    metas = metas.slice(0, limit);
  }
  const origin = originOf(c);
  return c.json({ items: metas.map((m) => toNoteListItem(m, origin)), truncated });
}

// GET /api/tasks?date= — the day's tasks in the order the Journal shows them.
// `date` is required: the server runs in UTC, so its "today" may not be the
// caller's.
export async function listTasks(c: Context) {
  const date = c.req.query("date");
  if (!date) return bad(c, "Missing date");
  if (!DATE_RE.test(date)) return bad(c, "Bad date");
  const { tasks } = normalizeDayLog((await kv.get<string>(["logs", date])).value);
  return c.json({
    date,
    url: journalUrl(originOf(c), date),
    tasks: [...tasks].sort(compareTasks).map(toTaskResource),
  });
}

// GET /api/reports/:date?user= — the active Pi report for a day.
export async function getReport(c: Context) {
  const date = c.req.param("date");
  if (!date || !DATE_RE.test(date)) return bad(c, "Bad date");
  const user = c.req.query("user") || undefined;
  const pick = pickReport(await listMeta(), date, user);
  if (pick.active) {
    const note = (await kv.get<StoredNote>(noteKey(pick.active.id))).value;
    if (note) {
      return c.json({ ...toNoteResource(note, originOf(c)), alternatives: pick.alternatives });
    }
  }
  return c.json(
    pick.trashedOnly ? { error: "Report not found", trashed: true } : { error: "Report not found" },
    404,
  );
}
