import { Context } from "hono";

// Cross-device sync. Every mutating handler calls emitSyncEvent(); the Durable
// Object (server/hawkDO.ts) registers a broadcaster that pushes the event to
// every open WebSocket except the one belonging to the client that made the
// change (echo suppression by originClientId). Nothing is stored, so events
// missed while a client is disconnected aren't replayed.

export type SyncEventType =
  | "note.saved"
  | "note.trashed"
  | "note.restored"
  | "note.deleted"
  | "trash.emptied"
  | "log.saved"
  | "preferences.saved"
  | "pomodoro.saved"
  | "files.changed";

export interface SyncEvent {
  id: string;
  type: SyncEventType;
  // Primary id of the affected entity (nid or dateStr).
  ref: string;
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
  originClientId?: string;
}

type Broadcaster = (event: SyncEvent) => void;
let broadcaster: Broadcaster | null = null;

export function setBroadcaster(fn: Broadcaster) {
  broadcaster = fn;
}

// Async to keep the call sites (`await emitSyncEvent(...)`) unchanged.
export function emitSyncEvent(args: EmitArgs): Promise<void> {
  const event: SyncEvent = {
    id: ulid(),
    type: args.type,
    ref: args.ref,
    originClientId: args.originClientId,
    ts: Date.now(),
  };
  try {
    broadcaster?.(event);
  } catch (e) {
    console.error("[sync] broadcast failed", e);
  }
  return Promise.resolve();
}

export function getClientIdFromCtx(c: Context): string | undefined {
  return c.req.header("X-Client-Id") || undefined;
}

// Stable per browser (localStorage), unlike the per-tab client id. Used to
// prefer a sibling tab when the Pomodoro notifier closes.
export function getBrowserIdFromCtx(c: Context): string | undefined {
  return c.req.header("X-Browser-Id") || undefined;
}
