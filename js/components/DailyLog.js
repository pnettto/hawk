import { HOURS_START, HOURS_END } from '../constants.js';
import { loadForDate, saveForDate } from '../utils/storage.js';
import { formatDate as formatDate } from '../utils/date.js';
import { debounce } from '../utils/dom.js';

/**
 * Manages the daily log UI: hourly rows with checkboxes and text inputs.
 * Handles rendering, state persistence, and user interactions.
 */
class DailyLog {
    constructor() {
        this.currentDate = null;
        this.hoursEl = null;
        this.notesInput = null;
        this.listenersInitialized = false;

        // Debounce text input saves to avoid excessive localStorage writes
        this.debouncedSave = debounce(() => {
            if (this.currentDate) {
                this.saveCurrentState();
            }
        }, 320);
    }

    /**
     * Lazy-loads and caches DOM elements.
     * Attaches notes input listener on first access.
     */
    getElements() {
        if (!this.hoursEl) {
            this.hoursEl = document.getElementById('hours');
        }
        if (!this.notesInput) {
            this.notesInput = document.getElementById('notesInput');
            if (this.notesInput) {
                this.notesInput.addEventListener('input', () => this.debouncedSave());
            }
        }
        return { hoursEl: this.hoursEl, notesInput: this.notesInput };
    }

    /**
     * Collects all hour data and notes, then persists to localStorage.
     */
    saveCurrentState() {
        const { hoursEl, notesInput } = this.getElements();
        if (!hoursEl || !this.currentDate) return;

        const data = { notes: notesInput?.value || '' };

        // Gather checkbox and input values for each hour
        const inputs = hoursEl.querySelectorAll('.input');
        inputs.forEach(input => {
            const hour = input.dataset.hour;
            const checkbox = hoursEl.querySelector(`.hour-checkbox[data-hour="${hour}"]`);
            data[hour] = {
                checked: checkbox?.checked || false,
                text: input.value
            };
        });

        saveForDate(formatDate(this.currentDate), data);
    }

    /**
     * Generates HTML for a single hour row.
     * Highlights the row if it matches the current hour today.
     */
    createRowHTML(hour, selectedDate) {
        const timeDisplay = new Date();
        timeDisplay.setHours(hour, 0, 0, 0);
        const timeText = timeDisplay.toLocaleTimeString([], { hour: 'numeric' });

        // Highlight current hour if viewing today
        const now = new Date();
        const isSameDay = now.toLocaleDateString() === selectedDate.toLocaleDateString();
        const isCurrentHour = now.getHours() === hour;
        const highlightClass = (isSameDay && isCurrentHour) ? 'highlighted' : '';

        return `
            <div class="row">
                <div class="hour-time">${timeText}</div>
                <div class="hour-checkbox-wrap">
                    <input type="checkbox" class="hour-checkbox" data-hour="${hour}">
                </div>
                <input class="input ${highlightClass}" data-hour="${hour}">
            </div>
        `;
    }

    /**
     * Sets up event delegation on the hours container.
     * Checkboxes save immediately, text inputs save with debounce.
     */
    setupEventListeners() {
        const { hoursEl } = this.getElements();
        if (!hoursEl || this.listenersInitialized) return;

        // Checkbox changes save immediately
        hoursEl.addEventListener('change', (e) => {
            if (e.target.matches('.hour-checkbox')) {
                this.saveCurrentState();
            }
        });

        // Text input changes save with debounce
        hoursEl.addEventListener('input', (e) => {
            if (e.target.matches('.input')) {
                this.debouncedSave();
            }
        });

        this.listenersInitialized = true;
    }

    /**
     * Builds HTML for all hour rows between HOURS_START and HOURS_END.
     */
    buildRowsHTML(date) {
        let html = '';
        for (let hour = HOURS_START; hour <= HOURS_END; hour++) {
            html += this.createRowHTML(hour, date);
        }
        return html;
    }

    /**
     * Restores checkboxes and text inputs from saved data.
     */
    restoreState(savedData) {
        const { hoursEl } = this.getElements();
        if (!hoursEl) return;

        for (let hour = HOURS_START; hour <= HOURS_END; hour++) {
            const state = savedData[hour] || { checked: false, text: '' };

            const checkbox = hoursEl.querySelector(`.hour-checkbox[data-hour="${hour}"]`);
            const input = hoursEl.querySelector(`.input[data-hour="${hour}"]`);

            if (checkbox) checkbox.checked = !!state.checked;
            if (input) input.value = state.text || '';
        }
    }

    /**
     * Main render method: builds UI, restores state, and sets up listeners.
     */
    render(date) {
        this.currentDate = date;
        const savedData = loadForDate(formatDate(date)) || {};

        const { hoursEl, notesInput } = this.getElements();
        if (!hoursEl) return;

        hoursEl.innerHTML = this.buildRowsHTML(date);
        this.restoreState(savedData);
        this.setupEventListeners();

        if (notesInput) {
            notesInput.value = savedData.notes || '';
        }
    }
}

const dailyLogInstance = new DailyLog();

export function render(date) {
    dailyLogInstance.render(date);
}

