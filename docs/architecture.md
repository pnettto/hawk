# Hawk architecture (Cloudflare)

```mermaid
flowchart TB
  client["<b>Browser</b><br/>web app (hawk.pnetto.store)<br/>Chrome extension (new tab)"]
  pub["<b>Shared links</b><br/>/shared/#lt;id#gt; (public)"]

  subgraph Edge["Cloudflare · hawk.pnetto.store · hawk.pedro-535.workers.dev"]
    assets["<b>Static Assets</b><br/>app/dist (Svelte SPA)<br/>SPA fallback → index.html"]
    worker["<b>Worker hawk</b><br/>server/worker.ts<br/>forwards /api/* and /shared/*"]

    subgraph DO["Durable Object HawkDO · single instance 'hawk'"]
      hono["<b>Hono app</b> · server/app.ts<br/>CORS → rate limit → auth<br/>→ route handlers"]
      sockets["<b>Sync WebSockets</b><br/>/api/sync/ws · tagged by clientId<br/>hibernating · ping→pong auto-reply"]
      sqlite[("<b>SQLite</b> via SqliteKv<br/>notes · day logs · versions<br/>file meta · preferences")]
    end

    r2[("<b>R2 hawk-files</b><br/>files/#lt;id#gt;")]
  end

  client -- "page load" --> assets
  client -- "HTTPS /api/*<br/>WebSocket /api/sync/ws" --> worker
  pub -- "HTTPS /shared/*" --> worker
  worker -- "idFromName('hawk')" --> hono
  worker -- "upgrade" --> sockets
  hono -- "get · set · list · atomic" --> sqlite
  hono -- "file bodies<br/>(streamed put, Range get)" --> r2
  hono -- "emitSyncEvent()" --> sockets
  sockets -. "events to other tabs/devices<br/>(not the originating tab)" .-> client
```

## Preview and CI

```mermaid
flowchart LR
  push["push to main"] --> ci["GitHub Actions<br/>deploy.yml<br/>test · build"] -- "wrangler deploy" --> prod["Worker <b>hawk</b><br/>hawk.pnetto.store"]
  pi["/pi on an issue or PR"] --> piwf["GitHub Actions<br/>pi.yml<br/>pi edits · test · PR"] -- "wrangler deploy --env preview" --> prev["Worker <b>hawk-preview</b><br/>hawk-preview.pedro-535.workers.dev"]
  prev --> prevdo[("own HawkDO<br/>(separate data)")]
  prev --> prevr2[("R2 hawk-files-preview")]
  prod --> proddo[("HawkDO 'hawk'")]
  prod --> prodr2[("R2 hawk-files")]
```

## Notes

- **One Worker, one Durable Object.** The Worker only forwards `/api/*` and `/shared/*`; everything else is served by Static Assets without running it. The `hawk` Durable Object owns all data, runs the API and holds the sync sockets. One user means one instance, so state is consistent without extra coordination.
- **Data.** Notes, days, versions, file metadata and preferences live in the Durable Object's SQLite behind a Deno.Kv-style layer (`server/utils/sqliteKv.ts`), keeping the key layout from Deno KV. File bodies are in R2.
- **Sync.** Every mutating handler calls `emitSyncEvent()`, which pushes the event to every open socket except the originating tab's (sockets are tagged with the tab's `clientId`). Missed events aren't replayed.
- **Cost.** Each API call is one Worker request plus one Durable Object request. Idle sockets hibernate, and the runtime answers keepalive pings without waking the object.
