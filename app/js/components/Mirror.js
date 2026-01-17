import { Component } from "./Base.js";

const style = /* css */ `
.mirror {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg);
    z-index: 1000;
}

.mirror video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.mirror .looking-good {
    position: absolute;
    top: 6rem;
    right: 3rem;
    transform: rotate(30deg);
    background: #4d0c66;
    padding: 2rem;
    border-radius: 10px;
    font-size: 2rem;
    color: white;
}

.hidden {
    display: none !important;
}
`;

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
