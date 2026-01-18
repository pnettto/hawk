import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";

// Collections storage: ["notes", "collections"] -> Collection[]
// Each Collection: { id: string, name: string }

// Notes indexing: ["notes", "collection", cid] -> string[] (note IDs)

// Note data: ["notes", "note", nid] -> { id: string, cid: string, title: string, content: string, updatedAt: number }

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

  const index = await kv.get<string[]>(["notes", "collection", cid]);
  if (!index.value) return c.json([]);

  const notes = [];
  for (const nid of index.value) {
    const note = await kv.get(["notes", "note", nid]);
    if (note.value) notes.push(note.value);
  }

  return c.json(notes);
}

export async function deleteCollection(c: Context) {
  const cid = c.req.param("cid");
  if (!cid) return c.json({ error: "Missing collection ID" }, 400);

  // Get current collections
  const collectionsRes = await kv.get<{ id: string; name: string }[]>([
    "notes",
    "collections",
  ]);
  const collections = collectionsRes.value || [];
  const filtered = collections.filter((c) => c.id !== cid);
  await kv.set(["notes", "collections"], filtered);

  // Cleanup notes in that collection (optional but good)
  const index = await kv.get<string[]>(["notes", "collection", cid]);
  if (index.value) {
    for (const nid of index.value) {
      await kv.delete(["notes", "note", nid]);
    }
  }
  await kv.delete(["notes", "collection", cid]);

  return c.json({ success: true });
}

export async function saveNote(c: Context) {
  const note = await c.req.json();
  const { id, cid } = note;
  if (!id || !cid) return c.json({ error: "Missing ID or CID" }, 400);

  // Save the note content
  await kv.set(["notes", "note", id], { ...note, updatedAt: Date.now() });

  // Update collection index if not already there
  const indexRes = await kv.get<string[]>(["notes", "collection", cid]);
  const index = indexRes.value || [];
  if (!index.includes(id)) {
    index.unshift(id);
    await kv.set(["notes", "collection", cid], index);
  }

  return c.json({ success: true });
}

export async function deleteNote(c: Context) {
  const nid = c.req.param("nid");
  if (!nid) return c.json({ error: "Missing note ID" }, 400);

  const noteRes = await kv.get<{ cid: string }>(["notes", "note", nid]);
  if (!noteRes.value) return c.json({ success: true });

  const { cid } = noteRes.value;

  // Remove from collection index
  const indexRes = await kv.get<string[]>(["notes", "collection", cid]);
  if (indexRes.value) {
    const filtered = indexRes.value.filter((id) => id !== nid);
    await kv.set(["notes", "collection", cid], filtered);
  }

  // Delete actual note
  await kv.delete(["notes", "note", nid]);

  return c.json({ success: true });
}
