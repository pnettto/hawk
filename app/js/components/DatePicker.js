import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate, prettyDisplay } from "../utils/date.js";
import { style } from "./DatePicker.styles.js";

class DatePicker extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
    this.showCalendar = false;
    this.calendarViewDate = new Date();
  }

  connectedCallback() {
    super.connectedCallback();
    this.calendarViewDate = new Date(this.getState().selectedDate);
    this._onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKeyDown);
  }

  onKeyDown(e) {
    if (Component.isTyping()) return;

    if (e.key === "a" || e.key === "ArrowLeft") this.goPrev();
    if (e.key === "d" || e.key === "ArrowRight") this.goNext();
    if (e.key.toLowerCase() === "t") this.goToday();
    if (e.key.toLowerCase() === "c") this.toggleCalendar();
    if (e.key === "Escape" && this.showCalendar) this.toggleCalendar();
  }

  goPrev() {
    const d = new Date(this.getState().selectedDate);
    d.setDate(d.getDate() - 1);
    appStore.setSelectedDate(d);
  }

  goNext() {
    const d = new Date(this.getState().selectedDate);
    d.setDate(d.getDate() + 1);
    appStore.setSelectedDate(d);
  }

  goToday() {
    appStore.setSelectedDate(new Date());
  }

  toggleCalendar() {
    this.showCalendar = !this.showCalendar;
    if (this.showCalendar) {
      this.calendarViewDate = new Date(this.getState().selectedDate);
    }
    this.render();
  }

  changeMonth(offset) {
    this.calendarViewDate.setMonth(this.calendarViewDate.getMonth() + offset);
    this.render();
  }

  selectDate(date) {
    appStore.setSelectedDate(date);
    this.showCalendar = false;
    this.render();
  }

  render() {
    const { selectedDate } = this.getState();
    const year = this.calendarViewDate.getFullYear();
    const month = this.calendarViewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const days = [];
    const curr = new Date(startDate);
    for (let i = 0; i < 42; i++) {
      days.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }

    const content = `
            <div class="date-control">
                <button class="cal-arrow" id="prevBtn" aria-label="Previous day">◀</button>
                <div class="date-container">
                    <button class="date-display" id="dateDisplay">${
      prettyDisplay(selectedDate)
    }</button>
                    <div class="calendar-modal ${
      this.showCalendar ? "" : "hidden"
    }">
                        <div class="calendar-header">
                            <button class="cal-arrow" id="calPrevMonth">◀</button>
                            <div class="cal-month">${
      this.calendarViewDate.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    }</div>
                            <button class="cal-arrow" id="calNextMonth">▶</button>
                        </div>
                        <div class="cal-today" id="calToday">Today</div>
                        <div class="cal-days">
                            ${
      days.map((d) => `
                                <button class="cal-day ${
        d.getMonth() !== month ? "other-month" : ""
      } ${
        formatDate(d) === formatDate(selectedDate) ? "selected" : ""
      }" data-date="${d.toISOString()}">
                                    ${d.getDate()}
                                </button>
                            `).join("")
    }
                        </div>
                    </div>
                </div>
                <button class="cal-arrow" id="nextBtn" aria-label="Next day">▶</button>
            </div>
            ${this.showCalendar ? `<div class="modal-overlay"></div>` : ""}
        `;

    this.display(content);

    // Events
    this.shadowRoot.getElementById("prevBtn").addEventListener(
      "click",
      () => this.goPrev(),
    );
    this.shadowRoot.getElementById("nextBtn").addEventListener(
      "click",
      () => this.goNext(),
    );
    this.shadowRoot.getElementById("dateDisplay").addEventListener(
      "click",
      () => this.toggleCalendar(),
    );

    if (this.showCalendar) {
      this.shadowRoot.getElementById("calPrevMonth").addEventListener(
        "click",
        () => this.changeMonth(-1),
      );
      this.shadowRoot.getElementById("calNextMonth").addEventListener(
        "click",
        () => this.changeMonth(1),
      );
      this.shadowRoot.getElementById("calToday").addEventListener(
        "click",
        () => this.goToday(),
      );
      this.shadowRoot.querySelector(".modal-overlay").addEventListener(
        "click",
        () => this.toggleCalendar(),
      );
      this.shadowRoot.querySelectorAll(".cal-day").forEach((btn) => {
        btn.addEventListener(
          "click",
          () => this.selectDate(new Date(btn.dataset.date)),
        );
      });
    }
  }
}

customElements.define("date-picker", DatePicker);
