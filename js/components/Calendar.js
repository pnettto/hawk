import { formatDate } from '../utils/date.js';

/**
 * Manages the calendar modal UI for date selection.
 * Handles month navigation, date selection, and modal visibility.
 */
class Calendar {
    constructor() {
        this.calendarViewDate = new Date();
        this.selectedDate = new Date();
        this.onSelectCallback = null;
        this.listenersInitialized = false;

        this.modalEl = null;
        this.monthEl = null;
        this.daysEl = null;
        this.prevMonthBtn = null;
        this.nextMonthBtn = null;
        this.todayBtn = null;
    }

    /**
     * Lazy-loads and caches DOM elements.
     * Ensures elements are only queried once.
     */
    getElements() {
        if (!this.modalEl) {
            this.modalEl = document.getElementById('calendarModal');
            this.monthEl = document.getElementById('calMonth');
            this.daysEl = document.getElementById('calDays');
            this.prevMonthBtn = document.getElementById('calPrevMonth');
            this.nextMonthBtn = document.getElementById('calNextMonth');
            this.todayBtn = document.getElementById('calToday');
        }
        return {
            modalEl: this.modalEl,
            monthEl: this.monthEl,
            daysEl: this.daysEl,
            prevMonthBtn: this.prevMonthBtn,
            nextMonthBtn: this.nextMonthBtn,
            todayBtn: this.todayBtn
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
            if (this.onSelectCallback) {
                this.onSelectCallback(clickDate);
            }
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

        const { modalEl, prevMonthBtn, nextMonthBtn, todayBtn } = this.getElements();
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
            if (this.onSelectCallback) {
                this.onSelectCallback(new Date());
            }
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

        this.listenersInitialized = true;
    }

    /**
     * Opens the calendar modal with the specified selected date.
     */
    open(currentSelectedDate) {
        const { modalEl } = this.getElements();
        if (!modalEl) return;

        this.selectedDate = currentSelectedDate;
        this.calendarViewDate = new Date(currentSelectedDate);
        this.buildCalendar();
        modalEl.classList.remove('hidden');
    }

    /**
     * Closes the calendar modal.
     */
    close() {
        const { modalEl } = this.getElements();
        if (!modalEl) return;
        modalEl.classList.add('hidden');
    }

    /**
     * Initializes the calendar with a date selection callback.
     * Sets up all event listeners.
     */
    init(onSelect) {
        this.onSelectCallback = onSelect;
        this.setupEventListeners();
    }
}

const calendarInstance = new Calendar();

export function init(onSelect) {
    calendarInstance.init(onSelect);
}

export function open(currentSelectedDate) {
    calendarInstance.open(currentSelectedDate);
}

export function close() {
    calendarInstance.close();
}
