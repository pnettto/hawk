import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { deleteObject, getObject, putObject, r2Enabled } from "../utils/r2.ts";
import { emitSyncEvent, getClientIdFromCtx } from "../utils/syncEvents.ts";

// File metadata lives in KV; bodies live in the R2 bucket (server/utils/r2.ts):
//   ["files", "meta", id]  -> FileMeta
//   R2 object "files/<id>" -> body
// The object is written before the meta, so a half-finished upload is never
// listed; on delete the meta goes first, so at worst we orphan an object.
//
// Legacy: files uploaded before R2 have no `storage` field and keep their body
// in KV chunks (["files", "chunk", id, i], ≤ CHUNK_SIZE each). They're still
// readable, and POST /api/files/migrate moves them to R2.
//
// Files uploaded from the editor (pasted/dropped images) are flagged `inline`
// and are also served unauthenticated at /api/public/files/:id — an <img> tag
// can't send a bearer token, and shared notes must render their images. The
// id is a random UUID, so the URL is a capability link.

const CHUNK_SIZE = 60 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  inline?: boolean;
  storage?: "r2";
  // Legacy KV-chunked files only.
  chunks?: number;
}

const metaKey = (id: string) => ["files", "meta", id];
const chunkKey = (id: string, i: number) => ["files", "chunk", id, i];
const objectKey = (id: string) => `files/${id}`;

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

async function deleteBody(meta: FileMeta) {
  if (meta.storage === "r2") await deleteObject(objectKey(meta.id));
  else await deleteChunks(meta.id, meta.chunks ?? 0);
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

// Read a stream into memory, bailing out as soon as it passes `limit`. Only
// used to move small legacy KV-chunked files into R2; uploads stream.
// `sizeHint` lets us allocate once and fill in place.
async function readCapped(
  body: ReadableStream<Uint8Array>,
  limit: number,
  sizeHint = 0,
): Promise<Uint8Array<ArrayBuffer>> {
  let buf = new Uint8Array(Math.min(sizeHint > 0 ? sizeHint : 1024 * 1024, limit));
  let size = 0;
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > limit) {
      await reader.cancel();
      throw new RangeError("too large");
    }
    if (size + value.byteLength > buf.byteLength) {
      const grown = new Uint8Array(Math.min(Math.max(buf.byteLength * 2, size + value.byteLength), limit));
      grown.set(buf.subarray(0, size));
      buf = grown;
    }
    buf.set(value, size);
    size += value.byteLength;
  }
  return size === buf.byteLength ? buf : buf.subarray(0, size);
}

// Raw body upload. Name comes in the X-File-Name header (URI-encoded),
// type from Content-Type. `?inline=1` marks editor-embedded images.
//
// The body streams straight into R2 instead of being buffered: the Durable
// Object has 128 MB of memory, less than the largest allowed file. R2 needs the
// length up front, so Content-Length is required (browsers always send it for
// a File/Blob body) and FixedLengthStream enforces it.
export async function uploadFile(c: Context) {
  if (!r2Enabled()) return c.json({ error: "File storage is not configured" }, 503);
  const lengthHeader = c.req.header("Content-Length");
  const declared = Number(lengthHeader);
  if (!lengthHeader || !Number.isInteger(declared) || declared < 0) {
    return c.json({ error: "Missing Content-Length" }, 411);
  }
  if (declared > MAX_FILE_BYTES) {
    return c.json({ error: "File is too large (max 100 MB)" }, 413);
  }

  const id = crypto.randomUUID();
  const name = cleanName(c.req.header("X-File-Name"));
  const type = (c.req.header("Content-Type") || "application/octet-stream").split(";")[0];
  const inline = c.req.query("inline") === "1";

  const body = c.req.raw.body;
  if (body && declared > 0) {
    const { readable, writable } = new FixedLengthStream(declared);
    await Promise.all([putObject(objectKey(id), readable, type), body.pipeTo(writable)]);
  } else {
    await putObject(objectKey(id), new Uint8Array(0), type);
  }

  const meta: FileMeta = { id, name, type, size: declared, createdAt: Date.now(), storage: "r2" };
  if (inline) meta.inline = true;
  await kv.set(metaKey(id), meta);
  await emitFilesChanged(c, id);
  return c.json(meta);
}

