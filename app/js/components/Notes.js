import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";
import { saveForDate } from "../utils/storage.js";
import { style } from "./Notes.styles.js";
import "./RichEditor.js";

const SAVE_DEBOUNCE_MS = 500;

class NotesInput extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
    this.notesMarkdown = "";
    this._pending = null; // { dateStr, markdown } awaiting flush
    this._saveTimer = null;
    this._saveInFlight = null;
  }

  scheduleSave(dateStr, markdown) {
    this._pending = { dateStr, markdown };
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  hasUnsavedWork() {
    return !!this._pending || !!this._saveInFlight;
  }

  async flushSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this._pending) return;
    const { dateStr, markdown } = this._pending;
    this._pending = null;
    this._saveInFlight = (async () => {
      try {
        const { logs } = this.getState();
        const dayLogs = { ...(logs[dateStr] || {}), notesMarkdown: markdown };
        appStore.updateLogForDate(dateStr, dayLogs);
        await saveForDate(dateStr, dayLogs);
      } catch (e) {
        console.error("Failed to save day notes:", e);
      } finally {
        this._saveInFlight = null;
      }
    })();
    await this._saveInFlight;
  }

  connectedCallback() {
    super.connectedCallback();

    this._onFocus = async () => {
      // Never overwrite while local typing hasn't been persisted yet.
      if (this.hasUnsavedWork()) return;

      const richEditor = this.shadowRoot.querySelector("rich-editor");
      // Defensive: if the editor diverged from notesMarkdown (e.g. a change
      // event hasn't propagated yet), treat as unsaved and skip.
      if (richEditor && richEditor.getMarkdown() !== this.notesMarkdown) return;

      const { selectedDate } = this.getState();
      const dateStr = formatDate(selectedDate);
      await appStore.refreshDay(dateStr, true);

      const { logs } = this.getState();
      const data = logs[dateStr] || {};
      const freshMarkdown = data.notesMarkdown || "";

      this.notesMarkdown = freshMarkdown;
      if (richEditor) richEditor.setValue(freshMarkdown);
    };

    globalThis.addEventListener("focus", this._onFocus);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    globalThis.removeEventListener("focus", this._onFocus);
  }

  render() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const data = logs[dateStr] || {};
    const newMarkdown = data.notesMarkdown || "";

    const dateChanged = this._lastDate !== dateStr;

    if (!this.shadowRoot.querySelector(".notes")) {
      this.display(`
          <section class="notes">
              <rich-editor autofocus></rich-editor>
          </section>
      `);

      const richEditor = this.shadowRoot.querySelector("rich-editor");
      richEditor.addEventListener("change", (e) => {
        // Capture the date at typing time so a date change mid-debounce can't
        // redirect the save to the wrong day.
        const { selectedDate: cur } = this.getState();
        const curDateStr = formatDate(cur);
        this.notesMarkdown = e.detail;
        this.scheduleSave(curDateStr, e.detail);
      });
    }

    // If the date is changing and there is unsaved work for the previous day,
    // flush it before swapping editor content so we never lose pending typing.
    if (this._lastDate && dateChanged && this._pending) {
      this.flushSave();
    }
    this._lastDate = dateStr;

    const richEditor = this.shadowRoot.querySelector("rich-editor");
    if (richEditor && (dateChanged || this.notesMarkdown === "")) {
      this.notesMarkdown = newMarkdown;
      richEditor.setValue(newMarkdown);
    }
  }
}

customElements.define("notes-input", NotesInput);
