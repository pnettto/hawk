import { Component } from "./Base.js";

const style = /* css */ `
.shortcuts-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 8px 40px rgba(2, 6, 8, 0.8);
    z-index: 1000;
}

.shortcuts-trigger {
    position: fixed;
    right: 0.5rem;
    bottom: 0.5rem;
    padding: 0.5rem;
    color: var(--accent);
    cursor: pointer;
    z-index: 900;
}

.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0,0,0,0.5);
    z-index: 999;
}

table {
    width: 100%;
    border-collapse: collapse;
}

th, td {
    text-align: left;
    padding: 0.5rem;
    border-bottom: 1px solid var(--line);
}

.hidden {
    display: none !important;
}
`;

class ShortcutsModal extends Component {
  constructor() {
    super({ style });
    this.isVisible = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = (e) => {
      if (Component.isTyping()) return;

      if (e.key === "?") this.toggle();
      if (e.key === "Escape" && this.isVisible) this.toggle();
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKeyDown);
  }

  toggle() {
    this.isVisible = !this.isVisible;
    this.render();
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

  render() {
    const content = `
      <div class="shortcuts-trigger">?</div>
      <div class="modal-overlay ${this.isVisible ? "" : "hidden"}"></div>
      <div class="shortcuts-modal ${this.isVisible ? "" : "hidden"}">
        ${
      globalThis.marked
        ? marked.parse(this.getContent())
        : "<pre>" + this.getContent() + "</pre>"
    }
      </div>
    `;

    this.display(content);

    this.shadowRoot.querySelector(".shortcuts-trigger").onclick = () =>
      this.toggle();
    this.shadowRoot.querySelector(".modal-overlay").onclick = () =>
      this.toggle();
  }
}

customElements.define("shortcuts-modal", ShortcutsModal);
