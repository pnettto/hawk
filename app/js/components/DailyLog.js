import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";

import {
  HOURS_END as DEFAULT_END,
  HOURS_START as DEFAULT_START,
} from "../global.js";
import { saveForDate } from "../utils/storage.js";

const isVisuallyEmpty = (html) => {
  if (!html) return true;
  return html
    .replace(/<(div|p)><br><\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/g, "")
    .trim() === "";
};

const style = /* css */ `
.hours {
  display: flex;
  flex-direction: column;
  margin-bottom: 2rem;
  gap: 0.25rem;
}

.hour-row {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.25rem;
  padding: 0.5rem;
}

@media (max-width: 480px) {
  .hour-row {
      grid-template-columns: auto minmax(0, 1fr);
      padding: 0.4rem 0.2rem;
      gap: 0.1rem;
  }
}

.hour-row.not-empty {
  background-color: var(--glass-dark);
  border-radius: 0.25rem;
}

.hour-time {
  color: var(--muted);
  text-align: right;
  font-size: 0.8rem;
  padding: 0.35rem 0.2rem;
  cursor: pointer;
  user-select: none;
  opacity: 0.5;
}

@media (max-width: 480px) {
    .hour-time {
        font-size: 0.75rem;
        padding: 0.5rem 0.1rem;
    }
}

.hour-row.moving-source .hour-time {
  background-color: var(--accent);
  color: #022;
  border-radius: 4px;
}

.hour-row.moving-target .hour-time {
  color: var(--accent);
}

.hour-row.moving-target .hour-time:hover {
  text-decoration: underline;
}

.hour-row .hour-controls {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: start;
}

.hour-text-content {
  display:flex;
  flex-direction: column;
}

.hour-comment-switch {
  font-size: 0.8rem;
  background: none;
  padding: 0.4rem;
  border: none;
  cursor: pointer;
  opacity: 0.2;
  padding-top: 0.35rem;
  min-width: 2rem;
  min-height: 2rem;
}

@media (max-width: 480px) {
    .hour-comment-switch {
        padding: 0.5rem;
    }
}

.hour-row.is-comment .hour-comment-switch {
  opacity: 0.6;
}

.hour-checkbox-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.8rem;
  padding-top: 0.5rem;
  min-width: 2rem;
}

@media (max-width: 480px) {
    .hour-checkbox-wrap {
        padding: 0.6rem 0.4rem;
    }
}

.hour-checkbox {
  appearance: none;
  width: 0.75rem;
  height: 0.75rem;
  margin: 0;
  border-radius: 50%;
  background: var(--glass);
  cursor: pointer;
  position: relative;
  transition: all 0.18s ease;
}

@media (max-width: 480px) {
    .hour-checkbox {
        width: 0.9rem;
        height: 0.9rem;
    }
}

.hour-checkbox:checked {
  background: var(--accent);
  border: 0;
}

.hour-input,
.hour-comment {
  border: 0;
  background: transparent;
  padding: 0 0.5rem;
  font-size: 1rem;
  color: inherit;
  line-height: 1.9;
  outline: none;
  cursor: pointer;
}

@media (max-width: 480px) {
    .hour-input {
        padding: 0 0.25rem;
        font-size: 0.95rem;
    }
}

.hour-input:focus, .hour-comment:focus {
  cursor: text;
}

.hour-comment {
  margin-top: 0.5rem;
  font-size: 1rem;
  min-height: 3rem;
  opacity: 0.6;
  white-space: pre-wrap;
}

.hour-comment-clear {
  font-size: 0.5rem;
  background: none;
  padding: 0.4rem;
  border: none;
  cursor: pointer;
  opacity: 0.2;
  min-width: 2rem;
  min-height: 2rem;
}

.hour-comment-clear:hover {
  opacity: 1; 
}

.highlighted .hour-time {
  color: var(--accent);
}

.highlighted {
  color: var(--accent);
}

.hidden {
    display: none !important;
}
`;

