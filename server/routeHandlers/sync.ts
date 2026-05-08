import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { isValidToken } from "../middleware/auth.ts";
import type { SyncEvent } from "../utils/syncEvents.ts";

// Server-Sent Events stream of cross-device sync events.
// EventSource can't set headers, so the token is passed in the query string.
//
// Wire protocol per frame:
//   id: <ulid>
//   event: <type>
//   data: <json SyncEvent>
//
// Plus periodic ":keepalive\n\n" comments to defeat proxy idle timeouts.

const KEEPALIVE_MS = 25_000;

// Lower bound for the next list scan. Inclusive on the prefix, exclusive on the
// last seen ulid (we use ulid + "\x00" — i.e. just past it in lex order).
function eventListBounds(lastUlid: string | null) {
  return {
    start: lastUlid
      ? ["sync", "event", lastUlid + "\x00"]
      : ["sync", "event"],
    end: ["sync", "event", "\xff"],
  };
}

function sseFrame(evt: SyncEvent): string {
  return `id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
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

      // Keepalive timer.
      const keepalive = setInterval(() => send(`:keepalive\n\n`), KEEPALIVE_MS);

      // Cursor of the last event ulid we've delivered. Start from "now" so we
      // don't replay everything in the 90s retention window on connect.
      let lastUlid: string | null = null;
      try {
        const tail = kv.list<SyncEvent>(
          { prefix: ["sync", "event"] },
          { reverse: true, limit: 1 },
        );
        for await (const entry of tail) {
          lastUlid = entry.key[2] as string;
        }
      } catch (e) {
        console.error("[sync] cursor init failed", e);
      }

      const onAbort = () => {
        clearInterval(keepalive);
        close();
      };
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });

      // Watch the version key — fires whenever any write bumps it.
      const watch = kv.watch([["sync", "version"]]);
      try {
        for await (const _ of watch) {
          if (closed) break;
          const bounds = eventListBounds(lastUlid);
          const iter = kv.list<SyncEvent>(bounds);
          for await (const entry of iter) {
            const evt = entry.value;
            const ulidPart = entry.key[2] as string;
            lastUlid = ulidPart;
            // Echo suppression: don't bounce a write back to its origin tab.
            if (
              connectionClientId &&
              evt.originClientId &&
              evt.originClientId === connectionClientId
            ) {
              continue;
            }
            send(sseFrame(evt));
          }
        }
      } catch (e) {
        if (!closed) console.error("[sync] watch loop failed", e);
      } finally {
        clearInterval(keepalive);
        abortSignal.removeEventListener("abort", onAbort);
        close();
      }
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
