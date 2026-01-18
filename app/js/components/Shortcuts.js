import { Component } from "./Base.js";
import { style } from "./Shortcuts.styles.js";

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
