import * as DatePicker from './components/DatePicker.js';
import * as DailyLog from './components/DailyLog.js';
import * as Notes from './components/Notes.js';
import * as Shortcuts from './components/Shortcuts.js';

window.selectedDate = new Date();
document.addEventListener('selectNewDate', (e) => {
    selectedDate = e.detail.date;
    const event = new CustomEvent('newDateSelected', { detail: { date: selectedDate } });
    document.dispatchEvent(event)
})


// Init
DatePicker.init();
DailyLog.init();
Notes.init();
Shortcuts.init();