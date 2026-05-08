import { Context } from "hono";
import { kv } from "./kvConn.ts";

// Sync event log: ["sync", "event", <ulid>] -> SyncEvent (90s TTL)
// Version key:    ["sync", "version"]       -> Deno.KvU64 (bumped per write)
//
// Clients open SSE at /api/sync/stream and watch the version key. On bump
// they list events with key > lastSeenUlid. Echo suppression is by clientId.

const VERSION_KEY = ["sync", "version"] as const;
const EVENT_PREFIX = ["sync", "event"] as const;
const EVENT_TTL_MS = 90_000;

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

export async function emitSyncEvent(args: EmitArgs): Promise<void> {
  const event: SyncEvent = {
    id: ulid(),
    type: args.type,
    ref: args.ref,
    cid: args.cid,
    originClientId: args.originClientId,
    ts: Date.now(),
  };

  const res = await kv.atomic()
    .mutate({
      type: "sum",
      key: VERSION_KEY,
      value: new Deno.KvU64(1n),
    })
    .set([...EVENT_PREFIX, event.id], event, { expireIn: EVENT_TTL_MS })
    .commit();

  if (!res.ok) {
    console.error("[sync] emit failed", event);
  }
}

export function getClientIdFromCtx(c: Context): string | undefined {
  return c.req.header("X-Client-Id") || undefined;
}
