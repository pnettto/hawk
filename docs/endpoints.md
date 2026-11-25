# Hawk API — Endpoint Reference

## Conventions

| Item | Value |
| --- | --- |
| Base URL | `https://<host>` |
| Format | JSON request and response bodies unless noted |
| Authentication | `Authorization: Bearer <token>` (token from `POST /api/login`) |
| Error body | `{ "error": "<message>" }` |
| Dates | `YYYY-MM-DD` |
| Timestamps | ISO 8601 strings on the read API (`/api/notes`, `/api/notes/:id`, `/api/tasks`, `/api/reports/:date`); Unix milliseconds everywhere else |

### Token scopes

| Scope | Obtained with | Permitted calls |
| --- | --- | --- |
| `full` | `POST /api/login` with `scope` omitted or `"full"` | All endpoints |
| `read` | `POST /api/login` with `"scope": "read"` | `GET`/`HEAD` on `/api/notes`, `/api/notes/:id`, `/api/tasks`, `/api/reports/:date`, `/api/search`; all others return 403 |

Tokens do not expire.

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Success |
| 400 | Invalid parameter or body |
| 401 | Missing or invalid token; wrong password |
| 403 | Read-only token used on a non-permitted endpoint |
| 404 | Resource or `/api` route not found |
| 409 | Revision conflict (body contains the current server state) |
| 410 | Endpoint retired |
| 411 | `Content-Length` missing (file upload) |
| 413 | Payload too large (notes and days: 63 KiB; files: 100 MB) |
| 429 | Rate limited |
| 503 | File storage not configured |

---

## 1. Authentication

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/login` | None | Body: `{ password: string, scope?: "full" \| "read" }` | `{ success: true, token: string, scope?: "read" }` |
| GET | `/api/auth-check` | None | — | `{ authenticated: boolean }` |
| GET | `/api/logout` | None | — | `{ success: true }` (clears browser cookie) |
| POST | `/api/verify-password` | Full | Body: `{ password: string }` | `{ ok: boolean }` |

---

## 2. Read API (agent integration)

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/notes` | Read or full | Query (all optional): `type` = `notepad` \| `note` \| `journal`; `date` = `YYYY-MM-DD`; `q` = search query; `limit` = 1–200, default 50 | `{ items: NoteListItem[], truncated: boolean }`, newest `updatedAt` first, trashed notes excluded |
| GET | `/api/notes/:id` | Read or full | Path: `id` | `Note`; 404 `{ error: "Note not found" }` |
| GET | `/api/tasks` | Read or full | Query: `date` (required) | `{ date: string, url: string, tasks: Task[] }`; empty day returns `tasks: []` |
| GET | `/api/reports/:date` | Read or full | Path: `date`; Query: `user` (optional) | `Note & { alternatives: string[] }`; 404 `{ error: "Report not found", trashed?: true }` |
| GET | `/api/search` | Read or full | Query: `q` (required); `kind` = `all` \| `notes` \| `tasks`, default `all`; `limit` = 1–100, default 30 | `{ notes: NoteHit[], tasks: TaskHit[], truncated: boolean }` |

### `Note`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Note identifier |
| `title` | string | Title |
| `type` | `"notepad"` \| `"journal"` | `journal` if the note belongs to a Journal day |
| `date` | string \| null | Journal day; `null` for notepad notes |
| `source` | string \| null | Creating client (`"web"`, `"pi"`, …); `null` for notes created before the field existed |
| `author` | string \| null | Same value as `source` |
| `createdAt` | string | ISO 8601 |
| `updatedAt` | string | ISO 8601 |
| `url` | string | Link to the note in the web app |
| `tags` | string[] | Tags parsed from `#words` in the content |
| `hidden` | boolean | Privacy flag in the web UI; content is still returned |
| `trashedAt` | string \| null | ISO 8601 when in the trash |
| `content` | string | Full Markdown |

### `NoteListItem`

`Note` without `content`, plus:

| Field | Type | Description |
| --- | --- | --- |
| `preview` | string | Plain-text excerpt (≤140 chars). Omitted for hidden notes |

### `Task`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Task identifier |
| `text` | string | Task text |
| `status` | `"open"` \| `"done"` | Completion state |
| `time` | string \| null | `HH:MM` (24h) |
| `comment` | string \| null | Free-text comment |
| `parentId` | string \| null | Parent task id for subtasks |
| `order` | number | Manual sort key |
| `updatedAt` | string \| null | ISO 8601 |

Tasks are returned in display order: timed tasks by time, then untimed tasks by `order`.

### Search query syntax (`q`)

| Syntax | Meaning |
| --- | --- |
| `word word` | All terms must match (AND); case- and accent-insensitive |
| `"exact phrase"` | Phrase must match as written |
| `#tag` | Item must carry the tag |

### Report matching (`/api/reports/:date`)

| Rule | Detail |
| --- | --- |
| Candidate ids | `pi-report-<user>-<date>`, `pi-report-<date>`, `pi-report-<user>-<date>-replacement-<uuid>` |
| Candidate notes | Not trashed, `date` equal to the requested date |
| Selection | Newest `updatedAt`; remaining candidate ids listed in `alternatives` |
| `user` filter | Restricts candidates to that user's ids |

---

## 3. Notes (write and internal)

