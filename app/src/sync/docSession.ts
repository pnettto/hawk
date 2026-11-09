// One editable text document (a note or a day note) kept in sync with the
// server. Owns everything between the editor and the network:
//
// - Debounced saves (with a max-wait so continuous typing still saves), one
//   request in flight at a time.
// - Revision checks: every save says which server rev it was edited from. A
//   409 means another device saved first — we three-way merge their version
//   with ours and save the result, so neither side's typing is lost.
// - Remote updates (sync events, focus refreshes) go through the same merge
//   and reach the editor as a minimal diff that keeps cursor and scroll put.
//   Stale responses (rev ≤ what we have) are ignored, so a slow GET can never
//   roll the editor back.
// - A localStorage draft of unsaved edits, so a crash, closed tab, or offline
//   spell doesn't lose work; it's merged back in the next time the doc opens.

import { ApiError } from '../api/client'
import { savingStore } from '../stores/saving'
import { showError } from '../stores/toast'
import { merge3 } from './merge'

export interface DocFields {
  title: string
  body: string
}

export type SaveOutcome =
  | { ok: true; rev: number }
  | { ok: false; conflict: { doc: DocFields; rev: number } }

export interface SaveFn {
  (doc: DocFields, baseRev: number, opts: { snapshot: boolean; keepalive: boolean }): Promise<SaveOutcome>
}

// Implemented by the mounted editor.
export interface EditorBridge {
  getBody(): string
  // Apply as a minimal change; must not report back as a local edit.
  setBody(next: string): void
  // False mid-IME composition — changing the doc then breaks the input.
  canApply(): boolean
}

interface Options {
  key: string
  doc: DocFields
  rev: number
  save: SaveFn
  // Called with the latest local doc whenever a save is about to go out and
  // after remote changes are applied — for list previews and tab titles.
  onChange?: (doc: DocFields) => void
  // Called after a successful save.
  onSaved?: (doc: DocFields, rev: number) => void
}

interface Draft {
  base: DocFields
  baseRev: number
  local: DocFields
  ts: number
}

const DEBOUNCE_MS = 600
const MAX_WAIT_MS = 3000
const DRAFT_PREFIX = 'hawk_draft:'
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

const same = (a: DocFields, b: DocFields) => a.title === b.title && a.body === b.body

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key)
    if (!raw) return null
    const d = JSON.parse(raw) as Draft
    if (!d?.base || !d?.local || Date.now() - d.ts > DRAFT_TTL_MS) return null
    return d
  } catch {
    return null
  }
}

export class DocSession {
  readonly key: string
  private base: DocFields
  private baseRev: number
  private title: string
  // Body while no editor is attached (and the seed for the next mount).
  private detachedBody: string
  private editor: EditorBridge | null = null

  private editSeq = 0
  private savedSeq = 0
  private editedSinceSnapshot = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private firstPendingAt = 0
  private inFlight: Promise<void> | null = null
  private pendingRemote: { doc: DocFields; rev: number } | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 2000
  private errorShown = false
  private disposed = false

  constructor(private opts: Options) {
    this.key = opts.key
    this.base = { ...opts.doc }
    this.baseRev = opts.rev
    this.title = opts.doc.title
    this.detachedBody = opts.doc.body
    this.recoverDraft()
  }

  // ---- read side -------------------------------------------------------

  get rev() {
    return this.baseRev
  }

  get hasLocalEdits() {
    return this.editSeq !== this.savedSeq
  }

  local(): DocFields {
    return { title: this.title, body: this.editor ? this.editor.getBody() : this.detachedBody }
  }

  // ---- editor wiring ---------------------------------------------------

  attach(editor: EditorBridge) {
    this.editor = editor
  }

  detach(editor: EditorBridge) {
    if (this.editor !== editor) return
    this.detachedBody = editor.getBody()
    this.editor = null
  }

  // The editor just finished an IME composition — apply anything we held.
  editorIdle() {
    if (this.pendingRemote && !this.inFlight) {
      const p = this.pendingRemote
      this.pendingRemote = null
      this.receiveRemote(p.doc, p.rev)
    }
  }

  // ---- local edits -----------------------------------------------------

  touch() {
    this.editSeq++
    this.editedSinceSnapshot = true
    savingStore.markPending(this.pendingKey)
    this.schedule()
  }

  setTitle(title: string) {
    if (title === this.title) return
    this.title = title
    this.touch()
  }

  private get pendingKey() {
    return `doc:${this.key}`
  }

