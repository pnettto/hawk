import * as DatePicker from './components/DatePicker.js';
import * as DailyLog from './components/DailyLog.js';
import * as Notes from './components/Notes.js';
import * as MoodTracker from './components/MoodTracker.js';
import * as Shortcuts from './components/Shortcuts.js';
import * as ZenMode from './components/ZenMode.js';
import * as Backup from './components/Backup.js';
import * as Mirror from './components/Mirror.js';
import * as Auth from './components/Auth.js';

window.selectedDate = new Date();
document.addEventListener('selectNewDate', (e) => {
    selectedDate = e.detail.date;
    const event = new CustomEvent(
        'newDateSelected', 
        { detail: { date: selectedDate } }
    );
    document.dispatchEvent(event)
})

DatePicker.init();
DailyLog.init();
Notes.init();
MoodTracker.init();
Shortcuts.init();
ZenMode.init();
Backup.init();
Mirror.init();
Auth.init();

// Only show app by default from 8am to 6pm 🌙
if (selectedDate.getHours() >= 8 || selectedDate.getHours() < 18) {
    ZenMode.close();
}

// fetch("/api/backup/recover", {
//     method: "GET",
// })
// .then(res => res.json())
// .then(data => console.log(data))
// .catch(err => console.error(err));