# Hawk → public product: rollout, sustainability, and exit plan

## Context

Hawk today is a single-user note-taking + day-log app: Svelte 5 SPA + Hono on Deno Deploy + Deno KV, also packaged as a Chrome new-tab extension. One developer, one shared `API_KEY`, one global KV namespace.

Goal: ship to the Chrome Web Store as a public product with a **free local-only tier** (no account, data stays in the browser) and a **paid cloud tier** (multi-device sync via the existing backend). Roll it out in waves so it stays manageable for one person, with a clean exit path if it doesn't work out.

## Strategic decisions (locked in this session)

- **Billing**: Stripe direct + Stripe Tax. Lower fees, you handle VAT/sales-tax registration as thresholds are crossed. Start with home-country registration only; monitor thresholds in Stripe dashboard.
- **Free tier**: pure local — no account, no backend contact. The Free→Paid handoff creates the account at upgrade time. This eliminates the "free users sitting in our KV" problem entirely and sharply reduces GDPR exposure.
- **Pace**: patient. Ship Wave 1 (free local) first, validate, then build Waves 2–3.
- **Auth (paid tier)**: magic-link via Resend. Passwordless = no password-reset support tickets, no credential-stuffing surface.
- **Local storage**: Dexie over IndexedDB. Mature, Svelte-friendly via `liveQuery`, large quota.
- **Multi-tenancy**: uniform `["u", userId, ...existingKey]` KV prefix; one shared key-builder module.
- **Public sharing**: secondary global index `["public", "note", nid] → { userId, cid }` written on publish so `/shared/:nid` keeps working.

## Wave 0 — Chrome Web Store readiness (1–3 days)

Blockers that prevent listing today, in order:

1. **Remove the Typekit remote stylesheet** (`app/dist/index.html:10`, sourced from `app/index.html`). MV3 auto-rejects extensions that load remote CSS/JS. Vendor the font locally or switch to a system stack.
2. **Add raster icons.** Export `app/public/logo.svg` to PNG at 16/48/128/256. Wire into `app/public/manifest.json` under `"icons": { ... }`.
3. **Manifest hygiene.** Bump `name` ("Hawk — minimal new tab"), polish `description`, set a real `version_name` policy (semantic versioning starting `0.1.0` for the public launch), and double-check `host_permissions` is the minimum set (today: `https://hawk.pnettto.deno.net/*` — for Wave 1 this can be empty since local-only never calls the backend).
4. **Store listing assets.** 3–5 screenshots at 1280×800, a 440×280 small promo tile, ~250-char short description, ~2000-char detailed description. Single-purpose declaration: "minimal new-tab page for daily notes and an hourly log."
5. **Privacy practices declaration in CWS dashboard.** For Wave 1 this is "does not collect user data" — true, since local-only. Saves a lot of review friction.
6. **$5 one-time CWS developer registration.**

Verification: load the unpacked extension in Chrome (`chrome://extensions` → Load unpacked → `app/dist`), open a new tab, confirm no network requests fire, confirm icons render in the toolbar and extensions list.

## Wave 1 — Free local-only public release (1–2 weeks)

Ship the extension to the CWS as local-only. The backend stays exactly as-is (your private deployment, your data). The public product simply doesn't talk to it.

**Build** (technical):

1. **Lift `server/utils/versioning.ts` into `app/src/lib/versioning.ts`** — pure logic, no Deno imports. Both backend and local adapter import from here. *Critical:* don't fork the algorithm.
2. **Storage adapter layer** in `app/src/storage/`:
   - `index.ts` exports `getStorage(): StorageAdapter` based on `localStorage.hawk_mode` (default `"local"` for the extension build).
   - `cloudAdapter.ts` — wraps `app/src/api/{notes,logs,preferences}.ts` 1:1 (current behavior).
   - `localAdapter.ts` — Dexie tables mirroring the KV key shapes; emits synthetic `SyncEvent`s via `BroadcastChannel('hawk-sync')` for cross-tab reactivity.
3. **Refactor stores** (`app/src/stores/notes.ts`, `logs.ts`, `preferences.ts`) to call `getStorage()` instead of importing API modules directly. Their `applySyncEvent` paths stay untouched.
4. **Hide cloud-only UI** in local mode: public sharing toggle, account/billing pages, "sync indicator". A single derived `cloudFeatures` boolean gates them.
5. **Local-mode onboarding**: replace login screen with a one-screen "welcome → start writing" flow. No account prompt.
6. **Build profile** for the extension: `vite build --mode extension` writes a `localStorage.hawk_mode = "local"` bootstrap into `index.html` so first-load is local without a flicker.

