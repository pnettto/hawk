import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { isValidToken } from "../middleware/auth.ts";
import { SYNC_KEYS, type SyncEvent } from "../utils/syncEvents.ts";

// Server-Sent Events stream of cross-device sync events.
// EventSource can't set headers, so the token is passed in the query string.
//
// Wire protocol per frame:
//   id: <ulid>
//   event: <type>
//   data: <json SyncEvent>
//
// Plus periodic ":keepalive\n\n" comments to defeat proxy idle timeouts.
//
// Implementation note: we *poll* the ["sync","tail"] counter with `kv.get`
// rather than using `kv.watch`. Deno Deploy's KV proxy intermittently rejects
// `/watch` and `/snapshot_read` (the endpoints behind `kv.watch` / `kv.list`)
// with `invalidAuthorizationHeader`, while plain `kv.get` keeps working on the
// same deployment. See syncEvents.ts for the key layout.

const KEEPALIVE_MS = 25_000;
const POLL_MS = 750;

function sseFrame(evt: SyncEvent): string {
  return `id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
}

async function readTail(): Promise<bigint> {
  const res = await kv.get<Deno.KvU64>(SYNC_KEYS.tail());
  return res.value?.value ?? 0n;
}

export function streamSync(c: Context) {
  const token = c.req.query("token");
  if (!isValidToken(token)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const connectionClientId = c.req.query("clientId") || "";
  const abortSignal = c.req.raw.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch { /* already closed */ }
      };
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Initial handshake.
      send(`retry: 3000\n\n`);
      send(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

      const keepalive = setInterval(() => send(`:keepalive\n\n`), KEEPALIVE_MS);

      // Start "from now" so a reconnect doesn't replay the recent window.
      let lastSent = await readTail();

      // Declared up front so `onAbort` can close over a stable binding and
      // safely cancel the poller whether abort fires before or after it starts.
      let poller: ReturnType<typeof setInterval> | null = null;

      const onAbort = () => {
        clearInterval(keepalive);
        if (poller) clearInterval(poller);
        close();
      };
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });

      // Polling loop. Each tick: read tail, drain any new indices via kv.get.
      // Overlapping ticks are guarded by `busy` so a slow KV round-trip can't
      // schedule a second drain on top of an in-flight one.
      let busy = false;
      poller = setInterval(async () => {
        if (closed || busy) return;
        busy = true;
        try {
          const tail = await readTail();
          while (lastSent < tail && !closed) {
            const next = lastSent + 1n;
            const entry = await kv.get<SyncEvent>(SYNC_KEYS.queue(next));
            lastSent = next;
            const evt = entry.value;
            // Entry may have expired (90s TTL) if the SSE was idle for longer
            // than the retention window — skip and keep advancing the cursor.
            if (!evt) continue;
            if (
              connectionClientId &&
              evt.originClientId &&
              evt.originClientId === connectionClientId
            ) {
              continue;
            }
            send(sseFrame(evt));
          }
        } catch (e) {
          if (!closed) console.error("[sync] poll failed", e);
        } finally {
          busy = false;
        }
      }, POLL_MS);
    },
    cancel() {
      // Reader went away — ReadableStream will surface as an abort upstream.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
