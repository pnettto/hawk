import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate, prettyDisplay } from "../utils/date.js";

const style = /* css */ `
.date-control {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 18px;
}

.date-container {
    position: relative;
    min-width: 9rem;
}

.date-display {
    background: transparent;
    border: none;
    color: var(--accent);
    width: 100%;
    padding: 10px 18px;
    border-radius: 10px;
    cursor: pointer;
    font-weight: normal;
    font-family: inherit;
    font-size: 1rem;
}

.date-display:focus {
    outline: none;
}

.calendar-modal {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 8px 40px rgba(2, 6, 8, 0.8);
    z-index: 1000;
}

.calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.cal-month {
    font-size: 1rem;
    color: var(--accent);
    flex: 1;
    text-align: center;
}

.cal-arrow {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    font-size: 1.25rem;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
}

.cal-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
}

.cal-day {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background-color .12s ease;
}

.cal-day:hover {
    background-color: var(--glass);
}

.cal-day.other-month {
    color: var(--muted);
    opacity: 0.4;
}

.cal-day.selected {
    background: linear-gradient(180deg, var(--accent), #fff076);
    color: #000;
    border: 0;
    font-weight: bold;
}

.cal-today {
    font-size: 1rem;
    color: var(--accent);
    flex: 1;
    text-align: center;
    cursor: pointer;
    margin: 0.5rem 0;
}

.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: transparent;
    z-index: 999;
}

.hidden {
    display: none !important;
}
`;

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
    this.shadowRoot.getElementById("prevBtn").onclick = () => this.goPrev();
    this.shadowRoot.getElementById("nextBtn").onclick = () => this.goNext();
    this.shadowRoot.getElementById("dateDisplay").onclick = () =>
      this.toggleCalendar();

    if (this.showCalendar) {
      this.shadowRoot.getElementById("calPrevMonth").onclick = () =>
        this.changeMonth(-1);
      this.shadowRoot.getElementById("calNextMonth").onclick = () =>
        this.changeMonth(1);
      this.shadowRoot.getElementById("calToday").onclick = () => this.goToday();
      this.shadowRoot.querySelector(".modal-overlay").onclick = () =>
        this.toggleCalendar();
      this.shadowRoot.querySelectorAll(".cal-day").forEach((btn) => {
        btn.onclick = () => this.selectDate(new Date(btn.dataset.date));
      });
    }
  }
}

customElements.define("date-picker", DatePicker);
