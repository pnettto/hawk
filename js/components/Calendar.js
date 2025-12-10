import { formatDate } from '../utils/date.js';

/**
 * Manages the calendar modal UI for date selection.
 * Handles month navigation, date selection, and modal visibility.
 */
class Calendar {
    constructor() {
        this.calendarViewDate = new Date();
        this.selectedDate = new Date();
        this.listenersInitialized = false;
        this.isVisible = false;
    }

    /**
     * Lazy-loads and caches DOM elements.
     * Ensures elements are only queried once.
     */
    getElements() {
        return {
            modalEl: document.getElementById('calendarModal'),
            modalOverlay: document.getElementById('calendarModalOverlay'),
            monthEl: document.getElementById('calMonth'),
            daysEl: document.getElementById('calDays'),
            prevMonthBtn: document.getElementById('calPrevMonth'),
            nextMonthBtn: document.getElementById('calNextMonth'),
            todayBtn: document.getElementById('calToday'),
            dateDisplay: document.getElementById('dateDisplay')
        };
    }

    /**
     * Builds and renders the calendar grid for the current view month.
     * Creates a 6-week grid (42 days) starting from the first Sunday.
     */
    buildCalendar() {
        const { monthEl, daysEl } = this.getElements();
        if (!monthEl || !daysEl) return;

        const year = this.calendarViewDate.getFullYear();
        const month = this.calendarViewDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());

        monthEl.textContent = this.calendarViewDate.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric'
        });
        daysEl.innerHTML = '';

        let currentDate = new Date(startDate);
        for (let i = 0; i < 42; i++) {
            const day = this.createDayButton(currentDate, month);
            daysEl.appendChild(day);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    /**
     * Creates a single day button element with appropriate styling and click handler.
     */
    createDayButton(date, viewMonth) {
        const day = document.createElement('button');
        day.className = 'cal-day';
        day.textContent = date.getDate();

        if (date.getMonth() !== viewMonth) {
            day.classList.add('other-month');
        }

        if (formatDate(date) === formatDate(this.selectedDate)) {
            day.classList.add('selected');
        }

        const clickDate = new Date(date);
        day.addEventListener('click', () => {
            const event = new CustomEvent('selectNewDate', { detail: { date: clickDate } });
            document.dispatchEvent(event);
            this.close();
        });

        return day;
    }

    /**
     * Sets up event listeners for calendar controls and modal interactions.
     * Only initializes once to avoid duplicate listeners.
     */
    setupEventListeners() {
        if (this.listenersInitialized) return;

        const { modalEl, modalOverlay, prevMonthBtn, nextMonthBtn, todayBtn } = this.getElements();
        if (!modalEl) return;

        // Navigate to previous month
        prevMonthBtn?.addEventListener('click', () => {
            this.calendarViewDate.setMonth(this.calendarViewDate.getMonth() - 1);
            this.buildCalendar();
        });

        // Navigate to next month
        nextMonthBtn?.addEventListener('click', () => {
            this.calendarViewDate.setMonth(this.calendarViewDate.getMonth() + 1);
            this.buildCalendar();
        });

        // Select today and close
        todayBtn?.addEventListener('click', () => {
            const event = new CustomEvent('selectNewDate', { detail: { date: new Date() } });
            document.dispatchEvent(event);
            this.close();
        });

        // Close modal when clicking backdrop
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) {
                this.close();
            }
        });

        // Close modal when clicking outside date container
        document.addEventListener('click', (e) => {
            if (!modalEl.classList.contains('hidden') && !e.target.closest('.date-container')) {
                this.close();
            }
        });

        modalOverlay.addEventListener('click', () => {
            this.close();
        });

        document.addEventListener("keydown", (event) => {
            const active = document.activeElement;

            const isSomeInputInFocus =
                active.classList.contains("hour-input") ||
                active.closest(".notes-input") !== null;

            if (isSomeInputInFocus) return;

            if (event.key.toLocaleLowerCase() === "c") {
                if (this.isVisible) {
                    this.close()
                } else {
                    const { dateDisplay } = this.getElements()
                    dateDisplay.click();
                }
            }
        });

        document.addEventListener("keydown", (event) => {
            if (!this.isVisible) return;

            if (event.key.toLocaleLowerCase() === "escape") {
                this.close();
            }
        });

        this.listenersInitialized = true;
    }

    /**
     * Opens the calendar modal with the specified selected date.
     */
    open(currentSelectedDate) {
        const { modalEl, modalOverlay } = this.getElements();
        if (!modalEl) return;

        this.selectedDate = currentSelectedDate;
        this.calendarViewDate = new Date(currentSelectedDate);
        this.buildCalendar();
        this.isVisible = true;
        modalEl.classList.remove('hidden');
        modalOverlay.classList.remove('hidden');
    }

    /**
     * Closes the calendar modal.
     */
    close() {
        const { modalEl, modalOverlay  } = this.getElements();
        if (!modalEl) return;
        this.isVisible = false;
        modalEl.classList.add('hidden');
        modalOverlay.classList.add('hidden');
    }

    /**
     * Initializes the calendar with a date selection callback.
     * Sets up all event listeners.
     */
    init() {
        this.setupEventListeners();
    }
}

const calendarInstance = new Calendar();

export function init() {
    calendarInstance.init();
    return this;
}

export function open(currentSelectedDate) {
    calendarInstance.open(currentSelectedDate);
}

export function close() {
    calendarInstance.close();
}
