import { Component } from "./Base.js";
import { backup as storageBackup } from "../utils/storage.js";

const style = /* css */ `
.backup-saved {
    position: fixed;
    top: 1rem;
    right: 2rem;
    background: var(--accent);
    color: #000;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-weight: bold;
    z-index: 3000;
    animation: fadeInOut 2s forwards;
}

@keyframes fadeInOut {
    0% { opacity: 0; transform: translateY(-10px); }
    10% { opacity: 1; transform: translateY(0); }
    90% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-10px); }
}

.hidden {
    display: none !important;
}
`;

class BackupToast extends Component {
  constructor() {
    super({ style });
    this.show = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = (e) => {
      if (Component.isTyping()) return;

      if (e.key.toLowerCase() === "b") {
        this.triggerBackup();
      }
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKeyDown);
  }

  triggerBackup() {
    storageBackup();
    this.show = true;
    this.render();
    setTimeout(() => {
      this.show = false;
      this.render();
    }, 2000);
  }

  render() {
    if (!this.show) {
      this.display("");
      return;
    }

    const content = `
      <div class="backup-saved">Backup saved!</div>
    `;

    this.display(content);
  }
}

customElements.define("backup-toast", BackupToast);
