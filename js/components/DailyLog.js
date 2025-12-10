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
        this.notesMarkdown = ''; // Store markdown source
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
        if (!this.hoursEl) {
            this.hoursEl = document.getElementById('hoursContainer');
        }
        if (!this.notesInput) {
            this.notesInput = document.getElementById('notesInput');
        }
        return { hoursEl: this.hoursEl, notesInput: this.notesInput };
    }

    /**
     * Collects all hour data and notes, then persists to localStorage.
     */
    saveCurrentState() {
        const { hoursEl, notesInput } = this.getElements();
        if (!hoursEl || !this.currentDate) return;

        const data = {
            notes: notesInput?.innerHTML || '',
            notesMarkdown: this.notesMarkdown
        };

        // Gather checkbox and input values for each hour
        const hourInputs = hoursEl.querySelectorAll('.hour-input');
        hourInputs.forEach(hourInput => {
            const hour = hourInput.dataset.hour;
            const checkbox = hoursEl.querySelector(`.hour-checkbox[data-hour="${hour}"]`);
            data[hour] = {
                checked: checkbox?.checked || false,
                text: hourInput.value
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
            <div class="hour-row ${highlightClass}">
                <div class="hour-time">${timeText}</div>
                <div class="hour-checkbox-wrap">
                    <input type="checkbox" class="hour-checkbox" data-hour="${hour}">
                </div>
                <input class="hour-input" data-hour="${hour}">
            </div>
        `;
    }

    updateNotesMarkdow () {
        // Extract text preserving line breaks
        this.notesMarkdown = this.notesInput.innerHTML
            .replace(/<div>/g, "\n")   // opening div becomes newline
            .replace(/<\/div>/g, "")   // closing div removed
            .replace(/<br\s*\/?>/g, "\n") // br becomes newline
            .replace(/<div>/gi, '')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim();
    }

    /**
     * Sets up event delegation on the hours container.
     * Checkboxes save immediately, text inputs save with debounce.
     */
    setupEventListeners() {
        const { hoursEl, notesInput } = this.getElements();
        if (!hoursEl || this.listenersInitialized) return;

        // Checkbox changes save immediately
        hoursEl.addEventListener('change', (e) => {
            if (e.target.matches('.hour-checkbox')) {
                this.saveCurrentState();
            }
        });

        // Text input changes save with debounce
        hoursEl.addEventListener('input', (e) => {
            if (e.target.matches('.hour-input')) {
                this.debouncedSave();
            }
        });

        notesInput.addEventListener('mousedown', (e) => {
            const a = e.target.closest('a');
            if (!a) return;

            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();   // Block focus
            }
        });

        notesInput.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (!a) return;

            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                window.open(a.href, "_blank");
            }
        });

        this.notesInput.addEventListener('input', () => {
            this.updateNotesMarkdow();
            this.debouncedSave();
        });

        // Focus: show markdown
        this.notesInput.addEventListener('focus', () => {
            // Convert HTML back to markdown for editing
            const markdown = this.notesMarkdown;
            this.notesInput.innerHTML = '';

            // Insert text with preserved line breaks
            const lines = markdown.split('\n');
            lines.forEach((line, index) => {
                this.notesInput.appendChild(document.createTextNode(line));
                if (index < lines.length - 1) {
                    this.notesInput.appendChild(document.createElement('br'));
                }
            });

            // Place cursor at end
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(this.notesInput);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        });

        // Blur: parse and show HTML
        this.notesInput.addEventListener('blur', () => {
            this.updateNotesMarkdow()
            this.notesInput.innerHTML = marked.parse(this.notesMarkdown);
            this.saveCurrentState();
            if (window.Prism) {
                Prism.highlightAllUnder(this.notesInput);
            }
        });

        // Paste: convert image URLs to markdown format
        this.notesInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');

            // Check if it's an image URL
            const imageUrlPattern = /^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?.*)?$/i;

            let textToInsert = text;
            if (imageUrlPattern.test(text.trim())) {
                // Convert to markdown image
                textToInsert = `![](${text.trim()})`;
            }

            // Insert text at cursor position
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(textToInsert);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        document.addEventListener('keydown', (e) => {
            const isEnter = e.key.toLocaleLowerCase() == 'enter';
            const isCtrl = e.ctrlKey || e.metaKey;
            const isSKey = e.key.toLowerCase() == 's';
            const isNotesInputFocused = this.notesInput == document.activeElement;
            
            if (isNotesInputFocused && isCtrl && isSKey) {
                e.preventDefault();
                this.notesInput.blur();
            }
        })

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
            const input = hoursEl.querySelector(`.hour-input[data-hour="${hour}"]`);

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
            // Load markdown source and render as HTML
            this.notesMarkdown = savedData.notesMarkdown || '';
            notesInput.innerHTML = this.notesMarkdown ? marked.parse(this.notesMarkdown) : '';
        }
    }
}

const dailyLogInstance = new DailyLog();

export function render(date) {
    dailyLogInstance.render(date);
}

