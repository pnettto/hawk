import { DurableObject } from "cloudflare:workers";
import { app } from "./app.ts";
import { initKv } from "./utils/kvConn.ts";
import { type Env, setEnv } from "./utils/env.ts";
import { setBroadcaster } from "./utils/syncEvents.ts";
import { ensurePomodoroDuty, relayPomodoroDuty } from "./utils/pomodoro.ts";
import { isValidToken } from "./middleware/auth.ts";

// The whole backend: one Durable Object instance ("hawk") that owns the data
// (SQLite, through the Deno.Kv-style layer in utils/sqliteKv.ts), runs the Hono
// API and holds the sync WebSockets.
//
// Sync sockets use the WebSocket Hibernation API: the object can be evicted
// from memory while sockets stay open, so idle tabs cost nothing. Clients send
// "ping" every 30s; the runtime answers "pong" without waking the object.
export class HawkDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    setEnv(env);
    initKv(ctx.storage);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    setBroadcaster((event) => {
      const frame = JSON.stringify(event);
      for (const ws of ctx.getWebSockets()) {
        // Each socket is tagged with its tab's clientId; skip the tab that made
        // the change.
        if (
          event.originClientId &&
          ctx.getTags(ws).includes(`client:${event.originClientId}`)
        ) continue;
        try {
          ws.send(frame);
        } catch {
          /* socket is closing */
        }
      }
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/sync/ws") return await this.acceptSync(request, url);
    return await app.fetch(request, this.env);
  }

  // The token comes in the query string because browsers can't set headers on
  // a WebSocket handshake.
  private async acceptSync(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (!(await isValidToken(url.searchParams.get("token")))) {
      return new Response("Unauthorized", { status: 401 });
    }
    const clientId = (url.searchParams.get("clientId") || "").slice(0, 200);
    const browserId = (url.searchParams.get("browserId") || "").slice(0, 200);
    const tags = [
      clientId ? `client:${clientId}` : "",
      browserId ? `browser:${browserId}` : "",
    ].filter(Boolean);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, tags);
    server.send(JSON.stringify({ type: "hello", ts: Date.now() }));
    // A fresh session may need to take over the Pomodoro notification if the
    // previous owner is gone (hibernation, crash, or an older state).
    await ensurePomodoroDuty(this.ctx, clientId || null, browserId || null);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Clients only ever send "ping", which the auto-response handles.
  override webSocketMessage() {}

  override async webSocketClose(ws: WebSocket, code: number) {
    let clientId: string | null = null;
    let browserId: string | null = null;
    for (const tag of this.ctx.getTags(ws)) {
      if (tag.startsWith("client:")) clientId = tag.slice("client:".length);
      else if (tag.startsWith("browser:")) browserId = tag.slice("browser:".length);
    }
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      /* already closed */
    }
    if (clientId) {
      await relayPomodoroDuty(this.ctx, { clientId, browserId }, ws);
    }
  }
}
