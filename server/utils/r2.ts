import { env } from "./env.ts";

// File bodies live in the R2 bucket bound as FILES (wrangler.jsonc). Metadata
// stays in KV (see routeHandlers/files.ts).

export const r2Enabled = () => !!env().FILES;

// `body` must have a known length: either bytes, or a stream from a
// FixedLengthStream.
export async function putObject(key: string, body: Uint8Array | ReadableStream, contentType: string) {
  await env().FILES.put(key, body, { httpMetadata: { contentType } });
}

// Returns null on 404 so callers can answer "Not found" themselves. Pass a
// `range` (an HTTP Range header value) to get a 206 partial response; an
// unsatisfiable range comes back as a 416.
export async function getObject(key: string, range?: string): Promise<Response | null> {
  const bucket = env().FILES;
  if (range) {
    const head = await bucket.head(key);
    if (!head) return null;
    const parsed = parseRange(range, head.size);
    if (parsed === "invalid") return new Response(null, { status: 416 });
    if (parsed) {
      const obj = await bucket.get(key, { range: { offset: parsed.start, length: parsed.end - parsed.start + 1 } });
      if (!obj) return null;
      return new Response(obj.body, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${parsed.start}-${parsed.end}/${head.size}`,
          "Content-Length": String(parsed.end - parsed.start + 1),
        },
      });
    }
  }
  const obj = await bucket.get(key);
  if (!obj) return null;
  return new Response(obj.body, { status: 200, headers: { "Content-Length": String(obj.size) } });
}

// Single-range "bytes=a-b", "bytes=a-" or "bytes=-n". Multi-range requests are
// answered with the whole body (null), as browsers don't need them.
function parseRange(header: string, size: number): { start: number; end: number } | null | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  let start: number;
  let end: number;
  if (a === "") {
    if (b === "") return null;
    const n = Number(b);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

export async function deleteObject(key: string) {
  await env().FILES.delete(key);
}