  private schedule() {
    if (this.disposed) return
    const now = Date.now()
    if (!this.timer) this.firstPendingAt = now
    if (this.timer) clearTimeout(this.timer)
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.firstPendingAt + MAX_WAIT_MS - now))
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, wait)
  }

  // ---- saving ----------------------------------------------------------

  // Save now if there's anything unsaved. `snapshot` additionally asks the
  // server to record a version-history checkpoint (only if something changed
  // since the last one, unless `force`).
  async flush(opts: { snapshot?: boolean; force?: boolean; keepalive?: boolean } = {}): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    while (this.inFlight) await this.inFlight
    const snapshot = !!opts.snapshot && (this.editedSinceSnapshot || !!opts.force)
    if (!this.hasLocalEdits && !snapshot) return
    if (this.disposed && !this.hasLocalEdits) return

    const sent = this.local()
    const seq = this.editSeq
    this.opts.onChange?.(sent)
    if (this.hasLocalEdits) this.writeDraft(sent)

    const run = async () => {
      let outcome: SaveOutcome
      try {
        outcome = await savingStore.track(
          this.opts.save(sent, this.baseRev, { snapshot, keepalive: !!opts.keepalive }),
        )
      } catch (e) {
        this.onSaveError(e)
        return
      }
      this.retryDelay = 2000
      this.errorShown = false
      if (outcome.ok) {
        this.base = sent
        this.baseRev = outcome.rev
        if (snapshot) this.editedSinceSnapshot = false
        if (this.editSeq === seq) {
          this.savedSeq = seq
          this.clearDraft()
          savingStore.clearPending(this.pendingKey)
        }
        this.opts.onSaved?.(sent, outcome.rev)
      } else {
        // Someone else saved first. Fold their version into ours; the merge
        // leaves us with unsaved edits, so loop around and save again.
        this.mergeIn(outcome.conflict.doc, outcome.conflict.rev, true)
      }
    }
    this.inFlight = run().finally(() => {
      this.inFlight = null
    })
    await this.inFlight

    if (this.pendingRemote) {
      const p = this.pendingRemote
      this.pendingRemote = null
      this.receiveRemote(p.doc, p.rev)
    }
    if (this.hasLocalEdits && !this.retryTimer && !this.disposed) this.schedule()
  }

  private onSaveError(e: unknown) {
    const tooLarge = e instanceof ApiError && e.status === 413
    if (!this.errorShown) {
      this.errorShown = true
      showError(
        tooLarge
          ? 'This note is too large to save. Try splitting it up.'
          : 'Couldn’t save — will keep retrying. Your edits are kept on this device.',
      )
    }
    if (tooLarge || (e instanceof ApiError && e.status === 401)) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, this.retryDelay)
    this.retryDelay = Math.min(30_000, this.retryDelay * 2)
  }

  // ---- remote changes ----------------------------------------------------

  // A newer server version is available (sync event, refetch, restore).
  // `force` discards local edits (used by version restore).
  receiveRemote(doc: DocFields, rev: number, opts: { force?: boolean } = {}) {
    if (opts.force) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      this.savedSeq = this.editSeq
      this.clearDraft()
      savingStore.clearPending(this.pendingKey)
      this.base = { ...doc }
      this.baseRev = rev
      this.apply(doc)
      return
    }
    if (rev <= this.baseRev) return
    if (this.inFlight || (this.editor && !this.editor.canApply())) {
      // Base is mid-update (or the user is mid-composition) — revisit after.
      if (!this.pendingRemote || rev > this.pendingRemote.rev) this.pendingRemote = { doc, rev }
      return
    }
    this.mergeIn(doc, rev, false)
    if (this.hasLocalEdits) this.schedule()
  }

  private mergeIn(remote: DocFields, rev: number, fromConflict: boolean) {
    const local = this.local()
    const localChanged = this.hasLocalEdits || fromConflict
    const next: DocFields = localChanged
      ? {
          title: local.title !== this.base.title ? local.title : remote.title,
          body: merge3(this.base.body, local.body, remote.body),
        }
      : { ...remote }
    this.base = { ...remote }
    this.baseRev = rev
    this.apply(next)
    if (localChanged && !same(this.local(), this.base)) {
      // Our edits survive the merge — they still need saving.
      this.editSeq++
      savingStore.markPending(this.pendingKey)
    } else {
      this.savedSeq = this.editSeq
      this.clearDraft()
      savingStore.clearPending(this.pendingKey)
    }
  }

  private apply(doc: DocFields) {
    this.title = doc.title
    if (this.editor) this.editor.setBody(doc.body)
    else this.detachedBody = doc.body
    this.opts.onChange?.(this.local())
  }

  // ---- drafts ----------------------------------------------------------

  private writeDraft(local: DocFields) {
    try {
      const d: Draft = { base: this.base, baseRev: this.baseRev, local, ts: Date.now() }
      localStorage.setItem(DRAFT_PREFIX + this.key, JSON.stringify(d))
    } catch {
      /* quota / private mode — the in-memory retry still covers us */
    }
  }

  private clearDraft() {
    try {
      localStorage.removeItem(DRAFT_PREFIX + this.key)
    } catch {
      /* ignore */
    }
  }

  // Unsaved edits from a previous page load: replay them onto the current
  // server version.
  private recoverDraft() {
    const d = readDraft(this.key)
    if (!d || same(d.local, d.base)) return
    const merged: DocFields = {
      title: d.local.title !== d.base.title ? d.local.title : this.base.title,
      body: d.baseRev === this.baseRev ? d.local.body : merge3(d.base.body, d.local.body, this.base.body),
    }
    if (same(merged, this.base)) {
      this.clearDraft()
      return
    }
    this.title = merged.title
    this.detachedBody = merged.body
    this.editSeq++
    // Sessions are created lazily from templates/$derived, where store writes
    // are forbidden — defer the side effects out of the constructor.
    queueMicrotask(() => {
      savingStore.markPending(this.pendingKey)
      this.schedule()
    })
  }

  // ---- lifecycle -------------------------------------------------------

  // Page is going away: write the draft synchronously and fire a keepalive
  // save that can outlive the page.
  flushOnHide() {
    if (!this.hasLocalEdits) return
    this.writeDraft(this.local())
    void this.flush({ keepalive: true })
  }

  async dispose() {
    await this.flush()
    this.disposed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
