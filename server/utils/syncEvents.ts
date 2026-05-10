import { Context } from "hono";
import { kv } from "./kvConn.ts";

// Sync event log uses an indexed queue + a monotonic tail counter:
//   ["sync", "tail"]        -> Deno.KvU64, current head index N
//   ["sync", "queue", N]    -> SyncEvent (90s TTL)
//
// The SSE handler polls `kv.get(["sync","tail"])` to detect changes and fetches
// each new index with `kv.get(["sync","queue", N])`. We deliberately do not use
// `kv.watch` or `kv.list` — Deno Deploy's KV proxy intermittently rejects
// `/watch` and `/snapshot_read` for those two operations with
// `invalidAuthorizationHeader`, while `kv.get`/`kv.set`/atomic CAS keep working
// on the same deployment. Polling at this cadence is cheap and avoids the
// failure mode entirely.

const TAIL_KEY = ["sync", "tail"] as const;
const QUEUE_PREFIX = ["sync", "queue"] as const;
const EVENT_TTL_MS = 90_000;

// Exported so the SSE handler can use the same key shapes without duplicating
// them.
export const SYNC_KEYS = {
  tail: () => [...TAIL_KEY] as Deno.KvKey,
  queue: (n: bigint | number) => [...QUEUE_PREFIX, Number(n)] as Deno.KvKey,
} as const;

export type SyncEventType =
  | "note.saved"
  | "note.trashed"
  | "note.restored"
  | "note.deleted"
  | "trash.emptied"
  | "collection.saved"
  | "collection.deleted"
  | "log.saved"
  | "preferences.saved";

export interface SyncEvent {
  id: string;
  type: SyncEventType;
  // Primary id of the affected entity (nid, cid, or dateStr).
  ref: string;
  // For note events, the collection id (lets clients refresh just one index).
  cid?: string;
  // The clientId that triggered the write — used to suppress echoes.
  originClientId?: string;
  ts: number;
}

// Crockford base32 ulid: 10 chars time + 16 chars random. Monotonic within
// the same ms so events emitted back-to-back sort correctly.
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastUlidMs = 0;
let lastUlidRand = "";

function encodeUlidTime(ms: number): string {
  let out = "";
  for (let i = 9; i >= 0; i--) {
    out = ULID_ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function randomUlidPart(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 16; i++) out += ULID_ALPHABET[bytes[i] % 32];
  return out;
}

function incRand(s: string): string {
  const chars = s.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ULID_ALPHABET.indexOf(chars[i]);
    if (idx < 31) {
      chars[i] = ULID_ALPHABET[idx + 1];
      return chars.join("");
    }
    chars[i] = ULID_ALPHABET[0];
  }
  // overflow — extremely unlikely, fall back to fresh randomness
  return randomUlidPart();
}

export function ulid(): string {
  const now = Date.now();
  let rand: string;
  if (now === lastUlidMs) {
    rand = incRand(lastUlidRand);
  } else {
    rand = randomUlidPart();
    lastUlidMs = now;
  }
  lastUlidRand = rand;
  return encodeUlidTime(now) + rand;
}

interface EmitArgs {
  type: SyncEventType;
  ref: string;
  cid?: string;
  originClientId?: string;
}

// CAS-increment the tail and write the event at the new index in one atomic
// commit. On conflict (another concurrent emit landed between our read and our
// commit), retry — bounded so a misbehaving caller can't loop forever.
const MAX_EMIT_RETRIES = 5;

export async function emitSyncEvent(args: EmitArgs): Promise<void> {
  const event: SyncEvent = {
    id: ulid(),
    type: args.type,
    ref: args.ref,
    cid: args.cid,
    originClientId: args.originClientId,
    ts: Date.now(),
  };

  for (let attempt = 0; attempt < MAX_EMIT_RETRIES; attempt++) {
    const tailRes = await kv.get<Deno.KvU64>(SYNC_KEYS.tail());
    const cur = tailRes.value?.value ?? 0n;
    const next = cur + 1n;
    const res = await kv.atomic()
      .check({ key: SYNC_KEYS.tail(), versionstamp: tailRes.versionstamp })
      .set(SYNC_KEYS.tail(), new Deno.KvU64(next))
      .set(SYNC_KEYS.queue(next), event, { expireIn: EVENT_TTL_MS })
      .commit();
    if (res.ok) return;
  }
  console.error("[sync] emit failed after retries", event);
}

export function getClientIdFromCtx(c: Context): string | undefined {
  return c.req.header("X-Client-Id") || undefined;
}
