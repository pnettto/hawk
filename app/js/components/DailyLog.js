import { HOURS_END, HOURS_START } from "../global.js";
import { loadForDate, saveForDate } from "../utils/storage.js";
import { formatDate as formatDate } from "../utils/date.js";
import { debounce } from "../utils/dom.js";

/**
 * Manages the daily log UI: hourly rows with checkboxes and text inputs.
 * Handles rendering, state persistence, and user interactions.
 */
class DailyLog {
  constructor() {
    this.HOURS_START = HOURS_START;
    this.HOURS_END = HOURS_END;
    this.currentDate = null;
    this.hoursContainer = null;
    this.listenersInitialized = false;
    this.showingAllHours = false;
    this.movingFrom = null;
    this.debouncedSave = debounce(() => {
      if (this.currentDate) {
        this.saveCurrentState();
      }
    }, 1000);
  }

  /**
   * Lazy-loads and caches DOM elements.
   * Attaches notes input listener on first access.
   */
  getElements() {
    return {
      hoursContainer: document.getElementById("hoursContainer"),
    };
  }

  /**
   * Collects all hour data and notes, then persists to localStorage.
   */
  async saveCurrentState() {
    const savedData = await loadForDate(formatDate(this.currentDate));
    const { hoursContainer } = this.getElements();
    if (!hoursContainer || !this.currentDate) return;

    // Gather checkbox and input values for each hour
    const hourInputs = hoursContainer.querySelectorAll(".hour-input");

    // Prepare data structure
    const data = {};

    hourInputs.forEach((hourInput) => {
      const hour = hourInput.dataset.hour;
      const hourRow = hourInput.closest(".hour-row");
      const checkbox = hourRow.querySelector(".hour-checkbox");
      const comment = hourRow.querySelector(".hour-comment");

      data[hour] = {
        checked: checkbox?.checked || false,
        text: hourInput.value,
        comment: comment.value,
      };
    });

    const mergedData = { ...savedData, ...data };
    const cleanData = Object.fromEntries(
      Object.entries(mergedData).filter((item) => {
        const [key, value] = item;
        if (/^\d{1,2}(?:-\d{1,2})?$/.test(key)) {
          return (value.checked || value.text !== "" || value.comment !== "")
            ? item
            : false;
        }
        return item;
      }),
    );

    await saveForDate(formatDate(this.currentDate), cleanData);
    this.restoreState(cleanData);
  }

  /**
   * Restores checkboxes and text inputs from saved data.
   */
  restoreState(savedData) {
    const { hoursContainer } = this.getElements();
    if (!hoursContainer) return;

    const restoreHour = (hourKey) => {
      const state = savedData[hourKey] ||
        { checked: false, text: "", comment: "" };

      const checkbox = hoursContainer.querySelector(
        `.hour-checkbox[data-hour="${hourKey}"]`,
      );
      const input = hoursContainer.querySelector(
        `.hour-input[data-hour="${hourKey}"]`,
      );
      const comment = hoursContainer.querySelector(
        `.hour-comment[data-hour="${hourKey}"]`,
      );

      if (input) {
        input.value = state.text || "";
        input.classList.toggle("not-empty", state.text !== "");
      }

      if (checkbox) checkbox.checked = !!state.checked;

      if (comment) {
        if (state.comment !== "") {
          const commentSwitch = hoursContainer.querySelector(
            `.hour-comment-switch[data-hour="${hourKey}"]`,
          );
          commentSwitch.classList.add("not-empty");
          comment.value = state.comment || "";
        }
      }
    };

    for (let hour = this.HOURS_START; hour <= this.HOURS_END; hour++) {
      restoreHour(hour); // full hour
      restoreHour(`${hour}-30`); // mid-hour
    }
  }

  /**
   * Generates HTML for a single hour row.
   * Highlights the row if it matches the current hour today.
   */
  createRowHTML(hour, minutes, selectedDate) {
    const timeDisplay = new Date();
    timeDisplay.setHours(hour, minutes, 0, 0);
    const timeText = timeDisplay.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    );

    // Highlight current hour if viewing today
    const now = new Date();
    const isSameDay =
      now.toLocaleDateString() === selectedDate.toLocaleDateString();
    const isCurrentHour = now.getHours() === hour;
    const isCurrentMinute = minutes === 0
      ? now.getMinutes() < 30
      : now.getMinutes() >= 30;
    const isHighlightedHour = isSameDay && isCurrentHour && isCurrentMinute;
    const hourStr = `${hour}${minutes !== 0 ? ("-" + minutes) : ""}`;