**Legal/business** (do once, before listing):

- **Privacy policy** — required by CWS even for local-only. Cover: "no data collected, no analytics, no third-party services, all data stored locally in your browser." Use [Termly](https://termly.io) or write from scratch (~300 words).
- **Terms of use** — limitation of liability, no warranty, governing law (your jurisdiction). Termly templates work.
- **Hosting page** — publish privacy + ToS at a stable URL. Cheapest option: a single static page on `hawk.pnettto.deno.net/legal` served by the existing Hono app.
- **Business entity** — for a solo dev, a single-member LLC (US) or equivalent in your jurisdiction provides liability shielding. Not blocking Wave 1 (local-only is low-liability) but do it before Wave 3.

Verification: install the published unlisted extension, write notes, close browser, reopen — data persists. Open in two tabs, edit one, see the other update via BroadcastChannel.

## Wave 2 — Multi-tenant backend, internal only (2–4 weeks)

Refactor your existing single-tenant backend to be userId-scoped, but don't expose signup yet. Migrate your own data. Verify the live SPA still works against the new shape.

**Build:**

1. **`server/utils/userKeys.ts`** — single module with `keys.note(uid, nid)`, `keys.collection(uid, cid)`, `keys.dayLog(uid, dateStr)`, `keys.preferences(uid)`, `keys.syncTail(uid)`, `keys.syncQueue(uid, n)`, `keys.versionIndex(uid, kind, id)`, etc. Every existing inline KV array gets replaced by a call to this module.
2. **JWT auth** — replace `server/middleware/auth.ts` to verify HS256 JWT (`{ sub: userId, plan, iat, exp }`) from `JWT_SECRET` env. Set `c.set('user', { id, plan })`. SSE `verifyToken` becomes async.
3. **Refactor handlers** (`server/routeHandlers/notes.ts`, `app.ts`, `preferences.ts`, `sync.ts`, plus `server/utils/syncEvents.ts` and `server/utils/versioning.ts`): take `userId` from `c.get('user').id`, use `keys.*` everywhere. Mechanical, large diff, no behavior change.
4. **Per-user sync** — tail counter, queue, SSE stream all scoped by userId.
5. **Per-user rate limiting** — extend `server/middleware/rateLimit.ts` with a `keyFn(c)`. Authenticated routes key by userId; `/api/auth/*` and `/api/public/*` stay IP-keyed.
6. **Public-share secondary index** — `["public", "note", nid] → { userId, cid }` written in `saveNote` when `isPublic` flips on; deleted on flip-off / hard delete. `getPublicNote`, `getSharedNotePage`, `getPublicCollection` resolve via this index first.
7. **Quota tracking** — `["u", userId, "usage"] → { notes, bytes, days }` updated on every write; cap enforced at e.g. 10k notes / 100MB / 5y of day-logs.
8. **Migration script** `scripts/migrate_to_userid.ts` — `kv.list({ prefix: [] })`, rewrite under `["u", YOUR_UID, ...]`, batched ≤10 ops/txn, resumable via `["migration", "cursor"]`, mandatory `--dry-run` flag. Run under a `["maintenance"]` flag the middleware checks to block writes.
9. **Bulk export endpoint** `GET /api/me/export` returns a single zipped JSON of everything under your userId. Required for GDPR and as the foundation for the exit strategy.

**Verification**: dry-run migration, diff output. Run live migration off-hours. Hit your existing SPA and confirm everything still works (you are now "user 1"). Run `vitest` contract tests against both adapters using `fake-indexeddb` (local) and Deno KV in-memory (cloud) to verify the storage adapter API matches the backend.

## Wave 3 — Paid cloud tier launches (3–6 weeks)

Now expose signup and billing. Behind a waitlist for the first 2–4 weeks, then open.

**Build:**

1. **Magic-link auth**:
   - `POST /api/auth/request-link` — write `["magic", token] → { email, exp }` (15-min TTL via Deno KV `expireIn`); send via Resend (~$0/mo for low volume).
   - `GET /api/auth/verify?token=...` — atomically delete magic key, upsert `["users", userId]` and `["users_by_email", lower(email)] → userId`, mint 24h JWT, set cookie.
   - Short JWT TTL + silent refresh endpoint avoids cached `plan` claim lag.
2. **Stripe integration**:
   - Stripe Checkout (hosted, no PCI burden) for subscribe.
   - Stripe Customer Portal (hosted) for cancel / update payment / view invoices.
   - **Webhook** `POST /api/billing/webhook` — verify signature, handle `customer.subscription.{created,updated,deleted}`, write `["u", userId, "subscription"] → { stripeId, status, currentPeriodEnd }` and update `["users", userId].plan`. Always check `event.created` against stored `updatedAt` to ignore replays/out-of-order.
   - **Stripe Tax** turned on. Configure tax registration for your home country only on day 1; add others as thresholds approach (Stripe alerts on this).
3. **Free→Paid migration** — `app/src/storage/migrate.ts`:
   - `pushLocalToCloud()` after first paid login: collections → note metadata → note bodies → version indexes/entries → day logs → day-log versions → preferences. Last-writer-wins by `updatedAt`.
   - `pullCloudToLocal()` on cancel: same order, reverse direction. Run with 30-day grace after subscription end before flipping `hawk_mode` back to `"local"`.
4. **Pricing**: $5/mo or $48/yr (20% annual discount). One tier. Resist tiering — solo dev cannot maintain feature matrices.
5. **Account UI** in the SPA: `/account` page with email, plan, manage-billing button (Stripe portal redirect), export-my-data button, delete-my-account button (hard delete: list `["u", userId, ...]` and remove all + remove from `users` and `users_by_email` + cancel Stripe sub).
6. **Status page** — [BetterStack](https://betterstack.com) free tier or just a static page reading from a KV health key. Required as expectations management — when something breaks, users check status before emailing you.
7. **Updated privacy policy + ToS** — now you process personal data. Cover: subprocessors (Deno Deploy, Stripe, Resend), data retention, deletion rights (GDPR/CCPA), 90-day breach notification, governing law. Single-page DPA template from Termly is fine for a solo dev.
8. **CWS privacy practices declaration** — update from "no data collected" to disclose authentication info + user content for paid users.

**Verification**:
- Stripe test mode end-to-end: free → upgrade → cloud sync from a second device → cancel → 30-day grace → auto-revert to local.
- Webhook signature failure path returns 400 and doesn't update plan.
- Delete-account fully removes data (verify with `kv.list` for that userId returns empty).
- Magic-link expired token returns clear error, doesn't auth.
- Rate limiter: hammer login from one IP, see correct lockout.

## Wave 4 — Sustainability & growth (ongoing)

Things to add only after Wave 3 is stable for 2–4 weeks:

- **Uptime monitoring** — UptimeRobot free tier hitting `/api/health`.
- **Error tracking** — Sentry free tier or just structured logs to Deno Deploy observability. Don't over-instrument.
- **Daily KV backup** — scheduled task that exports all `["u", *, ...]` to a versioned object in S3/R2/Backblaze. Deno KV on Deploy doesn't have user-facing backups; this is your safety net.
- **In-app help / FAQ** — single Markdown page bundled with the SPA. Reduces support email drastically.
- **Email-only support** with documented response window (e.g. "we aim to respond within 3 business days"). Don't promise SLAs.
- **Annual sub renewal reminders** — 7 days before charge, automated via Stripe email or Resend cron.
- **Analytics**: stay analytics-free at first. If/when needed, [Plausible](https://plausible.io) (cookieless, GDPR-friendly) on the marketing page only — never in the extension.

## Solo-dev sustainability checklist

These are the "mitigate developer issues" pieces that aren't in any wave but cut across all of them:

- **Form an LLC / equivalent before Wave 3.** Liability shield. ~$50–500 depending on jurisdiction. Open a separate business bank account; do not commingle.
- **Stripe Tax + register only where required.** Track thresholds: EU OSS at €10k cross-border, UK at £85k, Australia at A$75k, US per-state nexus rules. Stripe Tax dashboard alerts you. Do not pre-register everywhere — that's months of paperwork for revenue you don't have yet.
- **Liability cap in ToS.** Standard "limited to fees paid in the last 12 months" clause. Critical.
- **Subprocessor list** in your privacy policy: Deno Deploy (hosting + KV), Stripe (payments), Resend (transactional email). Update when you add more.
- **No SLAs in writing.** "Best effort" only. SLAs you can't realistically meet are a legal liability.
- **Refund policy** — narrow but humane: "refund within 14 days of charge if you haven't actively used the service that period." Posted on the site.
- **Single support channel.** One email address (`support@…`). Forward to your inbox. Don't create Discord/Slack/forum communities you can't moderate solo.
- **One pricing tier.** Two tiers means twice the support matrix. Stay disciplined.
- **No promises about new features in marketing copy.** Markets what works *today*.
- **Capture-everything operational journal** — a single Markdown file in this repo (e.g. `OPS.md`) where you log incidents, KV migrations, deploys, billing edge cases. Future-you needs it.

## Exit strategy

The whole architecture is designed so this is *clean*, not catastrophic.

The local-only mode IS the exit ramp: if cloud goes away, the extension still works as a local notes app forever. That's the structural exit.

When/if you decide to sunset the cloud tier:

1. **90-day notice** by email and in-app banner. Stop new paid signups immediately.
2. **Stop charging.** Cancel all active Stripe subscriptions; refund the prorated remainder of any annual subs (Stripe portal makes this one-click per customer).
3. **Force-run `pullCloudToLocal` for every active user** on next login — their Dexie store fills, then their cloud data is queued for deletion.
4. **Self-serve full export** stays available the whole 90 days (`/api/me/export`).
5. **Open-source the backend** under MIT after sunset, with a `SELFHOST.md` for users who want to run their own. You have nothing competitive to lose at that point.
6. **Day 91**: shut down Deno Deploy app, delete the KV instance, decommission domain (or redirect to a landing page explaining what happened and where the open-source repo lives).
7. **Keep the Chrome Web Store listing live** in local-only mode indefinitely — costs you nothing and serves users who are still on it.

Reasoning to keep in mind: the *existence* of this exit plan, documented up front, is what lets you ship without anxiety. Users who care will check; the rest still benefit from the structural guarantee.

## Critical files

Will be touched across waves:

- `app/public/manifest.json` — Wave 0 (icons, name)
- `app/index.html` / `app/dist/index.html` — Wave 0 (vendor Typekit locally)
- `app/src/main.ts` — Wave 1 (mode selection at boot)
- `app/src/storage/{index,localAdapter,cloudAdapter,migrate}.ts` — Wave 1 (new) + Wave 3 (migrate)
- `app/src/lib/versioning.ts` — Wave 1 (lifted from server)
- `app/src/stores/{notes,logs,preferences}.ts` — Wave 1 (call getStorage)
- `app/src/api/client.ts` — Wave 3 (JWT, magic-link request)
- `server/utils/userKeys.ts` — Wave 2 (new, single source of key truth)
- `server/middleware/auth.ts` — Wave 2 (JWT) + Wave 3 (magic-link issuance)
- `server/middleware/rateLimit.ts` — Wave 2 (per-user keyFn)
- `server/routeHandlers/notes.ts`, `app.ts`, `preferences.ts`, `sync.ts` — Wave 2 (userId scoping)
- `server/utils/syncEvents.ts`, `server/utils/versioning.ts` — Wave 2 (per-user)
- `server/routeHandlers/auth.ts` — Wave 3 (replace login with magic-link)
- `server/routeHandlers/billing.ts` — Wave 3 (new — Stripe webhook)
- `scripts/migrate_to_userid.ts` — Wave 2 (one-shot, dry-run mandatory)

## Reuse opportunities

- `server/utils/versioning.ts` algorithm → must be lifted, not re-implemented for the local adapter.
- `applySyncEvent` paths in stores → unchanged by the adapter refactor; just be sure local adapter emits the same event shapes.
- `app/src/api/client.ts` API base resolution → keep as-is; only the auth header swaps from `Bearer <api-key>` to `Bearer <jwt>` in Wave 3.
- Hono middleware stack → keep order (CORS → rate-limit → auth); just swap implementations.

## Verification per wave

- **Wave 0**: manual `chrome://extensions` load, watch DevTools network tab during new-tab open — should be zero requests in local mode.
- **Wave 1**: `vitest` contract tests both adapters against `fake-indexeddb`; manual two-tab test for BroadcastChannel; install unlisted CWS build, leave for a week, confirm no data loss.
- **Wave 2**: dry-run migration diff; live migration off-hours under maintenance flag; full SPA smoke test as user 1; quota cap test (write past limit, expect 413); SSE test confirms only your events arrive when a synthetic user 2 writes.
- **Wave 3**: Stripe test-mode end-to-end (subscribe → sync from second device → cancel → grace expires → revert); webhook replay test; magic-link expiry test; account-deletion KV verification; rate-limit test on `/api/auth/request-link`.
- **Wave 4**: monthly: review Stripe Tax thresholds, review error-tracking signal, run a backup-restore drill against a scratch KV instance.
