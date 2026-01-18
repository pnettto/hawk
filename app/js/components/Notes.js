import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";
import { debounce } from "../utils/dom.js";
import { saveForDate } from "../utils/storage.js";
import "./RichEditor.js";

const style = /* css */ `
.notes {
  margin-top: 1rem;
}

rich-editor {
  width: 100%;
  min-height: 300px;
}
`;

class NotesInput extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
    this.notesMarkdown = "";
    this.debouncedSave = debounce(() => this.saveCurrentState(), 500);
  }

  connectedCallback() {
    super.connectedCallback();

    // Refresh on window focus
    this._onFocus = async () => {
      const { selectedDate } = this.getState();
      const dateStr = formatDate(selectedDate);

      // Force refresh from server
      await appStore.refreshDay(dateStr, true);

      // Update editor with fresh data
      const { logs } = this.getState();
      const data = logs[dateStr] || {};
      const freshMarkdown = data.notesMarkdown || "";

      this.notesMarkdown = freshMarkdown;
      const richEditor = this.shadowRoot.querySelector("rich-editor");
      if (richEditor) {
        richEditor.setValue(freshMarkdown);
      }
    };

    globalThis.addEventListener("focus", this._onFocus);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    globalThis.removeEventListener("focus", this._onFocus);
  }

  async saveCurrentState() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const dayLogs = { ...logs[dateStr] };

    dayLogs.notesMarkdown = this.notesMarkdown;

    appStore.updateLogForDate(dateStr, dayLogs);
    await saveForDate(dateStr, dayLogs);
  }

  render() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const data = logs[dateStr] || {};
    const newMarkdown = data.notesMarkdown || "";

    const dateChanged = this._lastDate !== dateStr;
    this._lastDate = dateStr;

    // Only render the container once
    if (!this.shadowRoot.querySelector(".notes")) {
      this.display(`
          <section class="notes">
              <rich-editor></rich-editor>
          </section>
      `);

      const richEditor = this.shadowRoot.querySelector("rich-editor");
      richEditor.addEventListener("change", (e) => {
        this.notesMarkdown = e.detail;
        this.debouncedSave();
      });
    }

    // Update editor value only if date changed or it's first load
    const richEditor = this.shadowRoot.querySelector("rich-editor");
    if (richEditor && (dateChanged || this.notesMarkdown === "")) {
      this.notesMarkdown = newMarkdown;
      richEditor.setValue(newMarkdown);
    }
  }
}

customElements.define("notes-input", NotesInput);
