import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { marked } from "marked";
import { emitSyncEvent, getClientIdFromCtx } from "../utils/syncEvents.ts";
import {
  getVersion,
  isSubstantialTextChange,
  listVersions,
  makePreview,
  maybeSnapshot,
} from "../utils/versioning.ts";

// Pre-load the HTML templates
let shareTemplate = "";
let shareCollectionTemplate = "";
try {
  shareTemplate = await Deno.readTextFile("./server/share_template.html");
  shareCollectionTemplate = await Deno.readTextFile("./server/shared_collection_template.html");
} catch (e) {
  console.error("Failed to load share templates:", e);
}

// Collections storage: ["notes", "collections"] -> Collection[]
// Each Collection: { id: string, name: string }

// Notes indexing: ["notes", "collection", cid] -> string[] (note IDs)

// Note data: ["notes", "note", nid] -> { id: string, cid: string, title: string, content: string, updatedAt: number }

interface NoteMetadata {
  id: string;
  cid: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  preview?: string;
}

function buildPreview(markdown: string | undefined, max = 140): string {
  if (!markdown) return "";
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
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

interface Collection {
  id: string;
  name: string;
  isPublic?: boolean;
}

export async function getCollections(c: Context) {
  const result = await kv.get(["notes", "collections"]);
  return c.json(result.value || []);
}

export async function saveCollections(c: Context) {
  const collections = await c.req.json();
  await kv.set(["notes", "collections"], collections);
  await emitSyncEvent({
    type: "collection.saved",
    ref: "all",
    originClientId: getClientIdFromCtx(c),
  });
  return c.json({ success: true });
}

export async function getCollectionNotes(c: Context) {
  const cid = c.req.param("cid");
  if (!cid) return c.json({ error: "Missing collection ID" }, 400);

  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  if (!indexRes.value) return c.json([]);

  return c.json(indexRes.value.filter((n) => !n.deletedAt));
}

export async function getTrash(c: Context) {
  const cid = c.req.param("cid");
  if (!cid) return c.json({ error: "Missing CID" }, 400);

  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  if (!indexRes.value) return c.json([]);

  return c.json(indexRes.value.filter((n) => !!n.deletedAt));
}

export async function getNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing note ID" }, 400);

  const note = await kv.get(["notes", "note", nid]);
  if (!note.value) return c.json({ error: "Note not found" }, 404);

  return c.json(note.value);
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

export async function getNotesIndex(c: Context) {
  const collsRes = await kv.get<{ id: string }[]>(["notes", "collections"]);
  const colls = collsRes.value || [];

  const allMetadata: NoteMetadata[] = [];
  for (const coll of colls) {
    const res = await kv.get<NoteMetadata[]>(["notes", "collection", coll.id]);
    if (res.value) {
      allMetadata.push(...res.value);
    }
  }
  return c.json(allMetadata);
}

export async function deleteCollection(c: Context) {
  const cid = c.req.param("cid");
  if (!cid) return c.json({ error: "Missing collection ID" }, 400);

  const collectionsRes = await kv.get<{ id: string; name: string }[]>([
    "notes",
    "collections",
  ]);
  const collections = collectionsRes.value || [];
  const filtered = collections.filter((item) => item.id !== cid);
  await kv.set(["notes", "collections"], filtered);

  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  if (indexRes.value) {
    for (const item of indexRes.value) {
      await kv.delete(["notes", "note", item.id]);
    }
  }
  await kv.delete(["notes", "collection", cid]);

  await emitSyncEvent({
    type: "collection.deleted",
    ref: cid,
    cid,
    originClientId: getClientIdFromCtx(c),
  });
  return c.json({ success: true });
}

export async function saveNote(c: Context) {
  const note = await c.req.json();
  const { id, cid, title, createdAt, snapshot } = note;
  if (!id || !cid) return c.json({ error: "Missing ID or CID" }, 400);

  const timestamp = Date.now();
  const existingNoteRes = await kv.get<
    NoteMetadata & { content?: string }
  >(["notes", "note", id]);
  const existingNote = existingNoteRes.value;

  // Strip the snapshot flag so it doesn't pollute the stored record.
  const { snapshot: _drop, ...notePayload } = note;
  const fullNote = { ...notePayload, updatedAt: timestamp };
  // If the client never loaded full content (e.g. a metadata-only save from a
  // title edit, or a snapshot trigger that fired before the editor finished
  // hydrating), keep the existing body instead of wiping it.
  if (notePayload.content === undefined && existingNote?.content !== undefined) {
    fullNote.content = existingNote.content;
  }
  if (existingNote?.deletedAt) fullNote.deletedAt = existingNote.deletedAt;
  await kv.set(["notes", "note", id], fullNote);

  if (snapshot === true) {
    const substantial = isSubstantialTextChange(
      existingNote?.content,
      fullNote.content,
    );
    await maybeSnapshot({
      kind: "note",
      id,
      next: { title: fullNote.title, content: fullNote.content },
      preview: makePreview(fullNote.content),
      substantialChange: substantial,
    });
  }

  const metadata: NoteMetadata = {
    id,
    cid,
    title: title || "Untitled",
    createdAt: createdAt || existingNote?.createdAt || timestamp,
    updatedAt: timestamp,
    preview: buildPreview(note.content),
  };
  if (existingNote?.deletedAt) metadata.deletedAt = existingNote.deletedAt;

  // If the note moved to a different collection, drop it from the old index.
  if (existingNote && existingNote.cid && existingNote.cid !== cid) {
    const oldIndexRes = await kv.get<NoteMetadata[]>([
      "notes",
      "collection",
      existingNote.cid,
    ]);
    if (oldIndexRes.value) {
      const cleanedOld = oldIndexRes.value.filter((m) => m.id !== id);
      await kv.set(["notes", "collection", existingNote.cid], cleanedOld);
    }
  }

  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  const index = indexRes.value || [];

  const existingIdx = index.findIndex((m) => m.id === id);
  if (existingIdx > -1) {
    index[existingIdx] = metadata;
  } else {
    index.unshift(metadata);
  }

  await kv.set(["notes", "collection", cid], index);
  await emitSyncEvent({
    type: "note.saved",
    ref: id,
    cid,
    originClientId: getClientIdFromCtx(c),
  });
  return c.json({ success: true });
}

export async function trashNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing ID" }, 400);

  const { cid: bodyCid } = await c.req.json().catch(() => ({}));

  const noteRes = await kv.get<NoteMetadata>(["notes", "note", nid]);
  let note = noteRes.value;

  if (!note) {
    if (!bodyCid) {
      return c.json({ error: "Note not found and no CID provided" }, 404);
    }
    // Create tombstone for optimistic note
    note = {
      id: nid,
      cid: bodyCid,
      title: "Untitled",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: Date.now(),
    };
  } else {
    note.deletedAt = Date.now();
  }

  await kv.set(["notes", "note", nid], note);

  // Update index metadata
  const { cid } = note;
  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  const index = indexRes.value || [];

  let found = false;
  const newIndex = index.map((m) => {
    if (m.id === nid) {
      found = true;
      return { ...m, deletedAt: note!.deletedAt };
    }
    return m;
  });

  if (!found && note) {
    const { id, cid, title, createdAt, updatedAt, deletedAt } = note;
    newIndex.unshift({ id, cid, title, createdAt, updatedAt, deletedAt });
  }

  await kv.set(["notes", "collection", cid], newIndex);

  await emitSyncEvent({
    type: "note.trashed",
    ref: nid,
    cid,
    originClientId: getClientIdFromCtx(c),
  });
  return c.json({ success: true });
}

