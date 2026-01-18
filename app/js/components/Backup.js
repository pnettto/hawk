import { Component } from "./Base.js";
import { backup as storageBackup } from "../utils/storage.js";
import { style } from "./Backup.styles.js";

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
