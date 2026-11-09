import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { emitSyncEvent, getClientIdFromCtx } from "../utils/syncEvents.ts";

// File storage lives in Deno KV like everything else. KV values cap at 64 KiB,
// so bodies are split into chunks:
//   ["files", "meta", id]      -> FileMeta
//   ["files", "chunk", id, i]  -> Uint8Array (≤ CHUNK_SIZE)
// Meta is written last, so a half-finished upload is never listed.
//
// Files uploaded from the editor (pasted/dropped images) are flagged `inline`
// and are also served unauthenticated at /api/public/files/:id — an <img> tag
// can't send a bearer token, and shared notes must render their images. The
// id is a random UUID, so the URL is a capability link.

const CHUNK_SIZE = 60 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  chunks: number;
  createdAt: number;
  inline?: boolean;
}

const metaKey = (id: string) => ["files", "meta", id];
const chunkKey = (id: string, i: number) => ["files", "chunk", id, i];

function cleanName(raw: string | undefined): string {
  let name = "";
  try {
    name = decodeURIComponent(raw ?? "");
  } catch {
    name = raw ?? "";
  }
  // deno-lint-ignore no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 200);
  return name || "Untitled";
}

async function deleteChunks(id: string, count: number) {
  for (let i = 0; i < count; i += 10) {
    let op = kv.atomic();
    for (let j = i; j < Math.min(count, i + 10); j++) op = op.delete(chunkKey(id, j));
    await op.commit();
  }
}

async function emitFilesChanged(c: Context, id: string) {
  await emitSyncEvent({
    type: "files.changed",
    ref: id,
    originClientId: getClientIdFromCtx(c),
  });
}

export async function listFiles(c: Context) {
  const out: FileMeta[] = [];
  for await (const e of kv.list<FileMeta>({ prefix: ["files", "meta"] })) {
    out.push(e.value);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return c.json(out);
}

// Raw body upload. Name comes in the X-File-Name header (URI-encoded),
// type from Content-Type. `?inline=1` marks editor-embedded images.
export async function uploadFile(c: Context) {
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > MAX_FILE_BYTES) {
    return c.json({ error: "File is too large (max 25 MB)" }, 413);
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "Empty body" }, 400);

  const id = crypto.randomUUID();
  const name = cleanName(c.req.header("X-File-Name"));
  const type = (c.req.header("Content-Type") || "application/octet-stream").split(";")[0];
  const inline = c.req.query("inline") === "1";

  // Re-chunk the incoming stream into fixed-size KV values as it arrives so
  // we never hold more than one chunk of the upload in memory.
  let size = 0;
  let chunks = 0;
  let buf = new Uint8Array(CHUNK_SIZE);
  let fill = 0;
  try {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new RangeError("too large");
      }
      let off = 0;
      while (off < value.byteLength) {
        const n = Math.min(CHUNK_SIZE - fill, value.byteLength - off);
        buf.set(value.subarray(off, off + n), fill);
        fill += n;
        off += n;
        if (fill === CHUNK_SIZE) {
          await kv.set(chunkKey(id, chunks++), buf);
          buf = new Uint8Array(CHUNK_SIZE);
          fill = 0;
        }
      }
    }
    if (fill > 0) await kv.set(chunkKey(id, chunks++), buf.slice(0, fill));
  } catch (e) {
    await deleteChunks(id, chunks + 1);
    if (e instanceof RangeError) {
      return c.json({ error: "File is too large (max 25 MB)" }, 413);
    }
    throw e;
  }

  const meta: FileMeta = { id, name, type, size, chunks, createdAt: Date.now() };
  if (inline) meta.inline = true;
  await kv.set(metaKey(id), meta);
  await emitFilesChanged(c, id);
  return c.json(meta);
}

function streamFile(c: Context, meta: FileMeta, download: boolean) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < meta.chunks; i += 10) {
          const keys = [];
          for (let j = i; j < Math.min(meta.chunks, i + 10); j++) keys.push(chunkKey(meta.id, j));
          const parts = await kv.getMany<Uint8Array[]>(keys);
          for (const p of parts) {
            if (!p.value) throw new Error(`Missing chunk ${String(p.key.at(-1))}`);
            controller.enqueue(p.value);
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  const encoded = encodeURIComponent(meta.name);
  return new Response(stream, {
    headers: {
      "Content-Type": meta.type || "application/octet-stream",
      "Content-Length": String(meta.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
      // Content never changes for a given id.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function getFile(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const meta = (await kv.get<FileMeta>(metaKey(id))).value;
  if (!meta) return c.json({ error: "Not found" }, 404);
  return streamFile(c, meta, c.req.query("download") === "1");
}

export async function getPublicFile(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.text("Not found", 404);
  const meta = (await kv.get<FileMeta>(metaKey(id))).value;
  // Only editor-embedded files are reachable without auth.
  if (!meta || !meta.inline) return c.text("Not found", 404);
  return streamFile(c, meta, false);
}

export async function renameFile(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const { name } = await c.req.json().catch(() => ({}));
  const res = await kv.get<FileMeta>(metaKey(id));
  if (!res.value) return c.json({ error: "Not found" }, 404);
  const meta = { ...res.value, name: cleanName(encodeURIComponent(String(name ?? ""))) };
  await kv.set(metaKey(id), meta);
  await emitFilesChanged(c, id);
  return c.json(meta);
}

export async function deleteFile(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const res = await kv.get<FileMeta>(metaKey(id));
  if (!res.value) return c.json({ success: true });
  await kv.delete(metaKey(id));
  await deleteChunks(id, res.value.chunks);
  await emitFilesChanged(c, id);
  return c.json({ success: true });
}
