import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import * as storage from "../utils/storage.js";

const style = /* css */ `
:host {
    display: flex;
    height: 80vh;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-mono);
    gap: 1.5rem;
    position: relative;
    font-size: var(--body);
}

.sidebar {
    width: 260px;
    display: flex;
    flex-direction: column;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

:host(.maximized) .sidebar {
    width: 0;
    opacity: 0;
    pointer-events: none;
    margin-right: -1.5rem;
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
    padding: 0.6rem 0.75rem;
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
    background: rgba(255,255,255,0.05);
    color: var(--text);
}

.list-item.active {
    background: rgba(255,255,255,0.08);
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
}

#note-content {
    background: none;
    border: none;
    color: var(--text);
    font-size: 1.1rem;
    width: 100%;
    height: 100%;
    outline: none;
    resize: none;
    line-height: var(--lh);
    font-family: inherit;
    opacity: 0.85;
}

.rendered-content {
    line-height: var(--lh);
    font-size: var(--small);
    opacity: 0.85;
    cursor: text;
    min-height: 300px;
}

.rendered-content h1, .rendered-content h2, .rendered-content h3 { 
    font-size: var(--h2);
    border-bottom: 1px solid var(--line); 
    padding-bottom: 0.5rem; 
}

.btn-icon-tiny {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 4px 8px;
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
    width: 320px;
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

`;

