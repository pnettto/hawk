import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { marked } from "marked";

// Pre-load the HTML template
let shareTemplate = "";
try {
  shareTemplate = await Deno.readTextFile("./app/share_template.html");
} catch (e) {
  console.error("Failed to load share template:", e);
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
}

export async function getCollections(c: Context) {
  const result = await kv.get(["notes", "collections"]);
  return c.json(result.value || []);
}

export async function saveCollections(c: Context) {
  const collections = await c.req.json();
  await kv.set(["notes", "collections"], collections);
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

  const note = await kv.get<{ isPublic?: boolean }>(["notes", "note", nid]);
  if (!note.value) return c.json({ error: "Note not found" }, 404);

  if (note.value.isPublic !== true) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json(note.value);
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

  return c.json({ success: true });
}

export async function saveNote(c: Context) {
  const note = await c.req.json();
  const { id, cid, title, createdAt } = note;
  if (!id || !cid) return c.json({ error: "Missing ID or CID" }, 400);

  const timestamp = Date.now();
  const existingNoteRes = await kv.get<NoteMetadata>(["notes", "note", id]);
  const existingNote = existingNoteRes.value;

  const fullNote = { ...note, updatedAt: timestamp };
  if (existingNote?.deletedAt) fullNote.deletedAt = existingNote.deletedAt;
  await kv.set(["notes", "note", id], fullNote);

  const metadata: NoteMetadata = {
    id,
    cid,
    title: title || "Untitled",
    createdAt: createdAt || existingNote?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  if (existingNote?.deletedAt) metadata.deletedAt = existingNote.deletedAt;

  const indexRes = await kv.get<NoteMetadata[]>(["notes", "collection", cid]);
  const index = indexRes.value || [];

  const existingIdx = index.findIndex((m) => m.id === id);
  if (existingIdx > -1) {
    index[existingIdx] = metadata;
  } else {
    index.unshift(metadata);
  }

  await kv.set(["notes", "collection", cid], index);
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
  }

  return c.json({ success: true });
}
