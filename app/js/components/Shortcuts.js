class Shortcuts {
  constructor() {
    this.shortcutsModal = undefined;
    this.modalOverlay = undefined;
    this.listenersInitialized = false;
    this.isVisible = false;
  }

  getContent() {
    return `
| Shortcut         | Action                         |
|------------------|--------------------------------|
| t                | Show today                     |
| w                | Move hours up                  |
| s                | Move hours down                |
| a / ←            | Move to previous day           |
| d / →            | Move to next day               |
| f                | Show full day                  |
| c                | Open calendar                  |
| n                | Go to notes                   |
| Cmd/Ctrl + s     | Save notes (while editing)     |
| z                | Enter Zen Mode                 |
| m                | Enter Mirror Mode 😍           |
| b                | Backup data                    |
| ?                | Show shortcuts                 |
`;
  }

  getElements() {
    return {
      shortcutsModal: document.getElementById("shortcutsModal"),
      modalOverlay: document.getElementById("shortcutsModalOverlay"),
      shortcutsTrigger: document.getElementById("shortcutsTrigger"),
    };
  }

  toggleVisibility() {
    const { shortcutsModal, modalOverlay } = this.getElements();

    this.isVisible = !this.isVisible;
    shortcutsModal.classList.toggle("hidden");
    modalOverlay.classList.toggle("hidden");
  }

  setupListeners() {
    if (this.listenersInitialized) return;

    const { shortcutsModal, modalOverlay, shortcutsTrigger } = this
      .getElements();

    document.addEventListener("keydown", (event) => {
      const active = document.activeElement;
      const isTyping = active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable;
      if (isTyping) return;

      if (event.key === "?") {
        this.toggleVisibility();
      }
    });

    document.addEventListener("DOMContentLoaded", () => {
      const content = this.getContent();
      shortcutsModal.innerHTML = marked.parse(content);
    });

    modalOverlay.addEventListener("click", () => {
      this.toggleVisibility();
    });

    document.addEventListener("keydown", (event) => {
      if (!this.isVisible) return;

      if (event.key.toLocaleLowerCase() === "escape") {
        this.toggleVisibility();
      }
    });

    shortcutsTrigger.addEventListener("click", () => {
      this.toggleVisibility();
    });

    this.listenersInitialized = true;
  }

  init() {
    this.setupListeners();
  }
}

const shortcuts = new Shortcuts();

export function init() {
  shortcuts.init();
}
