# Read API

Read-only endpoints for agents such as the Pi `hawk` tool. Handlers live in `server/routeHandlers/readApi.ts`; resource shapes in `server/utils/readModel.ts`.

## Auth

Same login as writes.

```http
POST /api/login
Content-Type: application/json

{ "password": "<Hawk password>", "scope": "read" }
```

```json
{ "success": true, "token": "<64 hex chars>", "scope": "read" }
```

Then send `Authorization: Bearer <token>` on every request.

| `scope` | Token can |
| --- | --- |
| omitted or `"full"` | Everything, the same as the web app. Login also sets the `hawk_token` cookie. |
| `"read"` | Only `GET`/`HEAD` on `/api/notes`, `/api/notes/:id`, `/api/tasks`, `/api/reports/:date` and `/api/search`. Every other call answers `403 { "error": "Read-only token" }`. No cookie is set, and it can't open the sync WebSocket. |

Both tokens are SHA-256 hex strings derived from the server's `API_KEY`. They don't expire; changing `API_KEY` revokes both. A full token works on the read endpoints too.

## Errors

JSON `{ "error": "<message>" }`, never HTML.

| Status | When |
| --- | --- |
| 400 | Bad parameter: malformed date, unknown `type`, `limit` outside 1–200 |
| 401 | Missing or wrong token |
| 403 | Read-only token on a route it can't use |
| 404 | The item doesn't exist, or the `/api` route is unknown (once authenticated) |
| 429 | Rate limited |

Without a valid token every `/api/*` path answers 401, including unknown routes.

## Note resource

```jsonc
{
  "id": "dbcd2f8e-…",                 // the id in its link, /notes/<id>
  "title": "…",
  "type": "notepad" | "journal",      // journal = belongs to a Journal day
  "date": "2026-11-20" | null,        // the Journal day; null for notepad notes
  "source": "pi" | "web" | null,      // where it was created; null for older notes
  "author": "pi" | "web" | null,      // same value as source
  "createdAt": "2026-11-20T09:12:03.000Z",
  "updatedAt": "2026-11-20T10:01:44.000Z",
  "url": "https://<host>/notes/dbcd2f8e-…",
  "tags": ["work"],
  "hidden": false,
  "trashedAt": null,                  // ISO string when in the trash
  "content": "# Full Markdown…"
}
```

`source` is set when the note is created (`POST /api/notes/notes` with `"source": "pi"`, matching `^[a-z0-9-]{1,32}$`) and never changes after that. Reports are journal notes.

## `GET /api/notes/:id`

One note resource, or `404 { "error": "Note not found" }`. A trashed note is still returned, with `trashedAt` set.

## `GET /api/notes?type=&date=&q=&limit=`

Every filter is optional. Trashed notes are left out.

| Param | Meaning |
| --- | --- |
| `type` | `notepad` (alias `note`) or `journal` |
| `date` | `YYYY-MM-DD`; only journal notes on that day |
| `q` | Same syntax as ⌘K search: AND terms, `"phrases"`, `#tag` |
| `limit` | Default 50, max 200 |

```jsonc
{
  "items": [ /* note resource without content, plus "preview" (omitted for hidden notes) */ ],
  "truncated": false   // true when there may be more than `limit`
}
```

Newest `updatedAt` first.

## `GET /api/tasks?date=YYYY-MM-DD`

`date` is required. The server runs in UTC, so it doesn't guess "today".

```jsonc
{
  "date": "2026-11-20",
  "url": "https://<host>/journal/2026-11-20",
  "tasks": [
    {
      "id": "…",
      "text": "Review the PR",
      "status": "open" | "done",
      "time": "09:30" | null,
      "comment": "…" | null,
      "parentId": "…" | null,         // set on subtasks
      "order": 1763600000000,
      "updatedAt": "…" | null
    }
  ]
}
```

Tasks come in Journal order. A day with nothing on it returns `tasks: []`, not 404.

## `GET /api/reports/:date?user=`

The active Pi report for the day: a note resource plus `alternatives`.

- Matches untrashed notes with `day === date` whose id is `pi-report-<user>-<date>`, the old `pi-report-<date>`, or `pi-report-<user>-<date>-replacement-<uuid>`.
- The newest `updatedAt` wins; the other matching ids go in `alternatives`.
- `?user=<name>` keeps only that user's ids.
- No match: `404 { "error": "Report not found" }`, with `"trashed": true` added when only trashed reports matched.

## Example

```sh
TOKEN=$(curl -s https://<host>/api/login -H 'Content-Type: application/json' \
  -d '{"password":"…","scope":"read"}' | jq -r .token)
curl -s https://<host>/api/notes?type=journal\&date=2026-11-20 -H "Authorization: Bearer $TOKEN"
```
