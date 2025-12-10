import * as DatePicker from './components/DatePicker.js';
import * as DailyLog from './components/DailyLog.js';
import * as Notes from './components/Notes.js';
import * as MoodTracker from './components/MoodTracker.js';
import * as Shortcuts from './components/Shortcuts.js';

window.selectedDate = new Date();
document.addEventListener('selectNewDate', (e) => {
    selectedDate = e.detail.date;
    const event = new CustomEvent('newDateSelected', { detail: { date: selectedDate } });
    document.dispatchEvent(event)
})

document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active.tagName === "INPUT" ||
                active.tagName === "TEXTAREA" ||
                active.isContentEditable;
    if (isTyping) return;

    if (e.key.toLowerCase() === 'z') {
        const zen = document.getElementById('zenMode');
        if (zen.classList.contains('hidden')) {
            zen.classList.remove('hidden')
            document.body.style = 'overflow: hidden;';
        } else {
            zen.classList.add('hidden')
            document.body.style = '';
        }
    }
});

let currentStream = null;
document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active.tagName === "INPUT" ||
                active.tagName === "TEXTAREA" ||
                active.isContentEditable;
    if (isTyping) return;

    if (e.key.toLowerCase() === 'm') {
        const mirror = document.getElementById('mirror');
        if (mirror.classList.contains('hidden')) {
            mirror.classList.remove('hidden')
            document.body.style = 'overflow: hidden;';

            const video = document.querySelector('video');

            navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                currentStream = stream;
                video.srcObject = stream;
            })
            .catch(err => {
                console.error('Error accessing webcam:', err);
            });
        } else {
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
                currentStream = null;
            }
            mirror.classList.add('hidden')
            document.body.style = '';
        }
    }
});

// Init
DatePicker.init();
DailyLog.init();
Notes.init();
MoodTracker.init();
Shortcuts.init();