class DailyLog extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
    this.HOURS_START = DEFAULT_START;
    this.HOURS_END = DEFAULT_END;
    this.showingAllHours = false;
    this.movingFrom = null;
    this.openComments = new Set();
    // this.isSaving is managed by Base

    this.debouncedSave = this.wrapDebouncedSave(
      () => this.saveCurrentState(),
      1000,
    );
  }

  connectedCallback() {
    super.connectedCallback();
    this.initSavingState();
    this._onKeyDown = (e) => {
      // ... no changes to key handler
      if (Component.isTyping()) return;

      if (e.key.toLowerCase() === "w") this.goUp();
      if (e.key.toLowerCase() === "s") this.goDown();
      if (e.key.toLowerCase() === "f") this.toggleShowMostHours();
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardownSavingState();
    document.removeEventListener("keydown", this._onKeyDown);
  }

  async saveCurrentState() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const rows = this.shadowRoot.querySelectorAll(".hour-row");

    const dayLogs = { ...logs[dateStr] };

    rows.forEach((row) => {
      const hour = row.dataset.hour;
      const checked = row.querySelector(".hour-checkbox").checked;
      const text = row.querySelector(".hour-input").value;
      const comment = row.querySelector(".hour-comment").innerHTML;

      dayLogs[hour] = { checked, text, comment };
    });

    const cleanData = Object.fromEntries(
      Object.entries(dayLogs).filter(([key, value]) => {
        if (/^\d{1,2}(?:-\d{1,2})?$/.test(key)) {
          return (value.checked || value.text !== "" ||
            !isVisuallyEmpty(value.comment));
        }
        return true;
      }),
    );

    appStore.updateLogForDate(dateStr, cleanData);
    await saveForDate(dateStr, cleanData);
  }

  goUp() {
    if (this.HOURS_START === 1) return;
    this.HOURS_START -= 1;
    this.HOURS_END -= 1;
    this.render();
  }

  goDown() {
    if (this.HOURS_END === 23) return;
    this.HOURS_START += 1;
    this.HOURS_END += 1;
    this.render();
  }

  toggleShowMostHours() {
    if (this.showingAllHours) {
      this.HOURS_START = DEFAULT_START;
      this.HOURS_END = DEFAULT_END;
      this.showingAllHours = false;
    } else {
      this.HOURS_START = 7;
      this.HOURS_END = 20;
      this.showingAllHours = true;
    }
    this.render();
  }

  moveData(fromHour, toHour) {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const dayLogs = { ...logs[dateStr] };

    dayLogs[toHour] = dayLogs[fromHour];
    delete dayLogs[fromHour];

    appStore.updateLogForDate(dateStr, dayLogs);
    saveForDate(dateStr, dayLogs);
    this.movingFrom = null;
    this.render();
  }

  render() {
    const { selectedDate, logs } = this.getState();
    const dateStr = formatDate(selectedDate);
    const dayLogs = logs[dateStr] || {};
    const now = new Date();
    const isToday = formatDate(now) === dateStr;

    let rowsHtml = "";
    for (let h = this.HOURS_START; h <= this.HOURS_END; h++) {
      [0, 30].forEach((m) => {
        const hourStr = `${h}${m !== 0 ? "-30" : ""}`;
        const state = dayLogs[hourStr] ||
          { checked: false, text: "", comment: "" };
        const isCurrent = isToday && now.getHours() === h &&
          (m === 0 ? now.getMinutes() < 30 : now.getMinutes() >= 30);
        const timeText = `${h.toString().padStart(2, "0")}:${
          m.toString().padStart(2, "0")
        }`;

        rowsHtml += `
            <div class="hour-row ${isCurrent ? "highlighted" : ""} ${
          state.text || !isVisuallyEmpty(state.comment) ? "not-empty" : ""
        } ${!isVisuallyEmpty(state.comment) ? "is-comment" : ""} ${
          this.movingFrom === hourStr ? "moving-source" : ""
        } ${
          this.movingFrom && this.movingFrom !== hourStr && !state.text &&
            isVisuallyEmpty(state.comment)
            ? "moving-target"
            : ""
        }" data-hour="${hourStr}">
                <div class="hour-time">${timeText}</div>
                <div class="hour-controls">
                    <button class="hour-comment-switch">💬</button>
                    <div class="hour-checkbox-wrap">
                        <input type="checkbox" class="hour-checkbox" ${
          state.checked ? "checked" : ""
        } />
                    </div>
                    <div class="hour-text-content">
                        <input class="hour-input" value="${state.text || ""}" />
                        <div class="hour-comment ${
          this.openComments.has(hourStr) ? "" : "hidden"
        }" contenteditable="true">${state.comment || ""}</div>
                    </div>
                    <button class="hour-comment-clear">✖️</button>
                </div>
            </div>`;
      });
    }

    this.display(
      `${this.savingIndicatorHTML}<div class="hours">${rowsHtml}</div>`,
    );

    // Listeners
    this.shadowRoot.querySelectorAll(".hour-row").forEach((row) => {
      const hour = row.dataset.hour;
      const input = row.querySelector(".hour-input");
      const comment = row.querySelector(".hour-comment");
      const checkbox = row.querySelector(".hour-checkbox");
      const time = row.querySelector(".hour-time");

      input.oninput = () => {
        row.classList.toggle(
          "not-empty",
          input.value !== "" || !isVisuallyEmpty(comment.innerHTML),
        );
        this.debouncedSave();
      };
      comment.oninput = () => {
        row.classList.toggle(
          "not-empty",
          input.value !== "" || !isVisuallyEmpty(comment.innerHTML),
        );
        row.classList.toggle("is-comment", !isVisuallyEmpty(comment.innerHTML));
        this.debouncedSave();
      };
      checkbox.onchange = () => this.debouncedSave();

      row.querySelector(".hour-comment-switch").onclick = () => {
        if (this.openComments.has(hour)) this.openComments.delete(hour);
        else this.openComments.add(hour);
        comment.classList.toggle("hidden");
      };

      row.querySelector(".hour-comment-clear").onclick = async () => {
        if (confirm("Clear this hour?")) {
          // Clear UI
          input.value = "";
          comment.innerHTML = "";
          checkbox.checked = false;
          row.classList.remove("not-empty", "is-comment");

          // Immediately update state
          const { selectedDate, logs } = this.getState();
          const dateStr = formatDate(selectedDate);
          const dayLogs = { ...logs[dateStr] };

          // Remove this hour's data
          delete dayLogs[hour];

          // Update store and save
          appStore.updateLogForDate(dateStr, dayLogs);
          await saveForDate(dateStr, dayLogs);
        }
      };

      time.onclick = () => {
        if (this.movingFrom) {
          if (this.movingFrom === hour) {
            this.movingFrom = null;
          } else if (!input.value && isVisuallyEmpty(comment.innerHTML)) {
            this.moveData(this.movingFrom, hour);
          } else {
            this.movingFrom = hour;
          }
        } else if (input.value || !isVisuallyEmpty(comment.innerHTML)) {
          this.movingFrom = hour;
        }
        this.render();
      };

      // Handle Paste
      input.onpaste = (e) => {
        const jsonData = e.clipboardData.getData("application/hawk-hour");
        if (jsonData) {
          try {
            const data = JSON.parse(jsonData);
            input.value = data.text;
            comment.innerHTML = data.comment;
            checkbox.checked = data.checkbox;
            row.classList.toggle(
              "not-empty",
              input.value !== "" || !isVisuallyEmpty(comment.innerHTML),
            );
            row.classList.toggle(
              "is-comment",
              !isVisuallyEmpty(comment.innerHTML),
            );
            e.preventDefault();
            this.debouncedSave();
          } catch (_err) {
            // ignore invalid JSON
          }
        }
      };

      // Handle Cut/Copy
      const handleCopy = (e) => {
        if (
          input.selectionStart === 0 &&
          input.selectionEnd === input.value.length && input.value !== ""
        ) {
          const data = {
            text: input.value,
            comment: comment.innerHTML,
            checkbox: checkbox.checked,
          };
          const externalText = data.comment
            ? `${data.text}\n${data.comment.replace(/<[^>]*>/g, "")}`
            : data.text;
          e.clipboardData.setData("text/plain", externalText);
          e.clipboardData.setData(
            "application/hawk-hour",
            JSON.stringify(data),
          );
          e.preventDefault();
          if (e.type === "cut") {
            input.value = "";
            comment.innerHTML = "";
            checkbox.checked = false;
            row.classList.remove("not-empty", "is-comment");
            this.debouncedSave();
          }
        }
      };
      input.oncut = handleCopy;
      input.oncopy = handleCopy;
    });
  }
}

customElements.define("daily-log", DailyLog);
