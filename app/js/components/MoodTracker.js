import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";
import { saveForDate } from "../utils/storage.js";

const style = /* css */ `
.mood-tracker {
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 1.5rem;  
  height: 2rem;
}

.mood-tracker .selected {
  cursor: pointer;
}

.mood-tracker .options-container {
  display:flex;
}

.mood-tracker .options .item {
  cursor: pointer;
  padding: 0 0.2rem;
  transition: transform 0.2s ease;
}

.mood-tracker .options .item:hover {
  transform: scale(1.2);
}

.hidden {
    display: none !important;
}

.logo {
    width: 2rem;
    height: 2rem;
}
`;

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
      selectedEl.onclick = () => this.toggleOptions();
    }

    this.shadowRoot.querySelectorAll(".item").forEach((item) => {
      item.onclick = (e) => this.selectMood(e.target.innerText);
    });
  }
}

customElements.define("mood-tracker", MoodTracker);
