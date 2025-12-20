import { loadForDate, saveForDate } from "../utils/storage.js";
import { formatDate as formatDate } from "../utils/date.js";
import { debounce } from "../utils/dom.js";

class Notes {
  constructor() {
    this.listenersInitiated = false;
    this.currentDate = null;
    this.notesMarkdown = "";
    this.defaultText = "Type a note here...";
    this.debouncedSave = debounce(() => {
      if (this.currentDate) {
        this.saveCurrentState();
      }
    }, 500);
  }

  getElements() {
    return {
      notesInput: document.getElementById("notesInput"),
    };
  }

  async saveCurrentState() {
    const { notesInput } = this.getElements();
    const newData = {
      notes: notesInput?.innerHTML || "",
      notesMarkdown: this.notesMarkdown,
    };
    const savedData = await loadForDate(formatDate(this.currentDate));
    const mergedData = { ...savedData, ...newData };

    saveForDate(formatDate(this.currentDate), mergedData);
  }

  setupListeners() {
    if (this.listenersInitiated) return;

    const { notesInput } = this.getElements();

    notesInput.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (!a) return;

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        globalThis.open(a.href, "_blank");
      }
    });

    notesInput.addEventListener("input", () => {
      this.debouncedSave();
    });

    // Focus: show markdown
    notesInput.addEventListener("focus", () => {
      notesInput.innerHTML = this.notesMarkdown;
    });

    // Blur: parse and show HTML
    notesInput.addEventListener("blur", () => {
      let notesMarkdown = notesInput.innerHTML
        .replace(/<div>/gi, "\n")
        .replace(/<\/div>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .trim();

      this.notesMarkdown = notesMarkdown;
      notesInput.innerHTML = marked.parse(this.notesMarkdown) ||
        this.defaultText;

      if (globalThis.Prism) {
        Prism.highlightAllUnder(notesInput);
      }

      this.saveCurrentState();
    });

    // Paste: convert image URLs to markdown format
    notesInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");

      // Check if it's an image URL
      const imageUrlPattern =
        /^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?.*)?$/i;

      let textToInsert = text;
      if (imageUrlPattern.test(text.trim())) {
        // Convert to markdown image
        textToInsert = `![](${text.trim()})`;
      }

      // Insert text at cursor position
      const selection = globalThis.getSelection();
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
    });

    document.addEventListener("keydown", (e) => {
      const { notesInput } = this.getElements();
      const isEnter = e.key.toLocaleLowerCase() == "enter";
      const isCtrl = e.ctrlKey || e.metaKey;
      const isSKey = e.key.toLowerCase() == "s";
      const isNotesInputFocused = notesInput == document.activeElement;

      if (isNotesInputFocused && isCtrl && isSKey) {
        e.preventDefault();
        notesInput.blur();
      }
    });

    notesInput.addEventListener("mousedown", (e) => {
      const a = e.target.closest("a");
      if (!a) return;

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault(); // Block focus
      }
    });

    document.addEventListener("keydown", (event) => {
      const active = document.activeElement;

      const isSomeInputInFocus = active.classList.contains("hour-input") ||
        active.closest(".notes-input") !== null;

      if (isSomeInputInFocus) return;

      if (event.key === "n") {
        event.preventDefault();
        notesInput.focus();
      }
    });

    document.addEventListener("newDateSelected", (e) => {
      this.currentDate = e.detail.date;
      this.render(e.detail.date);
    });

    this.listenersInitiated = true;
  }

  render(date) {
    this.currentDate = date;
    const { notesInput } = this.getElements();
    loadForDate(formatDate(date))
      .then((savedData) => {
        if (!savedData) return;
        this.notesMarkdown = savedData.notesMarkdown || "";
        notesInput.innerHTML = this.notesMarkdown
          ? marked.parse(this.notesMarkdown)
          : this.defaultText;
      });
    this.setupListeners();
  }
}

const notes = new Notes();

export function init() {
  notes.render(globalThis.selectedDate);
}