    return `
        <div class="hour-row ${isHighlightedHour ? "highlighted" : ""}">
            <div class="hour-time">${timeText}</div>
            <button class="hour-comment-switch" data-hour="${hourStr}">💬</button>
            <div class="hour-checkbox-wrap">
                <input type="checkbox" class="hour-checkbox" data-hour="${hourStr}" />
            </div>
            <input class="hour-input" data-hour="${hourStr}" />
            <textarea class="hour-comment hidden" data-hour="${hourStr}"></textarea>
        </div>
        `;
  }

  /**
   * Builds HTML for all hour rows between HOURS_START and HOURS_END.
   */
  buildRowsHTML(date) {
    let html = "";
    for (let hour = this.HOURS_START; hour <= this.HOURS_END; hour++) {
      html += this.createRowHTML(hour, 0, date);
      html += this.createRowHTML(hour, 30, date);
    }
    return html;
  }

  #handleCutOrCopy = (e) => {
    if (e.target.matches(".hour-input")) {
      const input = e.target;
      if (
        input.selectionStart === 0 &&
        input.selectionEnd === input.value.length &&
        input.value !== ""
      ) {
        const hourRow = input.closest(".hour-row");
        const comment = hourRow.querySelector(".hour-comment");
        const checkbox = hourRow.querySelector(".hour-checkbox");
        const commentSwitch = hourRow.querySelector(".hour-comment-switch");

        const data = {
          text: input.value,
          comment: comment.value,
          checkbox: checkbox.checked,
        };

        console.log(`data`, data);

        // External format: Text + optional comment on new line
        const externalText = data.comment
          ? `${data.text}\n${data.comment}`
          : data.text;

        e.clipboardData.setData("text/plain", externalText);
        e.clipboardData.setData(
          "application/hawk-hour",
          JSON.stringify(data),
        );
        e.preventDefault();

        if (e.type === "cut") {
          comment.value = "";
          commentSwitch.classList.remove("not-empty");

          if (checkbox.checked) {
            checkbox.checked = false;
          }

          input.value = "";
          input.classList.remove("not-empty");
          this.debouncedSave();
        }
      }
    }
  };

  /**
   * Sets up event delegation on the hours container.
   * Checkboxes save immediately, text inputs save with debounce.
   */
  setupEventListeners() {
    const { hoursContainer } = this.getElements();
    if (!hoursContainer || this.listenersInitialized) return;

    // Checkbox changes save immediately
    hoursContainer.addEventListener("change", (e) => {
      if (e.target.matches(".hour-checkbox")) {
        this.saveCurrentState();
      }
    });

    // Text input changes save with debounce
    hoursContainer.addEventListener("input", (e) => {
      if (
        e.target.matches(".hour-comment") ||
        e.target.matches(".hour-input")
      ) {
        this.debouncedSave();

        if (e.target.matches(".hour-comment")) {
          const commentSwitch = e.target.closest(".hour-row").querySelector(
            ".hour-comment-switch",
          );
          commentSwitch.classList.toggle("not-empty", e.target.value !== "");
        }

        if (e.target.matches(".hour-input")) {
          e.target.classList.toggle("not-empty", e.target.value !== "");
        }
      }
    });

    hoursContainer.addEventListener("focusout", (e) => {
      if (
        e.target.matches(".hour-comment") ||
        e.target.matches(".hour-input")
      ) {
        this.debouncedSave();
      }

      if (e.target.matches(".hour-comment")) {
        const hourComment = e.target;
        hourComment.classList.toggle("hidden");

        const commentSwitch = hourComment.closest(".hour-row").querySelector(
          ".hour-comment-switch",
        );
        commentSwitch.classList.toggle("not-empty", e.target.value !== "");
      }
    });

    hoursContainer.addEventListener("cut", this.#handleCutOrCopy);
    hoursContainer.addEventListener("copy", this.#handleCutOrCopy);

    hoursContainer.addEventListener("paste", (e) => {
      if (e.target.matches(".hour-input")) {
        const jsonData = e.clipboardData.getData("application/hawk-hour");
        if (jsonData) {
          try {
            const data = JSON.parse(jsonData);
            const hourRow = e.target.closest(".hour-row");
            const comment = hourRow.querySelector(".hour-comment");
            const commentSwitch = hourRow.querySelector(".hour-comment-switch");
            const checkbox = hourRow.querySelector(".hour-checkbox");

            e.target.value = data.text;
            comment.value = data.comment;
            checkbox.checked = data.checkbox;
            commentSwitch.classList.toggle("not-empty", comment.value !== "");
            e.target.classList.add("not-empty");

            e.preventDefault();
            this.debouncedSave();
          } catch (err) {
            console.error("Failed to parse hawk-log data", err);
          }
        }
      }
    });

    hoursContainer.addEventListener("click", (e) => {
      if (e.target.matches(".hour-comment-switch")) {
        const hourComment = e.target.closest(".hour-row").querySelector(
          ".hour-comment",
        );
        hourComment.classList.toggle("hidden");
      }

      if (e.target.matches(".hour-time")) {
        const hourRow = e.target.closest(".hour-row");
        const hour = hourRow.querySelector(".hour-input").dataset.hour;

        if (this.movingFrom) {
          // Just return if clicked hour is source
          if (this.movingFrom === hour) {
            this.movingFrom = null;
            this.updateMovingUI();
            return;
          }

          const targetInput = hourRow.querySelector(".hour-input");
          const targetComment = hourRow.querySelector(".hour-comment");
          const isTargetEmptySlot = targetInput.value.trim() === "" &&
            targetComment.value.trim() === "";

          if (isTargetEmptySlot) {
            // Move data, update UI
            this.moveData(this.movingFrom, hour);
            this.movingFrom = null;
            this.updateMovingUI();
          } else {
            // Switch source if clicking another occupied slot, udpate UI
            this.movingFrom = hour;
            this.updateMovingUI();
          }
        } else {
          // Show options on screen
          const sourceInput = hourRow.querySelector(".hour-input");
          const sourceComment = hourRow.querySelector(".hour-comment");
          if (
            sourceInput.value.trim() !== "" || sourceComment.value.trim() !== ""
          ) {
            this.movingFrom = hour;
            this.updateMovingUI();
          }
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      const active = document.activeElement;
      const isTyping = active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable;
      if (isTyping) return;

      if (event.key.toLocaleLowerCase() === "w") this.goUp();
      if (event.key.toLocaleLowerCase() === "s") this.goDown();
      if (event.key.toLocaleLowerCase() === "f") this.toggleShowMostHours();
    });

    document.addEventListener("newDateSelected", (e) => {
      this.render(e.detail.date);
    });

    this.listenersInitialized = true;
  }

  goUp() {
    if (this.HOURS_START === 1) return;
    this.HOURS_START -= 1;
    this.HOURS_END -= 1;
    this.render(this.currentDate);
  }

  goDown() {
    if (this.HOURS_END === 23) return;
    this.HOURS_START += 1;
    this.HOURS_END += 1;
    this.render(this.currentDate);
  }

  toggleShowMostHours() {
    if (this.showingAllHours) {
      this.HOURS_START = HOURS_START;
      this.HOURS_END = HOURS_END;
      this.showingAllHours = false;
    } else {
      this.HOURS_START = 7;
      this.HOURS_END = 20;
      this.showingAllHours = true;
    }

    this.render(this.currentDate);
  }

  updateMovingUI() {
    const { hoursContainer } = this.getElements();
    const rows = hoursContainer.querySelectorAll(".hour-row");

    rows.forEach((row) => {
      const hour = row.querySelector(".hour-input").dataset.hour;
      const input = row.querySelector(".hour-input");
      const commentTextarea = row.querySelector(".hour-comment");

      row.classList.toggle("moving-source", this.movingFrom === hour);
      row.classList.toggle(
        "moving-target",
        this.movingFrom && this.movingFrom !== hour && input.value === "" &&
          commentTextarea.value === "",
      );
    });
  }

  moveData(fromHour, toHour) {
    const { hoursContainer } = this.getElements();
    if (!hoursContainer) return;

    const sourceInput = hoursContainer.querySelector(
      `.hour-input[data-hour="${fromHour}"]`,
    );
    const targetInput = hoursContainer.querySelector(
      `.hour-input[data-hour="${toHour}"]`,
    );

    const sourceRow = sourceInput.closest(".hour-row");
    const sourceComment = sourceRow.querySelector(".hour-comment");
    const sourceCheckbox = sourceRow.querySelector(".hour-checkbox");

    const targetRow = targetInput.closest(".hour-row");
    const targetComment = targetRow.querySelector(".hour-comment");
    const targetCheckbox = targetRow.querySelector(".hour-checkbox");

    targetInput.value = sourceInput.value;
    targetComment.value = sourceComment.value;
    targetCheckbox.checked = sourceCheckbox.checked;

    sourceInput.value = "";
    sourceComment.value = "";
    sourceCheckbox.checked = false;

    // Update UI
    targetInput.classList.toggle("not-empty", targetInput.value !== "");
    sourceInput.classList.remove("not-empty");

    const targetSwitch = targetRow.querySelector(".hour-comment-switch");
    const sourceSwitch = sourceRow.querySelector(".hour-comment-switch");
    targetSwitch.classList.toggle("not-empty", targetComment.value !== "");
    sourceSwitch.classList.remove("not-empty");

    this.saveCurrentState();
  }

  /**
   * Main render method: builds UI, restores state, and sets up listeners.
   */
  render(date) {
    const { hoursContainer } = this.getElements();
    if (!hoursContainer) return;

    this.currentDate = date;
    this.movingFrom = null;

    loadForDate(formatDate(date))
      .then((savedData) => {
        hoursContainer.innerHTML = this.buildRowsHTML(date);
        if (savedData) {
          this.restoreState(savedData);
        }
      });

    hoursContainer.innerHTML = this.buildRowsHTML(date);
    this.setupEventListeners();
  }
}

const dailyLogInstance = new DailyLog();

export function init() {
  dailyLogInstance.render(globalThis.selectedDate);
}
