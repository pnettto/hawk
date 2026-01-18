import { Component } from "./Base.js";
import { style } from "./Mirror.styles.js";

class MirrorMode extends Component {
  constructor() {
    super({ style });
    this.isActive = false;
    this.currentStream = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = (e) => {
      if (Component.isTyping()) return;

      if (e.key.toLowerCase() === "m") {
        this.toggle();
      }
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKeyDown);
    this.stopStream();
  }

  async toggle() {
    this.isActive = !this.isActive;
    if (this.isActive) {
      try {
        this.currentStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        this.render();
        const video = this.shadowRoot.querySelector("video");
        if (video) video.srcObject = this.currentStream;
      } catch (err) {
        console.error("Error accessing webcam:", err);
        this.isActive = false;
        this.render();
      }
    } else {
      this.stopStream();
      this.render();
    }
  }

  stopStream() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop());
      this.currentStream = null;
    }
  }

  render() {
    if (!this.isActive) {
      this.display("");
      return;
    }

    const content = `
      <div class="mirror">
        <video autoplay playsinline></video>
        <div class="looking-good">Looking good! 😍</div>
      </div>
    `;

    this.display(content);

    // If we already have a stream when rendering (e.g. after toggle)
    if (this.currentStream) {
      const video = this.shadowRoot.querySelector("video");
      if (video) video.srcObject = this.currentStream;
    }

    this.shadowRoot.onclick = () => this.toggle();
  }
}

customElements.define("mirror-mode", MirrorMode);
