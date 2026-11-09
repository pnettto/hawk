import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { marked } from "marked";
import { emitSyncEvent, getClientIdFromCtx, type SyncEventType } from "../utils/syncEvents.ts";
import {
  getVersion,
  isSubstantialTextChange,
  listVersions,
  makePreview,
  maybeSnapshot,
} from "../utils/versioning.ts";
import {
  ensureNotesMigrated,
  metaKey,
  metaOf,
  type NoteMetadata,
  noteKey,
  type StoredNote,
} from "../utils/notesStore.ts";
import { parseTags } from "../utils/tags.ts";

// Pre-load the HTML templates
let shareTemplate = "";
let shareCollectionTemplate = "";
try {
  shareTemplate = await Deno.readTextFile("./server/share_template.html");
  shareCollectionTemplate = await Deno.readTextFile("./server/shared_collection_template.html");
} catch (e) {
  console.error("Failed to load share templates:", e);
}

interface Collection {
  id: string;
  name: string;
  isPublic?: boolean;
}

export async function getPublicNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing note ID" }, 400);

  const note = await kv.get<{ isPublic?: boolean; cid?: string }>(["notes", "note", nid]);
  if (!note.value) return c.json({ error: "Note not found" }, 404);

  // Allow access if:
  // 1. Note is explicitly public, OR
  // 2. Note's collection is public
  if (note.value.isPublic === true) {
    return c.json(note.value);
  }

  // Check if the collection is public
  if (note.value.cid) {
    const collectionsRes = await kv.get<Collection[]>(["notes", "collections"]);
    const collections = collectionsRes.value || [];
    const collection = collections.find((col) => col.id === note.value.cid);
    
    if (collection?.isPublic === true) {
      return c.json(note.value);
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
}

export async function getSharedNotePage(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.text("Note not found", 404);

  const noteRes = await kv.get<
    { isPublic?: boolean; title: string; content: string; createdAt: number }
  >(["notes", "note", nid]);
  if (!noteRes.value || noteRes.value.isPublic !== true) {
    return c.text("Note not found or private", 404);
  }

  const note = noteRes.value;
  const htmlContent = marked.parse(note.content || "");
  const dateStr = new Date(note.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Inject into template
  // We need to replace the client-side logic with static content
  let html = shareTemplate;

  // 1. Inject Title
  html = html.replace(
    /<title>.*<\/title>/,
    `<title>${note.title || "Shared Note"}</title>`,
  );

  // 2. Inject Content into the container, removing the loading spinner
  // We also replace the entire viewer-container content to remove the client-side script dependency
  // But wait, the template has <div id="content">...</div>. Let's just inject into it.

  const renderedBody = `
        <h1 title="${note.title}">${note.title || "Untitled"}</h1>
        <div class="tiptap">${htmlContent}</div>
        <div class="meta">
            <span>${dateStr}</span>
            <span>Hawk</span>
        </div>
  `;

  html = html.replace(
    /<div class="viewer-container" id="content">[\s\S]*?<\/div>/,
    `<div class="viewer-container" id="content">${renderedBody}</div>`,
  );

  // 3. Remove the client-side script
  html = html.replace(/<script type="module">[\s\S]*?<\/script>/, "");

  return c.html(html);
}

// Deno KV rejects values over 64 KiB; surface that as a clear 413.
const MAX_NOTE_BYTES = 63 * 1024;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function emitNote(c: Context, type: SyncEventType, ref: string) {
  await emitSyncEvent({ type, ref, originClientId: getClientIdFromCtx(c) });
}

async function listMeta(): Promise<NoteMetadata[]> {
  await ensureNotesMigrated();
  const out: NoteMetadata[] = [];
  for await (const e of kv.list<NoteMetadata>({ prefix: ["notes", "meta"] })) out.push(e.value);
  return out;
}

// Every note's list row, trashed ones included.
export async function getNotesIndex(c: Context) {
  return c.json(await listMeta());
}

export async function getNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing note ID" }, 400);
  await ensureNotesMigrated();
  const note = await kv.get(noteKey(nid));
  if (!note.value) return c.json({ error: "Note not found" }, 404);
  return c.json(note.value);
}

// Full day notes with `day` in [start, end] — the Journal overview.
export async function getDayNotes(c: Context) {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return c.json({ error: "Missing start or end date" }, 400);
  }
  const ids = (await listMeta())
    .filter((m) => m.day && !m.deletedAt && m.day >= start && m.day <= end)
    .map((m) => noteKey(m.id));
  const notes: StoredNote[] = [];
  // getMany takes at most 10 keys.
  for (let i = 0; i < ids.length; i += 10) {
    for (const r of await kv.getMany<StoredNote[]>(ids.slice(i, i + 10))) {
      if (r.value) notes.push(r.value);
    }
  }
  return c.json(notes);
}

