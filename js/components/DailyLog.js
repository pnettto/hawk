import { HOURS_START, HOURS_END } from '../constants.js';
import { loadForDate, saveForDate } from '../utils/storage.js';
import { fmtDate } from '../utils/date.js';
import { debounce } from '../utils/dom.js';

let hoursEl;
let notesInput;
let currentDate = null;

// Debounced save function
const debouncedSave = debounce(() => {
    if (!currentDate) return;
    saveCurrentState();
}, 320);

function getElements() {
    if (!hoursEl) hoursEl = document.getElementById('hours');
    if (!notesInput) {
        notesInput = document.getElementById('notesInput');
        // Initialize notes listener once
        if (notesInput) {
            notesInput.addEventListener('input', debouncedSave);
        }
    }
    return { hoursEl, notesInput };
}

function saveCurrentState() {
    const { hoursEl, notesInput } = getElements();
    if (!hoursEl) return;

    const map = { notes: notesInput.value };
    
    // We can just iterate over the data attributes we know exist
    // or query the container. Querying is safe and easy.
    const inputs = hoursEl.querySelectorAll('.input');
    inputs.forEach(inp => {
        const h = inp.dataset.hour;
        const cb = hoursEl.querySelector(`.cb[data-hour="${h}"]`);
        map[h] = { 
            checked: cb ? cb.checked : false, 
            text: inp.value 
        };
    });

    saveForDate(fmtDate(currentDate), map);
}

function createRowHTML(h, selectedDate) {
    const hourDisplay = new Date(); 
    hourDisplay.setHours(h, 0, 0, 0);
    const timeText = hourDisplay.toLocaleTimeString([], { hour: 'numeric' });
    
    const now = new Date();
    const isSameDay = now.toLocaleDateString() === selectedDate.toLocaleDateString();
    const isSameHour = now.getHours() === h;
    const highlightClass = (isSameDay && isSameHour) ? 'highlighted' : '';

    return `
        <div class="row">
            <div class="time">${timeText}</div>
            <div class="cb-wrap">
                <input type="checkbox" class="cb" data-hour="${h}">
            </div>
            <input class="input ${highlightClass}" data-hour="${h}">
        </div>
    `;
}

function setupDelegatedListeners() {
    const { hoursEl } = getElements();
    if (hoursEl.dataset.hasListeners) return;

    hoursEl.addEventListener('change', (e) => {
        if (e.target.matches('.cb')) {
            saveCurrentState();
        }
    });

    hoursEl.addEventListener('input', (e) => {
        if (e.target.matches('.input')) {
            debouncedSave();
        }
    });

    hoursEl.dataset.hasListeners = 'true';
}

export function render(date) {
    currentDate = date;
    const dateStr = fmtDate(date);
    const saved = loadForDate(dateStr) || {};
    
    const { hoursEl, notesInput } = getElements();
    if (!hoursEl) return;

    // 1. Build all HTML first (faster than appending nodes one by one)
    let rowsHTML = '';
    for (let h = HOURS_START; h <= HOURS_END; h++) {
        rowsHTML += createRowHTML(h, date);
    }
    hoursEl.innerHTML = rowsHTML;

    // 2. Restore state
    for (let h = HOURS_START; h <= HOURS_END; h++) {
        const state = saved[h] || { checked: false, text: '' };
        
        // It's slightly faster to select by ID, but we didn't use IDs.
        // Selecting by data attribute is fine here.
        const rowCb = hoursEl.querySelector(`.cb[data-hour="${h}"]`);
        const rowInput = hoursEl.querySelector(`.input[data-hour="${h}"]`);
        
        if (rowCb) rowCb.checked = !!state.checked;
        if (rowInput) rowInput.value = state.text || '';
    }

    // 3. Setup listeners (idempotent)
    setupDelegatedListeners();

    // 4. Set notes
    if (notesInput) {
        notesInput.value = saved.notes || '';
    }
}