export async function restoreNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing ID" }, 400);

  const noteRes = await kv.get<NoteMetadata>(["notes", "note", nid]);
  if (!noteRes.value) return c.json({ success: true });

  const note = noteRes.value;
  delete note.deletedAt;
  await kv.set(["notes", "note", nid], note);

  // Restore in index
  const { cid } = note;
  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  const index = indexRes.value || [];

  const newIndex = index.map((m) => {
    if (m.id === nid) {
      const { deletedAt: _, ...rest } = m;
      return rest as NoteMetadata;
    }
    return m;
  });
  await kv.set(["notes", "collection", cid], newIndex);

  await emitSyncEvent({
    type: "note.restored",
    ref: nid,
    cid,
    originClientId: getClientIdFromCtx(c),
  });
  return c.json({ success: true });
}

export async function emptyTrash(c: Context) {
  const cid = c.req.param("cid");
  if (!cid) return c.json({ error: "Missing CID" }, 400);

  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  if (!indexRes.value) return c.json({ success: true });

  const index = indexRes.value;
  const trashed = index.filter((n: NoteMetadata) => !!n.deletedAt);
  const active = index.filter((n: NoteMetadata) => !n.deletedAt);

  for (const n of trashed) {
    await kv.delete(["notes", "note", n.id]);
  }

  await kv.set(["notes", "collection", cid], active);
  await emitSyncEvent({
    type: "trash.emptied",
    ref: cid,
    cid,
    originClientId: getClientIdFromCtx(c),
  });
  return c.json({ success: true });
}

export async function permanentlyDeleteNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing ID" }, 400);

  const noteRes = await kv.get<NoteMetadata>(["notes", "note", nid]);
  const note = noteRes.value;

  if (note) {
    const { cid } = note;
    await kv.delete(["notes", "note", nid]);

    // Remove from index
    const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
    if (indexRes.value) {
      const newIndex = indexRes.value.filter((m) => m.id !== nid);
      await kv.set(["notes", "collection", cid], newIndex);
    }

    await emitSyncEvent({
      type: "note.deleted",
      ref: nid,
      cid,
      originClientId: getClientIdFromCtx(c),
    });
  }

  return c.json({ success: true });
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

  const noteRes = await kv.get<NoteMetadata & { content?: string }>([
    "notes",
    "note",
    nid,
  ]);
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

  const now = Date.now();
  const restored = {
    ...current,
    title: target.content.title ?? current.title,
    content: target.content.content ?? "",
    updatedAt: now,
  };
  await kv.set(["notes", "note", nid], restored);

  // Update the collection index entry's title + preview + updatedAt.
  const idxRes = await kv.get<NoteMetadata[]>([
    "notes",
    "collection",
    current.cid,
  ]);
  const idx = idxRes.value ?? [];
  const updated = idx.map((m) =>
    m.id === nid
      ? {
        ...m,
        title: restored.title || "Untitled",
        preview: buildPreview(restored.content),
        updatedAt: now,
      }
      : m
  );
  await kv.set(["notes", "collection", current.cid], updated);

  await emitSyncEvent({
    type: "note.saved",
    ref: nid,
    cid: current.cid,
    originClientId: getClientIdFromCtx(c),
  });

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

