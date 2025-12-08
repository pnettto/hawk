import * as DailyLog from './components/DailyLog.js';
import * as Calendar from './components/Calendar.js';
import { prettyDisplay } from './utils/date.js';

const dateDisplay = document.getElementById('dateDisplay');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

let selectedDate = new Date();

function setSelected(d) {
    selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    dateDisplay.textContent = prettyDisplay(selectedDate);
    DailyLog.render(selectedDate);
}

function goPrev() {
    const d = new Date(selectedDate); 
    d.setDate(d.getDate() - 1); 
    setSelected(d);
}

function goNext() {
    const d = new Date(selectedDate); 
    d.setDate(d.getDate() + 1); 
    setSelected(d);
}

// Event Listeners
prevBtn.addEventListener('click', goPrev);
nextBtn.addEventListener('click', goNext);
dateDisplay.addEventListener('click', () => Calendar.open(selectedDate));

window.addEventListener("keydown", (event) => {
    const active = document.activeElement;

    const isSomeInputInFocus =
        active.classList.contains("hour-input") ||
        active.closest(".notes-input") !== null;   // covers focus-within

    if (isSomeInputInFocus) return;

    if (event.key === "ArrowLeft") goPrev();
    if (event.key === "ArrowRight") goNext();

    if (event.key === "t" || event.key === " ") {
        setSelected(new Date());
        event.preventDefault(); // Prevent scrolling for space
    }
});

// Init
Calendar.init(setSelected);
setSelected(new Date());