// Body: { id, title?, content?, createdAt?, isPublic?, day?, dayOrder?,
// baseRev?, snapshot? }. Omitted fields keep their stored value, so a
// metadata-only save (share toggle) never touches the body. Tags are always
// re-derived from the body.
export async function saveNote(c: Context) {
  const body = await c.req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !id) return c.json({ error: "Missing ID" }, 400);
  await ensureNotesMigrated();

  const existingRes = await kv.get<StoredNote>(noteKey(id));
  const existing = existingRes.value;

  // Optimistic concurrency: a client that says which rev it edited from gets
  // a 409 (and the current note) instead of silently overwriting a newer save
  // from another device. Clients that omit baseRev keep last-write-wins.
  if (existing && typeof body.baseRev === "number" && (existing.rev ?? 0) !== body.baseRev) {
    return c.json({ note: existing }, 409);
  }

  const now = Date.now();
  const content = typeof body.content === "string" ? body.content : existing?.content ?? "";
  const title = typeof body.title === "string" ? body.title : existing?.title ?? "";
  // rev tracks the editable text (title + body) only, so metadata-only saves
  // don't invalidate an open editor's baseRev on another device — nor float
  // the note to the top of "recent".
  const textChanged = !existing || content !== existing.content || title !== existing.title;
  const note: StoredNote = {
    id,
    title,
    content,
    createdAt: existing?.createdAt ?? (typeof body.createdAt === "number" ? body.createdAt : now),
    updatedAt: textChanged || !existing ? now : existing.updatedAt,
    rev: (existing?.rev ?? 0) + (textChanged ? 1 : 0),
    tags: parseTags(content),
  };
  const isPublic = typeof body.isPublic === "boolean" ? body.isPublic : existing?.isPublic;
  if (isPublic) note.isPublic = true;
  if (existing?.deletedAt) note.deletedAt = existing.deletedAt;
  if (existing?.cid) note.cid = existing.cid;
  // A note's day is fixed when it's created.
  const day = existing ? existing.day : (typeof body.day === "string" && DATE_RE.test(body.day) ? body.day : undefined);
  if (day) note.day = day;
  const dayOrder = typeof body.dayOrder === "number" ? body.dayOrder : existing?.dayOrder;
  if (day && typeof dayOrder === "number") note.dayOrder = dayOrder;

  if (JSON.stringify(note).length > MAX_NOTE_BYTES) {
    return c.json({ error: "Note is too large" }, 413);
  }
  const commit = await kv.atomic()
    .check(existingRes)
    .set(noteKey(id), note)
    .set(metaKey(id), metaOf(note))
    .commit();
  if (!commit.ok) {
    // Another save landed between our read and write.
    const latest = await kv.get(noteKey(id));
    return c.json({ note: latest.value }, 409);
  }

  if (body.snapshot === true) {
    await maybeSnapshot({
      kind: "note",
      id,
      next: { title: note.title, content: note.content },
      preview: makePreview(note.content),
      substantialChange: isSubstantialTextChange(existing?.content, note.content),
    });
  }

  await emitNote(c, "note.saved", id);
  return c.json({ success: true, rev: note.rev, updatedAt: note.updatedAt });
}

// Read-modify-write one note's deletedAt, keeping note and meta in step.
async function setDeleted(nid: string, deletedAt: number | null): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await kv.get<StoredNote>(noteKey(nid));
    if (!res.value) return false;
    const note = { ...res.value };
    if (deletedAt) note.deletedAt = deletedAt;
    else delete note.deletedAt;
    const ok = await kv.atomic().check(res).set(noteKey(nid), note).set(metaKey(nid), metaOf(note)).commit();
    if (ok.ok) return true;
  }
  throw new Error("Note write contention");
}

export async function trashNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing ID" }, 400);
  await ensureNotesMigrated();
  // A note that never reached the server has nothing to trash.
  if (await setDeleted(nid, Date.now())) await emitNote(c, "note.trashed", nid);
  return c.json({ success: true });
}