Timestamps in this section are Unix milliseconds.

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/notes/notes` | Full | Body: see *Save note body* | `{ success: true, rev: number, updatedAt: number }`; 409 `{ note }` on revision conflict; 413 if too large |
| GET | `/api/notes/notes/:nid` | Full | Path: `nid` | Stored note (raw) |
| DELETE | `/api/notes/notes/:nid` | Full | Path: `nid` | `{ success: true }` (permanent) |
| POST | `/api/notes/notes/:nid/trash` | Full | Path: `nid` | `{ success: true }` |
| POST | `/api/notes/notes/:nid/restore` | Full | Path: `nid` | `{ success: true }` |
| DELETE | `/api/notes/trash` | Full | — | `{ success: true, count: number }` |
| GET | `/api/notes/index` | Full | — | Metadata for every note, trash included |
| GET | `/api/notes/days` | Full | Query: `start`, `end` (required) | Full journal notes with `day` in range |
| GET | `/api/notes/notes/:nid/versions` | Full | Path: `nid` | `[{ savedAt: number, preview: string }]` |
| GET | `/api/notes/notes/:nid/versions/:savedAt` | Full | Path: `nid`, `savedAt` | `{ savedAt, content: { title, content } }` |
| POST | `/api/notes/notes/:nid/versions/:savedAt/restore` | Full | Path: `nid`, `savedAt` | `{ success: true, note }` |

### Save note body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Note id; a new id creates the note (UUID recommended) |
| `title` | string | No | Omitted: keeps stored value |
| `content` | string | No | Markdown. Omitted: keeps stored value |
| `day` | string | No | `YYYY-MM-DD`. Makes it a journal note. Read on create only |
| `dayOrder` | number | No | Order among the day's notes |
| `source` | string | No | Creating client, `^[a-z0-9-]{1,32}$`. Read on create only |
| `createdAt` | number | No | Read on create only |
| `isPublic` | boolean | No | Public share flag |
| `hidden` | boolean | No | Hidden flag |
| `baseRev` | number | No | Revision the edit is based on; mismatch returns 409 |
| `snapshot` | boolean | No | `true` records a version-history entry |

---

## 4. Journal days and tasks

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/day` | Full | Query: `date` | `{ tasks: Task[] }` (internal shape: `done: boolean`, ms timestamps) |
| GET | `/api/range` | Full | Query: `start`, `end` | `{ "<date>": { tasks: Task[] } }` |
| POST | `/api/day/tasks` | Full | Query: `date`, `snapshot?=true`; Body: `{ upsert?: Task[], remove?: string[] }` | `{ tasks: Task[] }` |
| POST | `/api/day/tasks/move` | Full | Body: `{ from: date, to: date, ids: string[], orders?: { [id]: number } }` | `{ from: { tasks }, to: { tasks }, moved: string[] }` |
| POST | `/api/day` | Full | Query: `date`; Body: full day JSON | Text `Day log saved` (legacy) |
| GET | `/api/day/versions` | Full | Query: `date`, `section=tasks` | `[{ savedAt, preview }]` |
| GET | `/api/day/versions/one` | Full | Query: `date`, `section=tasks`, `savedAt` | `{ savedAt, content: { tasks } }` |
| POST | `/api/day/versions/restore` | Full | Query: `date`, `section=tasks`, `savedAt` | `{ success: true, tasks }` |
| POST | `/api/day/notes` | — | — | 410 `{ error: "Day notes moved to /api/notes/notes" }` |
| DELETE | `/api/day/notes` | — | — | 410 (as above) |

### Internal task (write) shape

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Task id (UUID recommended) |
| `text` | string | No | Task text |
| `done` | boolean | No | Completion state |
| `time` | string | No | `HH:MM` |
| `comment` | string | No | Comment |
| `parentId` | string | No | Parent task id |
| `order` | number | No | Sort key; defaults to current time |

---

## 5. Files

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/files` | Full | — | `FileMeta[]` |
| POST | `/api/files` | Full | Raw body; Headers: `Content-Length` (required), `Content-Type`, `X-File-Name`; Query: `inline?=1` | `FileMeta` |
| GET | `/api/files/:id` | Full | Query: `download?=1`; Header: `Range` (optional) | File bytes |
| POST | `/api/files/:id` | Full | Body: `{ name: string }` | `FileMeta` |
| POST | `/api/files/:id/public` | Full | Body: `{ isPublic: boolean }` | `FileMeta` |
| DELETE | `/api/files/:id` | Full | — | `{ success: true }` |
| POST | `/api/files/delete` | Full | Body: `{ ids: string[] }` | `{ deleted }` |
| POST | `/api/files/migrate` | Full | Query: `limit` (1–50, default 10) | `{ migrated, failed, remaining }` |

`FileMeta`: `{ id, name, type, size, createdAt, inline?, isPublic? }`.

---

## 6. Public (no authentication)

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/public/notes/:nid` | Path: `nid` | Stored note if public; otherwise 401/404 |
| GET | `/api/public/files/:id` | Path: `id`; Query: `download?=1` | File bytes if public |
| GET | `/api/public/collections/:cid` | Path: `cid` | Legacy |
| GET | `/shared/:nid` | Path: `nid` | HTML page of a public note |
| GET | `/shared/collection/:cid` | Path: `cid` | Legacy HTML page |

---

## 7. Settings and app state

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/preferences` | Full | — | Preferences object |
| POST | `/api/preferences` | Full | Body: partial preferences object (merged) | Updated preferences |
| GET | `/api/pomodoro` | Full | — | Timer state (web app internal) |
| POST | `/api/pomodoro` | Full | Body: `{ state, rev?, claim? }` | Timer state; 409 on conflict |

---

## 8. Administration

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/export` | Full | Query: `limit` (1–2000, default 500), `cursor` | `{ entries: [], cursor: string \| null }` |
| POST | `/api/admin/import` | Full | Body: `{ entries: [] }` | `{ imported: number }` |
