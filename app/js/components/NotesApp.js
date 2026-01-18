import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import * as storage from "../utils/storage.js";
import "./RichEditor.js"; // Import the new component

const style = /* css */ `
:host {
    display: block;
    color: var(--text);
    font-family: var(--font-mono);
    position: relative;
    font-size: var(--body);
}

.sidebar {
    width: 260px;
    display: flex;
    flex-direction: column;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: absolute;
    right: calc(100% + 4rem);
    top: 0;
    z-index: 10;
}

:host(.maximized) .sidebar {
    width: 0;
    opacity: 0;
    pointer-events: none;
}

.panel-section {
    padding: 1.25rem 1rem;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.15rem;
    color: var(--muted);
    margin-bottom: 0.75rem;
}

.item-list {
    flex: 1;
    overflow-y: auto;
    font-size: var(--body);
}

.list-item {
    cursor: pointer;
    border-radius: 8px;
    margin-bottom: 2px;
    transition: all 0.2s;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
}

.list-item:hover {
    color: var(--text);
}

.list-item.active {
    color: var(--accent);
}

/* Editor */
.editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem 0;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
}

#note-title {
    background: none;
    border: none;
    color: var(--text);
    font-size: var(--h1);
    width: 100%;
    outline: none;
    font-weight: 800;
    margin-bottom: 1.5rem;
    opacity: 0.95;
    font-family: inherit;
    flex-shrink: 0;
}

rich-editor {
    display: block;
}

.editor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
}

#note-title {
    background: none;
    border: none;
    color: var(--text);
    font-size: var(--h1);
    width: 100%;
    outline: none;
    font-weight: 800;
    opacity: 0.95;
    font-family: inherit;
    flex-shrink: 1;
    margin-bottom: 0;
}

.share-btn {
    font-size: 0.8rem;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(255,255,255,0.05);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.share-btn:hover {
    background: rgba(255,255,255,0.1);
    border-color: var(--accent);
}

.share-btn.active {
    background: rgba(0, 255, 136, 0.1); /* Green tint */
    border-color: #00ff88;
    color: #00ff88;
}

.share-popover {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.5rem;
    background: var(--panel);
    border: 1px solid var(--line);
    padding: 1rem;
    border-radius: 8px;
    z-index: 100;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    width: 300px;
    display: none;
}

.share-popover.visible {
    display: block;
}

.share-link-input {
    width: 100%;
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--line);
    padding: 0.5rem;
    color: var(--text);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
}

.share-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}


.btn-icon-tiny {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.2rem;
    padding: 8px 12px;
    border-radius: 6px;
    transition: all 0.2s;
    line-height: 1;
}

.btn-icon-tiny:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text);
}

.delete-btn {
    opacity: 0;
    font-size: var(--h3);
}

.list-item:hover .delete-btn {
    opacity: 0.5;
}

.list-item:hover .delete-btn:hover {
    opacity: 1;
    color: #ff4444;
}

.empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-style: italic;
    opacity: 0.5;
    text-align: center;
    padding: 2rem;
}

/* Modal */
.modal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100;
    animation: fadeIn 0.2s;
}

.modal-content {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 2rem;
    width: min(320px, 90vw);
    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.modal-title {
    font-size: var(--h3);
    font-weight: bold;
    color: var(--text);
}

.modal-input {
    background: var(--bg);
    border: 1px solid var(--line);
    padding: 0.8rem;
    border-radius: 6px;
    color: var(--text);
    font-size: var(--body);
    outline: none;
}

.modal-input:focus {
    border-color: var(--accent);
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
}

.btn-secondary {
    background: none;
    border: 1px solid var(--line);
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
}

.btn-primary {
    background: var(--accent);
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: #000;
    font-weight: bold;
    cursor: pointer;
}

.btn-danger {
    background: #ff4444;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: #fff;
    font-weight: bold;
    cursor: pointer;
}

.inline-create {
    padding: 0.4rem 0.75rem;
    margin-bottom: 0.5rem;
}

.inline-create input {
    width: 100%;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--text);
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
}
/* Undo Toast */
.undo-toast {
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel);
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 1rem;
    z-index: 1000;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    animation: slideUp 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    width: max-content;
    max-width: 90vw;
}

.undo-toast span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.undo-btn {
    background: var(--accent);
    color: #000;
    border: none;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    font-weight: bold;
    cursor: pointer;
    font-size: 0.8rem;
    transition: transform 0.2s;
}

.undo-btn:hover {
    transform: scale(1.05);
}

.confirm-msg {
    font-size: 0.8rem;
    color: #ff4444;
    font-weight: bold;
}

.confirm-actions {
    display: flex;
    gap: 0.75rem;
}

.confirm-btn-text {
    background: none;
    border: none;
    color: var(--text);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    opacity: 0.8;
}

.confirm-btn-text:hover {
    opacity: 1;
    background: rgba(255,255,255,0.1);
}

.confirm-btn-text.yes {
    color: #ff4444;
    font-weight: 800;
}

@keyframes slideUp {
    from { transform: translate(-50%, 100%); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
}

/* Responsiveness - Defined last to ensure priority */
@media (max-width: 1400px) {
    :host {
        display: flex;
        gap: 2rem;
    }
    .sidebar {
        position: static;
        flex-shrink: 0;
    }
}

@media (max-width: 900px) {
    :host {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }
    .sidebar {
        width: 100%;
        position: static;
        order: 1;
        opacity: 1 !important;
        pointer-events: auto !important;
        display: flex !important;
    }
    .editor-main {
        order: 2;
        width: 100%;
        max-width: 100%;
    }
}

@media (max-width: 600px) {
    #note-title {
        font-size: 1.8rem;
        margin-bottom: 1rem;
    }
    .btn-icon-tiny {
        padding: 10px 14px;
    }
}

@media (max-width: 480px) {
    .undo-toast {
        bottom: 1rem;
        padding: 0.6rem 1rem;
        font-size: 0.8rem;
    }
}

/* Dropdown Styles */
.dropdown-nav {
    width: 100%;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    background-size: 1rem;
    margin-bottom: 0.5rem;
    transition: border-color 0.2s;
}

.dropdown-nav:focus {
    border-color: var(--accent);
}

.dropdown-nav option {
    background: var(--panel);
    color: var(--text);
}

.mobile-only {
    display: none;
}

@media (max-width: 900px) {
    .mobile-only {
        display: block;
    }
    .desktop-only {
        display: none;
    }
}
`;

