import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import type { KvKey, KvKeyPart } from "../utils/sqliteKv.ts";

// Raw key/value dump and restore, used to move data in from Deno KV
// (scripts/kv-to-cloudflare.ts) and for backups. Auth'd like every /api route.
//
// Wire format, one object per entry:
//   { key: Part[], value: <json> }      JSON values
//   { key: Part[], bytes: "<base64>" }  Uint8Array values (legacy file chunks)
// where Part is a string, number, boolean, { "$bytes": "<base64>" } or
// { "$bigint": "<decimal>" }.

export type WirePart = string | number | boolean | { $bytes: string } | { $bigint: string };
export type WireEntry = { key: WirePart[]; value: unknown } | { key: WirePart[]; bytes: string };

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

function partFromWire(p: WirePart): KvKeyPart {
  if (typeof p === "object" && p !== null) {
    if ("$bytes" in p) return unb64(p.$bytes);
    if ("$bigint" in p) return BigInt(p.$bigint);
  }
  if (typeof p === "string" || typeof p === "number" || typeof p === "boolean") return p;
  throw new TypeError("Bad key part");
}

function partToWire(p: KvKeyPart): WirePart {
  if (p instanceof Uint8Array) return { $bytes: b64(p) };
  if (typeof p === "bigint") return { $bigint: p.toString() };
  return p;
}

// Body: { entries: WireEntry[] }. Overwrites existing keys.
export async function importEntries(c: Context) {
  const { entries } = await c.req.json().catch(() => ({})) as { entries?: unknown };
  if (!Array.isArray(entries)) return c.json({ error: "entries must be an array" }, 400);
  let op = kv.atomic();
  for (const e of entries as WireEntry[]) {
    if (!e || !Array.isArray(e.key) || !e.key.length) return c.json({ error: "Bad entry" }, 400);
    const key: KvKey = e.key.map(partFromWire);
    op = "bytes" in e ? op.set(key, unb64(e.bytes)) : op.set(key, e.value);
  }
  await op.commit();
  return c.json({ imported: entries.length });
}

// Query: ?cursor=<last key as JSON>&limit=N. Returns { entries, cursor } where
// cursor is null on the last page.
export async function exportEntries(c: Context) {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 500, 1), 2000);
  const after = c.req.query("cursor");
  const start = after ? (JSON.parse(after) as WirePart[]).map(partFromWire) : null;
  // `start` is inclusive, so fetch one extra and drop the cursor key itself.
  const iter = start ? kv.list({ prefix: [], start }, { limit: limit + 1 }) : kv.list({ prefix: [] }, { limit });
  const out: WireEntry[] = [];
  let last: KvKey | null = null;
  for await (const e of iter) {
    if (start && last === null && sameKey(e.key, start)) {
      last = start;
      continue;
    }
    if (out.length >= limit) break;
    const key = e.key.map(partToWire);
    out.push(e.value instanceof Uint8Array ? { key, bytes: b64(e.value) } : { key, value: e.value });
    last = e.key;
  }
  const more = out.length === limit && last;
  return c.json({ entries: out, cursor: more ? JSON.stringify(last!.map(partToWire)) : null });
}

function sameKey(a: KvKey, b: KvKey) {
  return a.length === b.length && a.every((p, i) => {
    const q = b[i];
    if (p instanceof Uint8Array && q instanceof Uint8Array) return b64(p) === b64(q);
    return p === q;
  });
}