export async function restoreNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing ID" }, 400);
  await ensureNotesMigrated();
  if (await setDeleted(nid, null)) await emitNote(c, "note.restored", nid);
  return c.json({ success: true });
}

export async function permanentlyDeleteNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing ID" }, 400);
  await ensureNotesMigrated();
  await kv.atomic().delete(noteKey(nid)).delete(metaKey(nid)).commit();
  await emitNote(c, "note.deleted", nid);
  return c.json({ success: true });
}

export async function emptyTrash(c: Context) {
  const trashed = (await listMeta()).filter((m) => m.deletedAt);
  for (const m of trashed) {
    await kv.atomic().delete(noteKey(m.id)).delete(metaKey(m.id)).commit();
  }
  await emitNote(c, "trash.emptied", "all");
  return c.json({ success: true, count: trashed.length });
}

// Collection sharing endpoints
export async function getPublicCollection(c: Context) {
  const cid = c.req.param("cid");
  if (!cid) return c.json({ error: "Missing collection ID" }, 400);

  const collectionsRes = await kv.get<Collection[]>(["notes", "collections"]);
  const collections = collectionsRes.value || [];
  const collection = collections.find((col) => col.id === cid);

  if (!collection || collection.isPublic !== true) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Get all notes in this collection (excluding deleted)
  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  const notes = (indexRes.value || []).filter((n) => !n.deletedAt);

  return c.json({ collection, notes });
}

// Version history for notes
export async function listNoteVersions(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing note ID" }, 400);
  const versions = await listVersions("note", nid);
  return c.json(versions);
}

export async function getNoteVersion(c: Context) {
  const nid = c.req.param("nid");
  const savedAtStr = c.req.param("savedAt");
  if (!nid || !savedAtStr) return c.json({ error: "Missing parameter" }, 400);
  const savedAt = Number(savedAtStr);
  if (!Number.isFinite(savedAt)) return c.json({ error: "Bad savedAt" }, 400);
  const v = await getVersion<{ title?: string; content?: string }>(
    "note",
    nid,
    savedAt,
  );
  if (!v) return c.json({ error: "Version not found" }, 404);
  return c.json(v);
}

export async function restoreNoteVersion(c: Context) {
  const nid = c.req.param("nid");
  const savedAtStr = c.req.param("savedAt");
  if (!nid || !savedAtStr) return c.json({ error: "Missing parameter" }, 400);
  const savedAt = Number(savedAtStr);
  if (!Number.isFinite(savedAt)) return c.json({ error: "Bad savedAt" }, 400);

  const target = await getVersion<{ title?: string; content?: string }>(
    "note",
    nid,
    savedAt,
  );
  if (!target) return c.json({ error: "Version not found" }, 404);

  await ensureNotesMigrated();
  const noteRes = await kv.get<StoredNote>(noteKey(nid));
  if (!noteRes.value) return c.json({ error: "Note not found" }, 404);
  const current = noteRes.value;

  // Snapshot the current state before overwriting so the restore is itself
  // reversible. Force a "substantial" flag so the entry is always appended,
  // regardless of how recently a snapshot was taken.
  await maybeSnapshot({
    kind: "note",
    id: nid,
    next: { title: current.title, content: current.content },
    preview: makePreview(current.content),
    substantialChange: true,
  });

  const content = target.content.content ?? "";
  const restored: StoredNote = {
    ...current,
    title: target.content.title ?? current.title,
    content,
    tags: parseTags(content),
    updatedAt: Date.now(),
    rev: (current.rev ?? 0) + 1,
  };
  await kv.atomic().set(noteKey(nid), restored).set(metaKey(nid), metaOf(restored)).commit();
  await emitNote(c, "note.saved", nid);

  return c.json({ success: true, note: restored });
}

export async function getSharedCollectionPage(c: Context) {
  const cid = c.req.param("cid");
  if (!cid) return c.text("Collection not found", 404);

  const collectionsRes = await kv.get<Collection[]>(["notes", "collections"]);
  const collections = collectionsRes.value || [];
  const collection = collections.find((col) => col.id === cid);

  if (!collection || collection.isPublic !== true) {
    return c.text("Collection not found or private", 404);
  }

  // Return the static template - the client will fetch the data via API
  return c.html(shareCollectionTemplate);
}

