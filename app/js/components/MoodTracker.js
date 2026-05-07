import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";
import { saveForDate } from "../utils/storage.js";
import { style } from "./MoodTracker.styles.js";

class MoodTracker extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
    this.showOptions = false;
    this.logoImg = '<img src="images/logo.svg" class="logo" />';
  }

  toggleOptions() {
    this.showOptions = !this.showOptions;
    this.render();
  }

  async selectMood(emoji) {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);

    let newMood = emoji;
    if (emoji === "❌") {
      newMood = null;
    }

    const currentLog = logs[dateStr] || {};
    const updatedLog = { ...currentLog, mood: newMood };

    appStore.updateLogForDate(dateStr, { mood: newMood });
    await saveForDate(dateStr, updatedLog);

    this.showOptions = false;
    this._bumpOnNextRender = true;
    this.render();
  }

  render() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const mood = logs[dateStr]?.mood || this.logoImg;

    const content = `
      <div class="mood-tracker">
        <span class="selected ${
      this.showOptions ? "hidden" : ""
    }">${mood}</span>
        <div class="options ${this.showOptions ? "" : "hidden"}">
          <div class="options-container">
            <span class="item">🎉</span>
            <span class="item">🔥</span>
            <span class="item">😁</span>
            <span class="item">🙂</span>
            <span class="item">😐</span>
            <span class="item">🙁</span>
            <span class="item">😭</span>
            <span class="item">😴</span>
            <span class="item">❌</span>
          </div>
        </div>
      </div>
    `;

    this.display(content);

    // Add event listeners after display
    const selectedEl = this.shadowRoot.querySelector(".selected");
    if (selectedEl) {
      selectedEl.addEventListener("click", () => this.toggleOptions());
      if (this._bumpOnNextRender) {
        this._bumpOnNextRender = false;
        requestAnimationFrame(() => {
          selectedEl.classList.add("bump");
          setTimeout(() => selectedEl.classList.remove("bump"), 220);
        });
      }
    }

    this.shadowRoot.querySelectorAll(".item").forEach((item) => {
      item.addEventListener(
        "click",
        (e) => this.selectMood(e.target.innerText),
      );
    });
  }
}

customElements.define("mood-tracker", MoodTracker);
