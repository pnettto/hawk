import { HOURS_START, HOURS_END } from '../global.js';
import { loadForDate, saveForDate } from '../utils/storage.js';
import { formatDate as formatDate } from '../utils/date.js';
import { debounce } from '../utils/dom.js';

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
        this.debouncedSave = debounce(() => {
            if (this.currentDate) {
                this.saveCurrentState();
            }
        }, 500);
    }

    /**
     * Lazy-loads and caches DOM elements.
     * Attaches notes input listener on first access.
     */
    getElements() {
        return { 
            hoursContainer: document.getElementById('hoursContainer') 
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
        const hourInputs = hoursContainer.querySelectorAll('.hour-input');
        const data = {};
        hourInputs.forEach(hourInput => {
            const hour = hourInput.dataset.hour;
            const checkbox = hoursContainer.querySelector(`.hour-checkbox[data-hour="${hour}"]`);

            data[hour] = {
                checked: checkbox?.checked || false,
                text: hourInput.value
            };
        });

        const mergedData = {...savedData, ...data}
        const cleanData = Object.fromEntries(Object.entries(mergedData).filter((item) => {
            const [key, value] = item;
            if ( /^\d{1,2}(?:-\d{1,2})?$/.test(key)) {
                return (value.checked || value.text !== '') ? item : false;
            }
            return item;
        }));

        saveForDate(formatDate(this.currentDate), cleanData);
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
            { hour: 'numeric', minute: 'numeric'}
        );

        // Highlight current hour if viewing today
        const now = new Date();
        const isSameDay = now.toLocaleDateString() === selectedDate.toLocaleDateString();
        const isCurrentHour = now.getHours() === hour;
        const isCurrentMinute = minutes === 0 ? now.getMinutes() < 30 : now.getMinutes() >= 30;
        const isHighlightedHour = (isSameDay && isCurrentHour && isCurrentMinute);

        const hourLine =  `
        <div class="hour-line"></div>
        `

        return `
        <div class="hour-row ${isHighlightedHour ? 'highlighted' : ''}">
            <div class="hour-time">${timeText}</div>
            <div class="hour-checkbox-wrap">
                <input type="checkbox" class="hour-checkbox" data-hour="${hour}${minutes !== 0 ? ('-' + minutes) : ''}">
            </div>
            <input class="hour-input" data-hour="${hour}${minutes !== 0 ? ('-' + minutes) : ''}">
            ${isHighlightedHour ? hourLine : ''}
        </div>
        `;
    }

    /**
     * Builds HTML for all hour rows between HOURS_START and HOURS_END.
     */
    buildRowsHTML(date) {
        let html = '';
        for (let hour = this.HOURS_START; hour <= this.HOURS_END; hour++) {
            html += this.createRowHTML(hour, 0, date);
            html += this.createRowHTML(hour, 30, date);
        }
        return html;
    }

    /**
     * Sets up event delegation on the hours container.
     * Checkboxes save immediately, text inputs save with debounce.
     */
    setupEventListeners() {
        const { hoursContainer } = this.getElements();
        if (!hoursContainer || this.listenersInitialized) return;

        // Checkbox changes save immediately
        hoursContainer.addEventListener('change', (e) => {
            if (e.target.matches('.hour-checkbox')) {
                this.saveCurrentState();
            }
        });

        // Text input changes save with debounce
        hoursContainer.addEventListener('input', (e) => {
            if (e.target.matches('.hour-input')) {
                this.debouncedSave();
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
            if (event.key.toLocaleLowerCase() === "f") this.toggleShowAllHours();
        });

        document.addEventListener('newDateSelected', (e) => {
            this.render(e.detail.date);
        });

        this.listenersInitialized = true;
    }

    goUp () {
        if (this.HOURS_START === 1) return;
        this.HOURS_START -= 1;
        this.HOURS_END -= 1;
        this.render(this.currentDate);
    }
    
    goDown () {
        if (this.HOURS_END === 23) return;
        this.HOURS_START += 1;
        this.HOURS_END += 1;
        this.render(this.currentDate);
    }

    toggleShowAllHours () {
        if (this.showingAllHours) {
            this.HOURS_START = HOURS_START;
            this.HOURS_END = HOURS_END;
            this.showingAllHours = false;
        } else {
            this.HOURS_START = 6;
            this.HOURS_END = 22;
            this.showingAllHours = true;
        }

        this.render(this.currentDate);
    }

    /**
     * Restores checkboxes and text inputs from saved data.
     */
    restoreState(savedData) {
        const { hoursContainer } = this.getElements();
        if (!hoursContainer) return;

        // Full hour inputs
        for (let hour = this.HOURS_START; hour <= this.HOURS_END; hour++) {
            const state = savedData[hour] || { checked: false, text: '' };
            const checkbox = hoursContainer.querySelector(`.hour-checkbox[data-hour="${hour}"]`);
            const input = hoursContainer.querySelector(`.hour-input[data-hour="${hour}"]`);
            
            if (checkbox) checkbox.checked = !!state.checked;
            if (input) input.value = state.text || '';
        }
        
        // Mid-hour inputs
        for (let hour = this.HOURS_START; hour <= this.HOURS_END; hour++) {
            const state = savedData[`${hour}-30`] || { checked: false, text: '' };
            const checkbox = hoursContainer.querySelector(`.hour-checkbox[data-hour="${hour}-30"]`);
            const input = hoursContainer.querySelector(`.hour-input[data-hour="${hour}-30"]`);
            
            if (checkbox) checkbox.checked = !!state.checked;
            if (input) input.value = state.text || '';
        }
    }

    /**
     * Main render method: builds UI, restores state, and sets up listeners.
     */
    render(date) {
        const { hoursContainer } = this.getElements();
        if (!hoursContainer) return;

        this.currentDate = date;

        loadForDate(formatDate(date))
            .then(savedData => {
                hoursContainer.innerHTML = this.buildRowsHTML(date);
                this.restoreState(savedData);
            })

        hoursContainer.innerHTML = this.buildRowsHTML(date);
        this.setupEventListeners();        
    }
}

const dailyLogInstance = new DailyLog();

export function init() {
    dailyLogInstance.render(window.selectedDate);
}

