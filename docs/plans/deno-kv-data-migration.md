# Plan: move the data from Deno KV to Cloudflare

Status: pending · Created 2026-11-11

## Where things stand

- Hawk runs on Cloudflare (PR #9): Worker `hawk` → one Durable Object that stores data in SQLite behind a Deno.Kv-style layer (`server/utils/sqliteKv.ts`). The key layout is the same as on Deno KV, so data moves over key for key.
- Prod on Cloudflare started with an **empty** database. Everything written before the switch is still in Deno KV on Deno Deploy (org `pnettto`, app `hawk`).
- Deno Deploy blocked the app after it went over the free-tier KV read quota (the old SSE handler polled KV every 750 ms per open tab). The export has to wait until the quota resets or reads are allowed again.
- File bodies are already in R2 (`hawk-files`, key `files/<id>`), which the Worker reads through its binding. Only their metadata (`["files", "meta", id]`) needs to move. Files with no `storage: "r2"` still have their bodies in KV chunks; those come along too and can be moved to R2 afterwards.

## Tools

- `scripts/kv-to-cloudflare.ts`
  - `dump <kv-url-or-path> <out.json>` lists every entry with `Deno.openKv` and writes it to a file. It skips the old sync queue, rate-limit counters and `Deno.KvU64` values.
  - `load <in.json> <worker-url>` logs in with `HAWK_PASSWORD` and posts the entries in batches to `POST /api/admin/import`.
  - Both print counts per key family (`notes/note`, `notes/meta`, `logs/<date>`, …) to compare.
- `GET /api/admin/export?cursor=&limit=` on the Worker dumps the Cloudflare side in the same format (for a backup before importing).

The dump contains every note, private ones included, and the repo is public. Keep it outside the repo (`kv-export*.json` is git-ignored only as a safety net) and never commit it.

## Steps

### 1. Get read access to Deno KV
Check that the app or database is usable again in console.deno.com (quota reset or plan change).

### 2. Dump Deno KV
Pick whichever works:

- **A. Remote connection (preferred, no deploy).** If the console offers a KV Connect URL for the `Zbc218-production` database (instance attached to Production, named `backup`), with an access token:
  ```sh
  DENO_KV_ACCESS_TOKEN=… deno run -A --unstable-kv scripts/kv-to-cloudflare.ts dump "<kv-connect-url>" ~/hawk-backup/kv-export.json
  ```
- **B. Temporary export route on Deno Deploy.** If there's no remote access:
  1. Check out the last Deno commit (`0de6728`, before PR #9) on a throwaway branch.
  2. Add an auth'd `GET /api/export` that lists every entry (`kv.list({ prefix: [] })`) and returns it in the wire format from `server/routeHandlers/admin.ts` (paginate with a cursor if it's large).
  3. Deploy it manually with `deno deploy --org pnettto --app hawk --prod` (CI no longer deploys to Deno). Confirm with the owner first.
  4. Download the export to `~/hawk-backup/kv-export.json`, then remove the route and redeploy (or just retire the app, step 6).

Note the per-family counts the dump prints.

### 3. Back up the Cloudflare side
Anything created on Cloudflare since the switch should be saved before importing:
```sh
curl -H "Authorization: Bearer <token>" "https://hawk.pnetto.store/api/admin/export?limit=2000" > ~/hawk-backup/cf-before-import.json
```
(Follow `cursor` if it's not null.)

### 4. Import
```sh
HAWK_PASSWORD=… deno run -A scripts/kv-to-cloudflare.ts load ~/hawk-backup/kv-export.json https://hawk.pnetto.store
```
Import **merges**: keys only on Cloudflare are kept; keys in both are overwritten by the Deno value. Where they can collide:
- the day note for a date that has notes on both sides (fixed id `day-<date>`), and its version history;
- the day log `["logs", date]` for dates edited on both sides;
- `["preferences"]` (theme etc.);
- `["notes", "schema"]` (both are 2, harmless).

If something written on Cloudflare got overwritten, copy it back from the step 3 backup by hand.

### 5. Verify
- Counts: compare the dump's per-family table with the import's (they print the same table) and with the app: notes list, trash, day logs in the calendar, Files.
- Spot-check: a few notes with version history, a recent and an old day, a public note's `/shared/<id>` page, an image embedded in a note, a file download.
- Legacy KV-chunked files: `POST /api/files/migrate` (repeat until `remaining` is 0) moves their bodies to R2.
- Open the app in two tabs and the extension; edits sync live.

### 6. Retire Deno Deploy (confirm with the owner)
- Keep the export file somewhere safe as a backup.
- Stop/delete the Deno Deploy app `hawk` and its KV database.
- Delete the `DENO_DEPLOY_TOKEN` GitHub secret.
- Remove the Deno section from `CLAUDE.local.md`.
- Optional: old share links on `hawk.pnettto.deno.net/shared/<id>` stop working; a tiny redirect stub could be left on Deno Deploy if any were shared publicly.
