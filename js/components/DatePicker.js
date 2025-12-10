import { prettyDisplay } from '../utils/date.js';
import * as Calendar from './Calendar.js';

class DatePicker {
    constructor () {
        this.listenersInitialized = false;
        this.selectedDate = null
        this.calendar = null;
    }

    setCalendar (calendar) {
        this.calendar = calendar;
    }

    getElements () {
        return {
            dateDisplay: document.getElementById('dateDisplay'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
        }
    }

    setSelected(d) {
        const selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        this.selectedDate = selectedDate;
        dateDisplay.textContent = prettyDisplay(selectedDate);
    }
    
    goPrev() {
        const d = new Date(this.selectedDate.getTime());
        d.setDate(d.getDate() - 1);
        const event = new CustomEvent('selectNewDate', { detail: { date: d } });
        document.dispatchEvent(event);
    }
    
    goNext() {
        const d = new Date(this.selectedDate.getTime());
        d.setDate(d.getDate() + 1);
        const event = new CustomEvent('selectNewDate', { detail: { date: d } });
        document.dispatchEvent(event);
    }

    setupListeners () {
        const {prevBtn, nextBtn, dateDisplay } = this.getElements();

        prevBtn.addEventListener('click', () => this.goPrev());
        nextBtn.addEventListener('click', () => this.goNext());
        dateDisplay.addEventListener('click', () => {
            this.calendar.open(this.selectedDate)
        });

        document.addEventListener("keydown", (event) => {
            const active = document.activeElement;

            const isSomeInputInFocus =
                active.classList.contains("hour-input") ||
                active.closest(".notes-input") !== null;

            if (isSomeInputInFocus) return;

            if (event.key === "ArrowLeft") this.goPrev();
            if (event.key === "a") this.goPrev();
            if (event.key === "ArrowRight") this.goNext();
            if (event.key === "d") this.goNext();

            if (event.key === "t" || event.key === " ") {
                const event = new CustomEvent('newDateSelected', { detail: { date: new Date()} })
                document.dispatchEvent(event);
                event.preventDefault();
            }
        });

        document.addEventListener('newDateSelected', (e) => {
            this.setSelected(e.detail.date);
        });

        this.listenersInitialized = true;
    }
}

const picker = new DatePicker();

export function init() {
    const calendar = Calendar.init();
    picker.setCalendar(calendar);
    picker.setSelected(window.selectedDate);
    picker.setupListeners();
}