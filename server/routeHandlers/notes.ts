import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";

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

  const indexRes = await kv.get<unknown[]>(["notes", "collection", cid]);
  if (!indexRes.value) return c.json([]);

  // Transition: If index is strings (IDs), we must fetch them once to build metadata
  if (indexRes.value.length > 0 && typeof indexRes.value[0] === "string") {
    const metadataList: NoteMetadata[] = [];
    const ids = indexRes.value as string[];
    for (const nid of ids) {
      const noteRes = await kv.get<NoteMetadata>(["notes", "note", nid]);
      if (noteRes.value) {
        const { id, cid, title, createdAt, updatedAt } = noteRes.value;
        metadataList.push({ id, cid, title, createdAt, updatedAt });
      }
    }
    // Update index to new format
    await kv.set(["notes", "collection", cid], metadataList);
    return c.json(metadataList);
  }

  return c.json(indexRes.value);
}

export async function getNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing note ID" }, 400);

  const note = await kv.get(["notes", "note", nid]);
  if (!note.value) return c.json({ error: "Note not found" }, 404);

  return c.json(note.value);
}

export async function getNotesIndex(c: Context) {
  const collsRes = await kv.get<{ id: string }[]>(["notes", "collections"]);
  const colls = collsRes.value || [];

  const allMetadata: NoteMetadata[] = [];
  for (const coll of colls) {
    const res = await kv.get<unknown[]>(["notes", "collection", coll.id]);
    if (res.value) {
      if (res.value.length > 0 && typeof res.value[0] === "string") {
        // Migrate collection index on the fly
        const metadataList: NoteMetadata[] = [];
        const ids = res.value as string[];
        for (const nid of ids) {
          const noteRes = await kv.get<NoteMetadata>(["notes", "note", nid]);
          if (noteRes.value) {
            const { id, cid, title, createdAt, updatedAt } = noteRes.value;
            metadataList.push({ id, cid, title, createdAt, updatedAt });
          }
        }
        await kv.set(["notes", "collection", coll.id], metadataList);
        allMetadata.push(...metadataList);
      } else {
        allMetadata.push(...(res.value as NoteMetadata[]));
      }
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

  const indexRes = await kv.get<unknown[]>(["notes", "collection", cid]);
  if (indexRes.value) {
    for (const item of indexRes.value) {
      const nid = typeof item === "string" ? item : (item as NoteMetadata).id;
      await kv.delete(["notes", "note", nid]);
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
  const fullNote = { ...note, updatedAt: timestamp };
  await kv.set(["notes", "note", id], fullNote);

  const metadata: NoteMetadata = {
    id,
    cid,
    title: title || "Untitled Note",
    createdAt: createdAt || timestamp,
    updatedAt: timestamp,
  };

  const indexRes = await kv.get<unknown[]>(["notes", "collection", cid]);
  let index = (indexRes.value || []) as (string | NoteMetadata)[];

  // Transform legacy index if needed
  if (index.length > 0 && typeof index[0] === "string") {
    const ids = index as string[];
    const newIndex: NoteMetadata[] = [];
    for (const nid of ids) {
      if (nid === id) continue; // Will be added/updated later
      const nRes = await kv.get<NoteMetadata>(["notes", "note", nid]);
      if (nRes.value) {
        const { id, cid, title, createdAt, updatedAt } = nRes.value;
        newIndex.push({ id, cid, title, createdAt, updatedAt });
      }
    }
    index = newIndex;
  }

  const existingIdx = index.findIndex((m) =>
    (typeof m === "string" ? m : m.id) === id
  );
  if (existingIdx > -1) {
    index[existingIdx] = metadata;
  } else {
    (index as NoteMetadata[]).unshift(metadata);
  }

  await kv.set(["notes", "collection", cid], index);
  return c.json({ success: true });
}

export async function deleteNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing note ID" }, 400);

  const noteRes = await kv.get<{ cid: string }>(["notes", "note", nid]);
  if (!noteRes.value) return c.json({ success: true });

  const { cid } = noteRes.value;
  const indexRes = await kv.get<unknown[]>(["notes", "collection", cid]);
  if (indexRes.value) {
    const filtered = indexRes.value.filter((item) => {
      const id = typeof item === "string" ? item : (item as NoteMetadata).id;
      return id !== nid;
    });
    await kv.set(["notes", "collection", cid], filtered);
  }

  await kv.delete(["notes", "note", nid]);
  return c.json({ success: true });
}
