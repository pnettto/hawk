// Notes storage.
//
//   ["notes", "note", nid] -> StoredNote (full body)
//   ["notes", "meta", nid] -> NoteMetadata (list row, written with the note)
//   ["notes", "schema"]    -> number (storage version, see ensureNotesMigrated)
//
// Notes carry no folder: tags are #words in the body (see tags.ts), and a
// note with `day` set is that day's journal note ("Day Notes" in Notepad).
//
// Schema 1 (legacy, left in place after migrating so nothing is lost):
//   ["notes", "collections"]      -> { id, name, isPublic? }[]
//   ["notes", "collection", cid]  -> NoteMetadata[] (with cid)
//   ["logs", dateStr].notes       -> day notes inside the day blob
import { kv } from "./kvConn.ts";
import { parseTags, slugifyTag, TAG_LINE_RE } from "./tags.ts";
import { keysFor, type SnapshotMeta } from "./versioning.ts";
import { dayNoteHistoryId, normalizeDayLog } from "./dayLog.ts";

export interface NoteMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  preview?: string;
  isPublic?: boolean;
  tags: string[];
  // "YYYY-MM-DD" for day notes.
  day?: string;
  // Order among the same day's notes.
  dayOrder?: number;
}

export interface StoredNote extends Omit<NoteMetadata, "preview"> {
  content: string;
  rev: number;
  // Schema-1 collection id. Only read by the legacy collection-share check.
  cid?: string;
}

export const noteKey = (nid: string) => ["notes", "note", nid];
export const metaKey = (nid: string) => ["notes", "meta", nid];

const SCHEMA_KEY = ["notes", "schema"];
const SCHEMA_VERSION = 2;

export function buildPreview(markdown: string | undefined, max = 140): string {
  if (!markdown) return "";
  const stripped = markdown
    .replace(TAG_LINE_RE, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > max ? stripped.slice(0, max).trimEnd() + "…" : stripped;
}

export function metaOf(note: StoredNote): NoteMetadata {
  const meta: NoteMetadata = {
    id: note.id,
    title: note.title ?? "",
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    preview: buildPreview(note.content),
    tags: note.tags ?? [],
  };
  if (note.deletedAt) meta.deletedAt = note.deletedAt;
  if (note.isPublic) meta.isPublic = true;
  if (note.day) meta.day = note.day;
  if (typeof note.dayOrder === "number") meta.dayOrder = note.dayOrder;
  return meta;
}

// The note id a day note gets. The day's first note has a fixed id so two
// devices typing into an empty day converge on one note.
export function dayNoteId(dateStr: string, legacyId = "main"): string {
  return legacyId === "main" ? `day-${dateStr}` : `day-${dateStr}-${legacyId}`;
}

// ---- migration to schema 2 -------------------------------------------------

let migrating: Promise<void> | null = null;

// Runs once per isolate; a no-op after the schema flag is set. Every step
// skips notes that already have a meta row, so concurrent or repeated runs
// converge on the same result.
export function ensureNotesMigrated(): Promise<void> {
  migrating ??= migrate().catch((e) => {
    migrating = null;
    throw e;
  });
  return migrating;
}

interface LegacyCollection {
  id: string;
  name: string;
}

interface LegacyMeta {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number;
}

async function migrate() {
  const cur = await kv.get<number>(SCHEMA_KEY);
  if ((cur.value ?? 0) >= SCHEMA_VERSION) return;
  console.log("[notes] migrating to schema 2 (tags + day notes)");
  const collections = (await kv.get<LegacyCollection[]>(["notes", "collections"])).value ?? [];
  let moved = 0;
  for (const coll of collections) {
    const tag = slugifyTag(coll.name);
    const index = (await kv.get<LegacyMeta[]>(["notes", "collection", coll.id])).value ?? [];
    for (const m of index) {
      if ((await kv.get(metaKey(m.id))).value) continue;
      const raw = (await kv.get<Partial<StoredNote>>(noteKey(m.id))).value;
      if (!raw) continue;
      const content = typeof raw.content === "string" ? raw.content : "";
      // The collection becomes a tag line at the bottom of the note.
      const tagged = !tag || parseTags(content).includes(tag)
        ? content
        : `${content.trimEnd()}${content.trim() ? "\n\n" : ""}#${tag}`;
      const note: StoredNote = {
        id: m.id,
        title: raw.title ?? m.title ?? "",
        content: tagged,
        createdAt: raw.createdAt ?? m.createdAt ?? Date.now(),
        updatedAt: raw.updatedAt ?? m.updatedAt ?? Date.now(),
        rev: (raw.rev ?? 0) + (tagged === content ? 0 : 1),
        tags: parseTags(tagged),
        cid: coll.id,
      };
      const deletedAt = raw.deletedAt ?? m.deletedAt;
      if (deletedAt) note.deletedAt = deletedAt;
      if (raw.isPublic) note.isPublic = true;
      await kv.atomic().set(noteKey(note.id), note).set(metaKey(note.id), metaOf(note)).commit();
      moved++;
    }
  }

  // Day notes. Dates sort before "version_*" rows, so the range skips those.
  let days = 0;
  for await (const entry of kv.list<string>({ start: ["logs", "0"], end: ["logs", ":"] })) {
    const dateStr = entry.key[1];
    if (entry.key.length !== 2 || typeof dateStr !== "string") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const noon = Date.parse(`${dateStr}T12:00:00Z`);
    for (const dn of normalizeDayLog(entry.value).notes) {
      if (!dn.markdown.trim() && !dn.title.trim()) continue;
      const nid = dayNoteId(dateStr, dn.id);
      if ((await kv.get(metaKey(nid))).value) continue;
      const note: StoredNote = {
        id: nid,
        title: dn.title,
        content: dn.markdown,
        createdAt: noon,
        updatedAt: dn.updatedAt || noon,
        rev: 1,
        tags: parseTags(dn.markdown),
        day: dateStr,
        dayOrder: dn.order,
      };
      await kv.atomic().set(noteKey(nid), note).set(metaKey(nid), metaOf(note)).commit();
      await copyDayHistory(dateStr, dn.id, nid, dn.title);
      days++;
    }
  }

  await kv.set(SCHEMA_KEY, SCHEMA_VERSION);
  console.log(`[notes] migrated ${moved} notes and ${days} day notes`);
}

// Copies a day note's version history to the note history of its new id.
async function copyDayHistory(dateStr: string, legacyId: string, nid: string, title: string) {
  const from = keysFor("day-notes");
  const to = keysFor("note");
  const hid = dayNoteHistoryId(dateStr, legacyId);
  const index = (await kv.get<SnapshotMeta[]>(from.index(hid))).value ?? [];
  const kept: SnapshotMeta[] = [];
  for (const v of index) {
    const e = await kv.get<{ content: { title?: string; markdown?: string; notesMarkdown?: string } }>(
      from.entry(hid, v.savedAt),
    );
    if (!e.value) continue;
    const c = e.value.content ?? {};
    await kv.set(to.entry(nid, v.savedAt), {
      savedAt: v.savedAt,
      content: { title: c.title ?? title, content: c.markdown ?? c.notesMarkdown ?? "" },
    });
    kept.push(v);
  }
  if (kept.length) await kv.set(to.index(nid), kept);
}
