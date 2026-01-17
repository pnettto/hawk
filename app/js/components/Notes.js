import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";
import { debounce } from "../utils/dom.js";
import { saveForDate } from "../utils/storage.js";

const style = /* css */ `
.notes {
  margin-top: 2rem;
  padding: 1rem;
}

.notes-input {
  width: 100%;
  min-height: 200px;
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.6;
  outline: none;
  white-space: pre-wrap;
  cursor: text;
}

.notes-input:empty::before {
  content: "Type a note here...";
  color: var(--muted);
}

a {
    color: var(--accent);
    text-decoration: none;
}

a:hover {
    text-decoration: underline;
}

code {
    background: var(--glass-dark);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
}
`;

class NotesInput extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
    this.notesMarkdown = "";
    this.isFocused = false;
    this.debouncedSave = debounce(() => this.saveCurrentState(), 500);
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = (e) => {
      if (Component.isTyping()) return;

      if (e.key === "n") {
        e.preventDefault();
        this.shadowRoot.querySelector(".notes-input").focus();
      }
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKeyDown);
  }

  async saveCurrentState() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const dayLogs = { ...logs[dateStr] };

    dayLogs.notesMarkdown = this.notesMarkdown;
    // We don't save the HTML version anymore, just the markdown

    appStore.updateLogForDate(dateStr, dayLogs);
    await saveForDate(dateStr, dayLogs);
  }

  handleBlur() {
    const input = this.shadowRoot.querySelector(".notes-input");
    this.notesMarkdown = input.innerHTML
      .replace(/<div>/gi, "\n")
      .replace(/<\/div>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .trim();

    this.isFocused = false;
    this.render();
    this.saveCurrentState();
  }

  handleFocus() {
    this.isFocused = true;
    const input = this.shadowRoot.querySelector(".notes-input");
    input.innerHTML = this.notesMarkdown;
  }

  handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const imageUrlPattern =
      /^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?.*)?$/i;

    let textToInsert = text;
    if (imageUrlPattern.test(text.trim())) {
      textToInsert = `![](${text.trim()})`;
    }

    const selection = this.shadowRoot.getSelection
      ? this.shadowRoot.getSelection()
      : globalThis.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(textToInsert);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  render() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const data = logs[dateStr] || {};
    this.notesMarkdown = data.notesMarkdown || "";

    const htmlContent = this.isFocused
      ? this.notesMarkdown
      : (globalThis.marked
        ? marked.parse(this.notesMarkdown)
        : this.notesMarkdown);

    this.display(`
        <section class="notes">
            <div class="notes-input" contenteditable="true">${
      htmlContent || ""
    }</div>
        </section>
    `);

    const input = this.shadowRoot.querySelector(".notes-input");
    input.onblur = () => this.handleBlur();
    input.onfocus = () => this.handleFocus();
    input.oninput = () => {
      this.notesMarkdown = input.innerHTML;
      this.debouncedSave();
    };
    input.onpaste = (e) => this.handlePaste(e);

    input.onclick = (e) => {
      const a = e.target.closest("a");
      if (a && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        globalThis.open(a.href, "_blank");
      }
    };

    if (!this.isFocused && globalThis.Prism) {
      Prism.highlightAllUnder(this.shadowRoot);
    }
  }
}

customElements.define("notes-input", NotesInput);
