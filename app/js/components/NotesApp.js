import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import * as storage from "../utils/storage.js";
import { style } from "./NotesApp.styles.js";
import "./RichEditor.js";

class NotesApp extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);

    this.collections = [];
    this.selectedCid = null;
    this.allNotes = []; // Global index (metadata only)
    this.notes = []; // Filtered notes for current collection
    this.selectedNid = null;
    this.isPanelPinned = false;
    this.isSaving = false;
    this.showSharePopover = false;

    this.confirmingDeleteCid = null;
    this.showTrash = false;
    this.trashNotes = [];
    this.inFlightOps = new Set(); // IDs currently being trashed/restored
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

    // Merge logic: Keep local optimistic notes and update others
    const serverIndex = Array.isArray(fullIndex) ? fullIndex : [];
    const localMap = new Map(this.allNotes.map((n) => [n.id, n]));

    serverIndex.forEach((serverNote) => {
      // Logic: If there's an in-flight move for this note, IGNORE server update
      // so it doesn't "resurrect" while the request is still finishing.
      if (this.inFlightOps.has(serverNote.id)) return;

      const local = localMap.get(serverNote.id);
      if (local) {
        // If server is newer, or if it's the same but we want to refresh metadata
        if ((serverNote.updatedAt || 0) >= (local.updatedAt || 0)) {
          // Merge metadata from server, but keep local content if server's is missing
          localMap.set(serverNote.id, { ...local, ...serverNote });
        }
      } else {
        localMap.set(serverNote.id, serverNote);
      }
    });

    this.allNotes = Array.from(localMap.values());

    // 2. Refresh current note content if selected
    if (this.selectedNid) {
      const fullNote = await storage.getNote(this.selectedNid);
      if (fullNote) {
        // Update in index/list
        const idx = this.allNotes.findIndex((n) => n.id === this.selectedNid);
        if (idx !== -1) {
          // Keep content if it was already richer locally (e.g. just typed)
          const existing = this.allNotes[idx];
          this.allNotes[idx] = { ...fullNote, ...existing, id: fullNote.id };
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
      this.trashNotes = [];
      this.render();
      return;
    }

    // 1. Derive both lists from allNotes metadata index
    this.notes = this.allNotes
      .filter((n) => String(n.cid) === String(this.selectedCid) && !n.deletedAt)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    this.trashNotes = this.allNotes
      .filter((n) =>
        String(n.cid) === String(this.selectedCid) && !!n.deletedAt
      )
      .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

    // 2. Fallback: If active notes are missing but we expect some, try fetching
    if (this.notes.length === 0 && !this.showTrash) {
      const fetched = await storage.getCollectionNotes(this.selectedCid);
      if (Array.isArray(fetched) && fetched.length > 0) {
        fetched.forEach((fn) => {
          if (!this.allNotes.find((an) => an.id === fn.id)) {
            this.allNotes.push(fn);
          }
        });
        this.loadNotes(); // Re-derive
        return;
      }
    }

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

    // 1. Optimistic Update
    const originalAllNotes = JSON.parse(JSON.stringify(this.allNotes));
    const local = this.allNotes.find((n) => n.id === id);
    if (local) local.deletedAt = Date.now();
    this.inFlightOps.add(id);

    if (this.selectedNid === id) this.selectedNid = null;
    this.loadNotes(); // Instant derived UI update

    // 2. Perform server action in background
    storage.deleteNote(id, note.cid).then(() => {
      this.inFlightOps.delete(id);
    }).catch(async (e) => {
      console.error("Failed to trash note:", e);
      this.inFlightOps.delete(id);
      this.allNotes = originalAllNotes;
      await this.loadNotes();
      alert("Failed to delete note. Please try again.");
    });
  }

  restoreNote(id) {
    const originalAllNotes = JSON.parse(JSON.stringify(this.allNotes));

    // Optimistic Update
    const local = this.allNotes.find((n) => n.id === id);
    if (local) delete local.deletedAt;
    this.inFlightOps.add(id);

    this.loadNotes(); // Instant derived UI update

    // Background server call
    storage.restoreNote(id).then(() => {
      this.inFlightOps.delete(id);
    }).catch(async (e) => {
      console.error("Failed to restore note:", e);
      this.inFlightOps.delete(id);
      this.allNotes = originalAllNotes;
      await this.loadNotes();
      alert("Failed to restore note. Please try again.");
    });
  }

  permanentlyDeleteNote(id) {
    if (!confirm("Permanently delete this note? This cannot be undone.")) {
      return;
    }

    const originalAllNotes = JSON.parse(JSON.stringify(this.allNotes));
    this.allNotes = this.allNotes.filter((n) => n.id !== id);
    this.inFlightOps.add(id);

    this.loadNotes();

    storage.permanentlyDeleteNote(id).then(() => {
      this.inFlightOps.delete(id);
    }).catch(async (e) => {
      console.error("Failed to permanently delete note:", e);
      this.inFlightOps.delete(id);
      this.allNotes = originalAllNotes;
      await this.loadNotes();
      alert("Failed to delete note. Please try again.");
    });
  }

  async emptyTrash() {
    if (!confirm("Permanently delete all notes in trash?")) return;

    const originalAllNotes = JSON.parse(JSON.stringify(this.allNotes));
    this.allNotes = this.allNotes.filter((n) =>
      !(n.cid === this.selectedCid && n.deletedAt)
    );

    await this.loadNotes();

    try {
      await storage.emptyTrash(this.selectedCid);
    } catch (e) {
      console.error("Failed to empty trash:", e);
      this.allNotes = originalAllNotes;
      await this.loadNotes();
      alert("Failed to empty trash. Please try again.");
    }
  }

  toggleTrash() {
    this.showTrash = !this.showTrash;
    this.render(); // Show empty list or cached list immediately
    this.loadNotes(); // Then fetch/sync
  }

  // --- CRUD Operations ---

  createNote() {
    if (!this.selectedCid) return;

    const nid = crypto.randomUUID();
    const newNote = {
      id: nid,
      cid: this.selectedCid,
      title: "Untitled Note",
      content: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 1. Optimistic UI update: Immediate selection and display
    this.allNotes.unshift(newNote); // Keep full object in allNotes for now
    this.selectedNid = nid;
    this.loadNotes(); // This calls render()

    this.focusElement("#note-title", true);

    // 2. Trigger debounced save (handles creation on server)
    this.saveNoteDebounced(newNote);
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
    // Use requestAnimationFrame to wait for the next frame where DOM might be updated
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = this.shadowRoot.querySelector(selector);
        if (el) {
          el.focus();
          if (select && el.select) el.select();
        }
      }, 50); // 50ms buffer to ensure Tiptap and other sub-components finished mounting
    });
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

    const trashHtml = this.trashNotes.map((n) => `
        <div class="list-item trash-item" data-nid="${n.id}">
            <span class="title-text">${n.title || "Untitled"}</span>
            <div style="display: flex; gap: 0.25rem;">
                <button class="btn-icon-tiny restore-note-btn" data-nid="${n.id}" title="Restore">↺</button>
                <button class="btn-icon-tiny permanently-delete-btn" data-nid="${n.id}" title="Delete Permanently" style="color: #ff4444">×</button>
            </div>
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

    const content = `
        ${this.savingIndicatorHTML}
        <div class="sidebar ${this.isPanelPinned ? "" : "collapsed"}">
            <div class="panel-section">
                <div class="panel-header">
                    <span>Library</span>
                    <button class="btn-icon-tiny" id="add-collection-btn" title="New Collection">+</button>
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
                    <span>${this.showTrash ? "Trash" : "Notes"}</span>
                    <div style="display: flex; gap: 0.25rem;">
                         ${
      this.showTrash
        ? `<button class="btn-icon-tiny" id="empty-trash-btn" title="Empty Trash">🧹</button>`
        : `<button class="btn-icon-tiny" id="add-note-btn" title="New Note">+</button>`
    }
                        <button class="btn-icon-tiny ${
      this.showTrash ? "active" : ""
    }" id="toggle-trash-btn" title="View Trash">🗑️</button>
                    </div>
                </div>
                <!-- Desktop List -->
                <div class="item-list desktop-only">
                    ${this.showTrash ? trashHtml : notesHtml}
                    ${
      this.showTrash && this.trashNotes.length === 0
        ? '<div class="empty-state" style="padding: 1rem; font-size: 0.8rem;">Trash is empty</div>'
        : ""
    }
                </div>
                
                <!-- Mobile Dropdown -->
                <div class="mobile-only">
                    ${
      this.showTrash ? `<div class="item-list">${trashHtml}</div>` : `
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
                    `
    }
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

    this.shadowRoot.querySelectorAll(".restore-note-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.restoreNote(btn.dataset.nid);
      });
    });

    this.shadowRoot.querySelectorAll(".permanently-delete-btn").forEach(
      (btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.permanentlyDeleteNote(btn.dataset.nid);
        });
      },
    );

    const toggleTrashBtn = this.shadowRoot.getElementById("toggle-trash-btn");
    if (toggleTrashBtn) {
      toggleTrashBtn.addEventListener("click", () => this.toggleTrash());
    }

    const emptyTrashBtn = this.shadowRoot.getElementById("empty-trash-btn");
    if (emptyTrashBtn) {
      emptyTrashBtn.addEventListener("click", () => this.emptyTrash());
    }

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