class NotesApp extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);

    this.collections = [];
    this.selectedCid = null;
    this.notes = [];
    this.selectedNid = null;
    this.isEditing = false;
    this.isPanelPinned = false;
    this.isSaving = false; // Reset state explicitly

    // ... modal state ...
    this.modalState = {
      type: null,
      targetId: null,
      inputValue: "",
    };

    // Bind handlers
    this.toggleEdit = this.toggleEdit.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleModalSubmit = this.handleModalSubmit.bind(this);
    this.closeModal = this.closeModal.bind(this);
  }

  async connectedCallback() {
    super.connectedCallback();
    this.initSavingState(); // Inherited
    await this.loadCollections();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardownSavingState(); // Inherited
  }

  async loadCollections() {
    this.collections = await storage.getNotesCollections();
    if (this.collections.length > 0 && !this.selectedCid) {
      this.selectedCid = this.collections[0].id;
      await this.loadNotes();
    }
    this.render();
  }

  async loadNotes() {
    if (!this.selectedCid) return;
    this.notes = await storage.getCollectionNotes(this.selectedCid);
    this.render();
  }

  // --- Modal Actions ---

  promptCreateCollection() {
    this.modalState = {
      type: "create-collection",
      targetId: null,
      inputValue: "",
    };
    this.render();
    setTimeout(() => {
      const input = this.shadowRoot.getElementById("modal-input");
      if (input) input.focus();
    }, 50);
  }

  promptDeleteCollection(id) {
    this.modalState = {
      type: "delete-collection",
      targetId: id,
      inputValue: "",
    };
    this.render();
  }

  promptDeleteNote(id) {
    this.modalState = { type: "delete-note", targetId: id, inputValue: "" };
    this.render();
  }

  closeModal() {
    this.modalState = { type: null, targetId: null, inputValue: "" };
    this.render();
  }

  async handleModalSubmit() {
    const { type, targetId } = this.modalState;

    if (type === "create-collection") {
      const input = this.shadowRoot.getElementById("modal-input");
      const name = input ? input.value.trim() : "";
      if (name) {
        const cid = crypto.randomUUID();
        this.collections.push({ id: cid, name });
        await storage.saveNotesCollections(this.collections);
        this.selectedCid = cid;
        await this.loadNotes();
      }
    } else if (type === "delete-collection") {
      await storage.deleteNotesCollection(targetId);
      this.collections = this.collections.filter((c) => c.id !== targetId);
      if (this.selectedCid === targetId) {
        this.selectedCid = this.collections[0]?.id || null;
        this.notes = [];
        this.selectedNid = null;
      }
    } else if (type === "delete-note") {
      await storage.deleteNote(targetId);
      this.notes = this.notes.filter((n) => n.id !== targetId);
      if (this.selectedNid === targetId) {
        this.selectedNid = null;
      }
    }

    this.closeModal();
  }

  // --- CRUD Operations (now routed through modal actions or direct updates) ---

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
    this.notes.unshift(newNote);
    await storage.saveNote(newNote);
    this.selectedNid = nid;
    this.isEditing = true;
    this.render();

    this.focusElement("#note-title", true);
  }

  selectCollection(cid) {
    this.selectedCid = cid;
    this.selectedNid = null;
    this.isPanelPinned = true;
    this.loadNotes();
  }

  selectNote(nid) {
    this.selectedNid = nid;
    this.isEditing = false;
    this.isPanelPinned = false;
    this.render();
  }

  toggleEdit() {
    this.isEditing = true;
    this.render();
    this.focusElement("#note-content");
  }

  handleBlur() {
    // If a modal is open, do not cancel editing based on blur events
    if (this.modalState.type) return;

    setTimeout(() => {
      const active = this.shadowRoot.activeElement;
      // Also check if focus moved to a part of the modal
      if (
        active && (
          active.id === "note-title" ||
          active.id === "note-content" ||
          active.classList.contains("modal-input") ||
          active.tagName === "BUTTON"
        )
      ) return;

      this.isEditing = false;
      this.render();
    }, 150);
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

  handleNoteUpdate() {
    const titleEl = this.shadowRoot.getElementById("note-title");
    const contentEl = this.shadowRoot.getElementById("note-content");
    if (!titleEl || !contentEl) return;

    const title = titleEl.value;
    const content = contentEl.value;

    const note = this.notes.find((n) => n.id === this.selectedNid);
    if (note) {
      note.title = title;
      note.content = content;

      // Update sidebar title in real-time immediately
      const titleInSidebar = this.shadowRoot.querySelector(
        `.note-item[data-nid="${this.selectedNid}"] .title-text`,
      );
      if (titleInSidebar) titleInSidebar.textContent = title || "Untitled";

      // Trigger debounced save
      this.saveNoteDebounced(note);
    }
  }

  render() {
    const currentNote = this.notes.find((n) => n.id === this.selectedNid);
    const renderedHtml = currentNote && globalThis.marked
      ? globalThis.marked.parse(currentNote.content)
      : (currentNote?.content || "");

    const collectionsHtml = this.collections.map((c) => `
        <div class="list-item ${
      c.id === this.selectedCid ? "active" : ""
    }" data-cid="${c.id}">
            <span class="name-text">${c.name}</span>
            <button class="btn-icon-tiny delete-coll-btn" data-cid="${c.id}">×</button>
        </div>
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
        </div>
        
        ${
        this.isEditing
          ? `
            <textarea id="note-content">${currentNote.content}</textarea>
        `
          : `
            <div class="rendered-content">
                ${
            renderedHtml ||
            '<span style="opacity:0.3">Focus your thoughts here...</span>'
          }
            </div>
        `
      }
    `
      : `
        <div class="empty-state">
            <span style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.2">✎</span>
            ${
        this.selectedCid
          ? "Create a note to begin"
          : "Choose or create a collection"
      }
        </div>
    `;

    // Modal Template
    let modalHtml = "";
    if (this.modalState.type) {
      const isDelete = this.modalState.type.startsWith("delete");
      const title = this.modalState.type === "create-collection"
        ? "New Collection"
        : this.modalState.type === "delete-collection"
        ? "Delete Collection?"
        : "Delete Note?";

      modalHtml = `
            <div class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-title">${title}</div>
                    ${
        this.modalState.type === "create-collection"
          ? `<input type="text" id="modal-input" class="modal-input" placeholder="Collection Name" 
                          onkeydown="if(event.key==='Enter') this.getRootNode().host.handleModalSubmit()">`
          : `<p style="color:var(--muted)">Are you sure you want to delete this?</p>`
      }
                    <div class="modal-actions">
                        <button class="btn-secondary" id="modal-cancel">Cancel</button>
                        <button class="${
        isDelete ? "btn-danger" : "btn-primary"
      }" id="modal-confirm">
                            ${isDelete ? "Delete" : "Create"}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    const content = `
        ${modalHtml}
        ${this.savingIndicatorHTML}
        <div class="sidebar ${this.isPanelPinned ? "" : "collapsed"}">
            <div class="panel-section">
                <div class="panel-header">
                    <span>Library</span>
                    <button class="btn-icon-tiny" id="add-collection-btn">+</button>
                </div>
                <div class="item-list">${collectionsHtml}</div>
            </div>
            
            <div class="panel-section" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
                <div class="panel-header">
                    <span>Notes</span>
                    <button class="btn-icon-tiny" id="add-note-btn">+</button>
                </div>
                <div class="item-list">${notesHtml}</div>
            </div>
        </div>

        <div class="editor-main">
            ${editorHtml}
        </div>
    `;

    this.display(content);

    // --- Events ---

    // Modal Events
    if (this.modalState.type) {
      const cancel = this.shadowRoot.getElementById("modal-cancel");
      const confirm = this.shadowRoot.getElementById("modal-confirm");
      const overlay = this.shadowRoot.querySelector(".modal-overlay");

      if (cancel) cancel.onclick = this.closeModal;
      if (confirm) confirm.onclick = this.handleModalSubmit;
      if (overlay) {
        overlay.onclick = (e) => {
          if (e.target === overlay) this.closeModal();
        };
      }
    }

    // Sidebar Events
    this.shadowRoot.querySelectorAll(".list-item[data-cid]").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.classList.contains("delete-coll-btn")) return;
        this.selectCollection(el.dataset.cid);
      };
    });

    this.shadowRoot.querySelectorAll(".delete-coll-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.promptDeleteCollection(btn.dataset.cid);
      };
    });

    this.shadowRoot.querySelectorAll(".note-item[data-nid]").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.classList.contains("delete-note-btn")) return;
        this.selectNote(el.dataset.nid);
      };
    });

    this.shadowRoot.querySelectorAll(".delete-note-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.promptDeleteNote(btn.dataset.nid);
      };
    });

    const addCollBtn = this.shadowRoot.getElementById("add-collection-btn");
    if (addCollBtn) addCollBtn.onclick = () => this.promptCreateCollection();

    const addNoteBtn = this.shadowRoot.getElementById("add-note-btn");
    if (addNoteBtn) addNoteBtn.onclick = () => this.createNote();

    // Editor Events
    const titleInput = this.shadowRoot.getElementById("note-title");
    if (titleInput) {
      // Only attach if element exists to avoid null ref after modal open
      titleInput.oninput = () => this.handleNoteUpdate();
      titleInput.onblur = () => this.handleBlur();
      // Restore focus if we are editing and not in a modal
      if (
        this.isEditing && !this.modalState.type &&
        this.shadowRoot.activeElement !== titleInput &&
        this.shadowRoot.activeElement?.id !== "note-content"
      ) {
        // Let the browser handle natural focus, but good for restoring
      }
    }

    const contentInput = this.shadowRoot.getElementById("note-content");
    if (contentInput) {
      contentInput.oninput = () => this.handleNoteUpdate();
      contentInput.onblur = () => this.handleBlur();
    }

    const renderedDiv = this.shadowRoot.querySelector(".rendered-content");
    if (renderedDiv) {
      renderedDiv.onclick = () => this.toggleEdit();
    }
  }
}

customElements.define("notes-app", NotesApp);