function streamChunks(meta: FileMeta): ReadableStream<Uint8Array> {
  const count = meta.chunks ?? 0;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < count; i += 10) {
          const keys = [];
          for (let j = i; j < Math.min(count, i + 10); j++) keys.push(chunkKey(meta.id, j));
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
}

// R2-backed files honour Range requests, which <video> needs to seek (and
// Safari needs to play at all). Legacy KV-chunked files always go out whole.
async function streamFile(c: Context, meta: FileMeta, download: boolean) {
  let stream: ReadableStream<Uint8Array> | null;
  let status = 200;
  let length = String(meta.size);
  let contentRange: string | null = null;
  if (meta.storage === "r2") {
    const range = c.req.header("Range");
    const obj = await getObject(objectKey(meta.id), range);
    if (!obj) return c.json({ error: "Not found" }, 404);
    if (obj.status === 416) {
      await obj.body?.cancel();
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${meta.size}` } });
    }
    stream = obj.body;
    if (obj.status === 206) {
      status = 206;
      contentRange = obj.headers.get("Content-Range");
      length = obj.headers.get("Content-Length") ?? length;
    }
  } else {
    stream = streamChunks(meta);
  }
  const encoded = encodeURIComponent(meta.name);
  const headers: Record<string, string> = {
    "Content-Type": meta.type || "application/octet-stream",
    "Content-Length": length,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
    // Content never changes for a given id.
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (meta.storage === "r2") headers["Accept-Ranges"] = "bytes";
  if (contentRange) headers["Content-Range"] = contentRange;
  return new Response(stream, { status, headers });
}

export async function getFile(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const meta = (await kv.get<FileMeta>(metaKey(id))).value;
  if (!meta) return c.json({ error: "Not found" }, 404);
  return await streamFile(c, meta, c.req.query("download") === "1");
}

export async function getPublicFile(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.text("Not found", 404);
  const meta = (await kv.get<FileMeta>(metaKey(id))).value;
  // Only editor-embedded files are reachable without auth.
  if (!meta || !meta.inline) return c.text("Not found", 404);
  return await streamFile(c, meta, false);
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

// Body: { ids: string[] }. One request and one sync event for a whole selection.
export async function deleteFiles(c: Context) {
  const { ids } = await c.req.json().catch(() => ({})) as { ids?: unknown };
  if (!Array.isArray(ids)) return c.json({ error: "ids must be an array" }, 400);
  const deleted: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const res = await kv.get<FileMeta>(metaKey(id));
    if (!res.value) continue;
    await kv.delete(metaKey(id));
    await deleteBody(res.value);
    deleted.push(id);
  }
  if (deleted.length) await emitFilesChanged(c, deleted.join(","));
  return c.json({ deleted });
}

export async function deleteFile(c: Context) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const res = await kv.get<FileMeta>(metaKey(id));
  if (!res.value) return c.json({ success: true });
  await kv.delete(metaKey(id));
  await deleteBody(res.value);
  await emitFilesChanged(c, id);
  return c.json({ success: true });
}

// One-off: move legacy KV-chunked files into R2. Handles a few files per call
// to stay well inside request time limits — call repeatedly until
// `remaining` is 0. Safe to re-run; the meta only flips to R2 after the
// object is written, and chunks are dropped after that.
export async function migrateFilesToR2(c: Context) {
  if (!r2Enabled()) return c.json({ error: "File storage is not configured" }, 503);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 10, 1), 50);
  const legacy: FileMeta[] = [];
  for await (const e of kv.list<FileMeta>({ prefix: ["files", "meta"] })) {
    if (e.value.storage !== "r2") legacy.push(e.value);
  }
  const migrated: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const meta of legacy.slice(0, limit)) {
    try {
      const bytes = await readCapped(streamChunks(meta), Infinity, meta.size);
      await putObject(objectKey(meta.id), bytes, meta.type || "application/octet-stream");
      const { chunks, ...rest } = meta;
      await kv.set(metaKey(meta.id), { ...rest, size: bytes.byteLength, storage: "r2" });
      await deleteChunks(meta.id, chunks ?? 0);
      migrated.push(meta.id);
    } catch (e) {
      failed.push({ id: meta.id, error: String(e) });
    }
  }
  return c.json({ migrated, failed, remaining: legacy.length - migrated.length });
}