class NotesApp extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);

    this.collections = [];
    this.selectedCid = null;
    this.allNotes = []; // Global index (metadata only)
    this.notes = []; // Filtered notes for current collection
    this.selectedNid = null;
    this.selectedNid = null;
    this.isPanelPinned = false;
    this.isSaving = false;
    this.showSharePopover = false;

    this.isCreatingCollection = false;
    this.confirmingDeleteCid = null;
    // Undo state
    this.pendingDeletes = new Map(); // id -> { timeout, originalNotes }
  }

  async connectedCallback() {
    super.connectedCallback();
    this.initSavingState(); // Inherited
    await this.loadCollections();

    // Refresh on focus
    this._onFocus = () => this.refreshData();
    globalThis.addEventListener("focus", this._onFocus);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardownSavingState(); // Inherited
    globalThis.removeEventListener("focus", this._onFocus);
  }

  async refreshData() {
    console.log("[NotesApp] Refreshing data on focus...");

    // 1. Refresh collections and index
    const [collections, fullIndex] = await Promise.all([
      storage.getNotesCollections(),
      storage.getNotesIndex(),
    ]);

    this.collections = collections;
    this.allNotes = Array.isArray(fullIndex) ? fullIndex : [];

    // 2. Refresh current note content if selected
    if (this.selectedNid) {
      const fullNote = await storage.getNote(this.selectedNid);
      if (fullNote) {
        // Update in index/list
        const idx = this.allNotes.findIndex((n) => n.id === this.selectedNid);
        if (idx !== -1) {
          this.allNotes[idx] = fullNote;
        } else {
          this.allNotes.push(fullNote);
        }
      }
    }

    // 3. Re-filter lists
    if (this.selectedCid) {
      // If the selected collection disappeared, reset
      if (!this.collections.find((c) => c.id === this.selectedCid)) {
        this.selectedCid = this.collections.length > 0
          ? this.collections[0].id
          : null;
      }
    } else if (this.collections.length > 0) {
      this.selectedCid = this.collections[0].id;
    }

    this.loadNotes(); // Re-filters notes from allNotes and renders
  }

  async loadCollections() {
    console.log("[NotesApp] Loading collections and index...");
    const [collections, fullIndex] = await Promise.all([
      storage.getNotesCollections(),
      storage.getNotesIndex(),
    ]);

    this.collections = collections;
    this.allNotes = Array.isArray(fullIndex) ? fullIndex : [];
    console.log(
      `[NotesApp] Loaded ${this.collections.length} collections, ${this.allNotes.length} notes in index.`,
    );

    if (this.collections.length > 0 && !this.selectedCid) {
      this.selectedCid = this.collections[0].id;
    }

    await this.loadNotes();
  }

  async loadNotes() {
    if (!this.selectedCid) {
      this.notes = [];
      this.render();
      return;
    }

    // 1. Try local index first
    let collectionNotes = this.allNotes.filter(
      (n) => String(n.cid) === String(this.selectedCid),
    );

    // 2. Fallback: If local index is empty but we have collections, try fetching directly
    // (This helps if /api/notes/index is not supported or was empty)
    if (collectionNotes.length === 0) {
      console.log(
        `[NotesApp] Index empty for ${this.selectedCid}, falling back to direct fetch...`,
      );
      const fetched = await storage.getCollectionNotes(this.selectedCid);
      if (Array.isArray(fetched) && fetched.length > 0) {
        // Merge into global index to avoid future fallbacks
        fetched.forEach((fn) => {
          if (!this.allNotes.find((an) => an.id === fn.id)) {
            this.allNotes.push(fn);
          }
        });
        collectionNotes = fetched;
      }
    }

    this.notes = collectionNotes.sort((a, b) =>
      (b.createdAt || 0) - (a.createdAt || 0)
    );
    this.render();
  }

  // --- Collection Actions ---
  promptCreateCollection() {
    this.isCreatingCollection = true;
    this.render();
    setTimeout(() => {
      const input = this.shadowRoot.getElementById("inline-create-input");
      if (input) input.focus();
    }, 50);
  }

  async submitCreateCollection() {
    if (!this.isCreatingCollection) return;
    this.isCreatingCollection = false;

    const input = this.shadowRoot.getElementById("inline-create-input");
    const name = input ? input.value.trim() : "";
    if (name) {
      const cid = crypto.randomUUID();
      this.collections.push({ id: cid, name });
      await storage.saveNotesCollections(this.collections);
      this.selectedCid = cid;
      await this.loadNotes();
    }
    this.render();
  }

  cancelCreateCollection() {
    if (!this.isCreatingCollection) return;
    this.isCreatingCollection = false;
    this.render();
  }

  promptDeleteCollection(id) {
    this.confirmingDeleteCid = id;
    this.render();
  }

  async confirmDeleteCollection(id) {
    await storage.deleteNotesCollection(id);
    this.collections = this.collections.filter((c) => c.id !== id);
    if (this.selectedCid === id) {
      this.selectedCid = this.collections[0]?.id || null;
      this.notes = [];
      this.selectedNid = null;
    }
    this.confirmingDeleteCid = null;
    this.render();
  }

  cancelDeleteCollection() {
    this.confirmingDeleteCid = null;
    this.render();
  }

  promptDeleteNote(id) {
    const note = this.allNotes.find((n) => n.id === id);
    if (!note) return;

    // Save state for undo
    const originalAllNotes = [...this.allNotes];

    // Optimistic UI update
    this.allNotes = this.allNotes.filter((n) => n.id !== id);
    if (this.selectedNid === id) this.selectedNid = null;
    this.loadNotes();

    // Set 10s timer
    const timeout = setTimeout(async () => {
      this.pendingDeletes.delete(id);
      this.render();
      try {
        await storage.deleteNote(id);
        console.log(`[NotesApp] Permanently deleted note: ${id}`);
      } catch (err) {
        console.error("[NotesApp] Delete failed:", err);
      }
    }, 10000);

    this.pendingDeletes.set(id, { timeout, originalAllNotes });
    this.render();
  }

  undoDelete(id) {
    const pending = this.pendingDeletes.get(id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.allNotes = pending.originalAllNotes;
      this.pendingDeletes.delete(id);
      this.loadNotes();
    }
  }

  // --- CRUD Operations ---

  async createNote() {
    if (!this.selectedCid) return;
    const nid = crypto.randomUUID();
    const newNote = {
      id: nid,
      cid: this.selectedCid,
      title: "Untitled Note",
      content: "",
      createdAt: Date.now(),
    };
    const metadata = { ...newNote };
    delete metadata.content;
    this.allNotes.unshift(metadata);
    this.loadNotes();

    await storage.saveNote(newNote);
    this.selectedNid = nid;
    this.render();

    this.focusElement("#note-title", true);
  }

  selectCollection(cid) {
    this.selectedCid = cid;
    this.selectedNid = null;
    this.isPanelPinned = true;
    this.loadNotes();
  }

  async selectNote(nid) {
    this.selectedNid = nid;
    this.isPanelPinned = false;
    this.render();

    // Find the note in our local metadata list
    const noteIndex = this.notes.findIndex((n) => n.id === nid);
    if (noteIndex === -1) return;

    const note = this.notes[noteIndex];

    // If content is missing, fetch full note
    if (note.content === undefined) {
      console.log(`[NotesApp] Fetching full content for note: ${nid}`);
      const fullNote = await storage.getNote(nid);
      if (fullNote && this.selectedNid === nid) {
        // Update local cache
        this.notes[noteIndex] = fullNote;
        this.render(); // This will update the editor with real content
      }
    }

    globalThis.scrollTo(0, 0);
  }

  focusElement(selector, select = false) {
    setTimeout(() => {
      const el = this.shadowRoot.querySelector(selector);
      if (el) {
        el.focus();
        if (select && el.select) el.select();
      }
    }, 0);
  }

  // Use inherited wrapper for debounced save
  saveNoteDebounced = this.wrapDebouncedSave(async (note) => {
    await storage.saveNote(note);
    console.log("Note saved (debounced)");
  }, 500);

  handleNoteUpdate(content) {
    const titleEl = this.shadowRoot.getElementById("note-title");

    // If updating title
    const title = titleEl ? titleEl.value : "";

    const note = this.notes.find((n) => n.id === this.selectedNid);
    if (note) {
      if (titleEl) note.title = title;
      if (content !== undefined) note.content = content; // If content passed

      // Update sidebar title in real-time immediately
      if (titleEl) {
        const titleInSidebar = this.shadowRoot.querySelector(
          `.note-item[data-nid="${this.selectedNid}"] .title-text`,
        );
        if (titleInSidebar) titleInSidebar.textContent = title || "Untitled";

        // Sync local index
        const idx = this.allNotes.findIndex((n) => n.id === this.selectedNid);
        if (idx > -1) this.allNotes[idx].title = title || "Untitled";
      }

      // Trigger debounced save
      this.saveNoteDebounced(note);
    }
  }

  async toggleShare(forceState) {
    const note = this.notes.find((n) => n.id === this.selectedNid);
    if (!note) return;

    if (forceState !== undefined) {
      note.isPublic = forceState;
    } else {
      note.isPublic = !note.isPublic;
    }

    // Save immediately (bypass debounce) to ensure link works
    this.isSaving = true;
    this.render();

    try {
      await storage.saveNote(note);
    } catch (e) {
      console.error("Failed to save share state", e);
    } finally {
      this.isSaving = false;
      this.render();
    }
  }

  toggleSharePopover() {
    this.showSharePopover = !this.showSharePopover;
    this.render();
  }

  render() {
    const currentNote = this.notes.find((n) => n.id === this.selectedNid);

    const collectionsDropdownHtml = this.collections.map((c) => `
        <option value="${c.id}" ${c.id === this.selectedCid ? "selected" : ""}>
            ${c.name}
        </option>
    `).join("");

    const notesHtml = this.notes.map((n) => `
        <div class="list-item note-item ${
      n.id === this.selectedNid ? "active" : ""
    }" data-nid="${n.id}">
            <span class="title-text">${n.title || "Untitled"}</span>
            <button class="btn-icon-tiny delete-note-btn" data-nid="${n.id}">×</button>
        </div>
    `).join("");

    const editorHtml = currentNote
      ? `
        <div class="editor-header">
            <input type="text" id="note-title" 
                   value="${currentNote.title}">
            
             <div style="position: relative;">
                <button class="share-btn ${
        currentNote.isPublic ? "active" : ""
      }" id="share-toggle-btn">
                    ${currentNote.isPublic ? "Public" : "Share"}
                </button>
                
                <div class="share-popover ${
        this.showSharePopover ? "visible" : ""
      }">
                    <p style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--text);">
                        ${
        currentNote.isPublic
          ? "Anyone with the link can view this note."
          : "Make this note public to share it."
      }
                    </p>
                    
                    ${
        currentNote.isPublic
          ? `
                        <div style="display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <label style="grid-column: 1 / -1; font-size: 0.75rem; color: var(--muted); margin-bottom: -0.25rem;">Public Page</label>
                            <input type="text" id="share-link-input-page" class="share-link-input" readonly 
                                value="${location.origin}/shared/${currentNote.id}">
                            <button class="btn-primary" id="copy-share-link" style="font-size: 0.75rem; white-space: nowrap;">Copy</button>
                            
                            <label style="grid-column: 1 / -1; font-size: 0.75rem; color: var(--muted); margin-bottom: -0.25rem; margin-top: 0.5rem;">API Endpoint</label>
                            <input type="text" id="share-link-input-api" class="share-link-input" readonly 
                                value="${location.origin}/api/public/notes/${currentNote.id}">
                            <button class="btn-primary" id="copy-api-link" style="font-size: 0.75rem; white-space: nowrap;">Copy</button>
                        </div>
                        
                        <div class="share-actions" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--line);">
                            <button class="btn-secondary" id="unshare-btn" style="font-size: 0.75rem; width: 100%;">Disable Sharing (Make Private)</button>
                        </div>
                    `
          : `
                        <div class="share-actions">
                            <button class="btn-primary" id="enable-share-btn" style="width: 100%; font-size: 0.8rem;">Enable Public Link</button>
                        </div>
                    `
      }
                </div>
            </div>
        </div>
        
        <div id="rich-editor-container">
            <rich-editor></rich-editor>
        </div>
    `
      : `
        <div class="empty-state">
            ${this.selectedCid ? "" : "Choose or create a collection"}
        </div>
    `;

    const inlineCreateHtml = this.isCreatingCollection
      ? `
        <form id="inline-create-form" class="inline-create">
            <input type="text" id="inline-create-input" placeholder="Collection Name...">
        </form>
    `
      : "";

    // Undo Toasts
    let undoHtml = "";
    if (this.pendingDeletes.size > 0) {
      const id = Array.from(this.pendingDeletes.keys())[0];
      undoHtml = `
            <div class="undo-toast">
                <span>Note deleted</span>
                <button class="undo-btn" data-nid="${id}">Undo</button>
            </div>
        `;
    }

    const content = `
        ${undoHtml}
        ${this.savingIndicatorHTML}
        <div class="sidebar ${this.isPanelPinned ? "" : "collapsed"}">
            <div class="panel-section">
                <div class="panel-header">
                    <span>Library</span>
                    <button class="btn-icon-tiny" id="add-collection-btn">+</button>
                </div>
                ${inlineCreateHtml}
                <div style="display: flex; gap: 0.5rem; align-items: flex-start;">
                    <select class="dropdown-nav" id="collection-dropdown" style="flex:1">
                        ${collectionsDropdownHtml}
                    </select>
                    <button class="btn-icon-tiny delete-coll-btn" data-cid="${this.selectedCid}">×</button>
                </div>
                
                ${
      this.confirmingDeleteCid
        ? `
                    <div class="list-item confirming" style="margin-top: 0.5rem">
                        <span class="confirm-msg">Delete collection?</span>
                        <div class="confirm-actions">
                            <button class="confirm-btn-text yes" data-cid="${this.confirmingDeleteCid}">Yes</button>
                            <button class="confirm-btn-text no">No</button>
                        </div>
                    </div>
                `
        : ""
    }
            </div>
            
            <div class="panel-section" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
                <div class="panel-header">
                    <span>Notes</span>
                    <button class="btn-icon-tiny" id="add-note-btn">+</button>
                </div>
                <!-- Desktop List -->
                <div class="item-list desktop-only">${notesHtml}</div>
                
                <!-- Mobile Dropdown -->
                <div class="mobile-only">
                    <div style="display: flex; gap: 0.5rem; align-items: flex-start;">
                        <select class="dropdown-nav" id="note-dropdown" style="flex:1">
                            <option value="" ${
      !this.selectedNid ? "selected" : ""
    } disabled>Select a note...</option>
                            ${
      this.notes.map((n) => `
                                <option value="${n.id}" ${
        n.id === this.selectedNid ? "selected" : ""
      }>
                                    ${n.title || "Untitled"}
                                </option>
                            `).join("")
    }
                        </select>
                        <button class="btn-icon-tiny delete-note-btn" data-nid="${this.selectedNid}">×</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="editor-main">
            ${editorHtml}
        </div>
    `;

    this.display(content);

    // --- Events ---
    const inlineForm = this.shadowRoot.getElementById("inline-create-form");
    if (inlineForm) {
      const input = inlineForm.querySelector("input");
      inlineForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitCreateCollection();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.cancelCreateCollection();
      });
      input.addEventListener("blur", () => {
        // Only submit on blur if there's text, otherwise just cancel
        if (input.value.trim()) this.submitCreateCollection();
        else this.cancelCreateCollection();
      });
    }

    // Dropdown Navigation
    const collDropdown = this.shadowRoot.getElementById("collection-dropdown");
    if (collDropdown) {
      collDropdown.addEventListener("change", (e) => {
        this.selectCollection(e.target.value);
      });
    }

    const noteDropdown = this.shadowRoot.getElementById("note-dropdown");
    if (noteDropdown) {
      noteDropdown.addEventListener("change", (e) => {
        this.selectNote(e.target.value);
      });
    }

    // Sidebar Events
    this.shadowRoot.querySelectorAll(".list-item[data-cid]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-coll-btn")) return;
        this.selectCollection(el.dataset.cid);
      });
    });

    this.shadowRoot.querySelectorAll(".confirm-btn-text.yes").forEach((btn) => {
      btn.addEventListener(
        "click",
        () => this.confirmDeleteCollection(btn.dataset.cid),
      );
    });

    this.shadowRoot.querySelectorAll(".confirm-btn-text.no").forEach((btn) => {
      btn.addEventListener("click", () => this.cancelDeleteCollection());
    });

    this.shadowRoot.querySelectorAll(".delete-coll-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.promptDeleteCollection(btn.dataset.cid || this.selectedCid);
      });
    });

    this.shadowRoot.querySelectorAll(".note-item[data-nid]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-note-btn")) return;
        this.selectNote(el.dataset.nid);
      });
    });

    this.shadowRoot.querySelectorAll(".delete-note-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.promptDeleteNote(btn.dataset.nid || this.selectedNid);
      });
    });

    this.shadowRoot.querySelectorAll(".undo-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.undoDelete(btn.dataset.nid));
    });

    const addCollBtn = this.shadowRoot.getElementById("add-collection-btn");
    if (addCollBtn) {
      addCollBtn.addEventListener("click", () => this.promptCreateCollection());
    }

    const addNoteBtn = this.shadowRoot.getElementById("add-note-btn");
    if (addNoteBtn) {
      addNoteBtn.addEventListener("click", () => this.createNote());
    }

    // Editor Events
    const titleInput = this.shadowRoot.getElementById("note-title");
    if (titleInput) {
      titleInput.addEventListener("input", () => this.handleNoteUpdate());
    }

    const shareToggleBtn = this.shadowRoot.getElementById("share-toggle-btn");
    if (shareToggleBtn) {
      shareToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleSharePopover();
      });
    }

    // Close popover when clicking outside
    this.shadowRoot.addEventListener("click", (e) => {
      if (
        this.showSharePopover && !e.target.closest(".share-popover") &&
        !e.target.closest("#share-toggle-btn")
      ) {
        this.showSharePopover = false;
        this.render();
      }
    });

    const enableShareBtn = this.shadowRoot.getElementById("enable-share-btn");
    if (enableShareBtn) {
      enableShareBtn.addEventListener("click", () => this.toggleShare(true));
    }

    const unshareBtn = this.shadowRoot.getElementById("unshare-btn");
    if (unshareBtn) {
      unshareBtn.addEventListener("click", () => this.toggleShare(false));
    }

    const copyPairs = [
      { btnId: "copy-share-link", inputId: "share-link-input-page" },
      { btnId: "copy-api-link", inputId: "share-link-input-api" },
    ];

    copyPairs.forEach(({ btnId, inputId }) => {
      const btn = this.shadowRoot.getElementById(btnId);
      if (btn) {
        btn.addEventListener("click", () => {
          const input = this.shadowRoot.getElementById(inputId);
          if (input) {
            input.select();
            navigator.clipboard.writeText(input.value);
            const originalText = btn.textContent;
            btn.textContent = "Copied!";
            setTimeout(() => btn.textContent = originalText, 2000);
          }
        });
      }
    });

    // Rich Editor Events
    const richEditor = this.shadowRoot.querySelector("rich-editor");
    if (richEditor && currentNote) {
      // Init/Update value only if needed
      const targetVal = currentNote.content === undefined
        ? "Loading..."
        : currentNote.content;

      // Use a property to track what we last set to avoid redundant setValue calls
      if (richEditor._lastVal !== targetVal) {
        richEditor.setValue(targetVal);
        richEditor._lastVal = targetVal;
      }

      // Listen for changes
      if (!richEditor._hasChangeListener) {
        richEditor.addEventListener("change", (e) => {
          richEditor._lastVal = e.detail; // Track current editor state
          this.handleNoteUpdate(e.detail);
        });
        richEditor._hasChangeListener = true;
      }
    }
  }
}

customElements.define("notes-app", NotesApp);
