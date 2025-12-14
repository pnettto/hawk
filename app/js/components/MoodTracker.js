import { loadForDate, saveForDate } from '../utils/storage.js';
import { formatDate as formatDate } from '../utils/date.js';

class MoodTracker {
    constructor () {
        this.listenersInitiated = false;
        this.currentDate = null;
        this.logoImg = '<img src="images/logo.svg" class="logo" />';
    }

    getElements () {
        const moodTracker = document.getElementById('moodTracker');
        return {
            moodTracker,
            selected: moodTracker.querySelector('.selected '),
            options: moodTracker.querySelector('.options'),
        }
    }

    setupListeners () {
        if (this.listenersInitiated) return;
        const { selected, options } = this.getElements();

        selected.addEventListener('click', () => {
            selected.classList.toggle('hidden');
            options.classList.toggle('hidden');
        });
        
        options.querySelectorAll('.item').forEach(item => {
            item.addEventListener('click', (e) => {
                const selectedEmoji = e.target.innerText;

                if (selectedEmoji === '❌') {
                    this.save({clear: true});
                } else {
                    selected.innerText = selectedEmoji;
                    this.save()
                }

                selected.classList.toggle('hidden');
                options.classList.toggle('hidden');
            });
        });

        document.addEventListener('newDateSelected', (e) => {
            this.currentDate = e.detail.date
            this.render(e.detail.date);
        });

        this.listenersInitiated = true;
    }

    save (options) {
        const savedData = loadForDate(formatDate(this.currentDate));
        const { selected } = this.getElements();
        
        let newMood;
        if (options?.clear) {
            selected.innerHTML = this.logoImg;
            newMood = null
        } else {
            newMood = selected.innerText;
        }
        
        const data = {
            mood: newMood,
        };

        const mergedData = {...savedData, ...data}

        saveForDate(formatDate(this.currentDate), mergedData);
    }

    load () {
        const { selected } = this.getElements();
        const savedData = loadForDate(formatDate(this.currentDate)) || {};
        this.mood = savedData.mood || this.logoImg;
        if (this.mood) {
            selected.innerHTML = this.mood;
        }
    }

    render (date) {
        this.currentDate = date;
        this.load();
        this.setupListeners();
    }
}

const tracker = new MoodTracker()

export function init() {
    tracker.render(window.selectedDate);
}