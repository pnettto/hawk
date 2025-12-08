import { fmtDate } from '../utils/date.js';

const calModal = document.getElementById('calendarModal');
const calMonth = document.getElementById('calMonth');
const calDays = document.getElementById('calDays');
const calPrevMonth = document.getElementById('calPrevMonth');
const calNextMonth = document.getElementById('calNextMonth');
const calToday = document.getElementById('calToday');

let calendarViewDate = new Date();
let selectedDate = new Date();
let onSelectCallback = null;

function buildCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());

  calMonth.textContent = calendarViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  calDays.innerHTML = '';

  let currentDate = new Date(startDate);
  for (let i = 0; i < 42; i++) {
    const day = document.createElement('button');
    day.className = 'cal-day';
    day.textContent = currentDate.getDate();

    if (currentDate.getMonth() !== month) {
      day.classList.add('other-month');
    }

    if (fmtDate(currentDate) === fmtDate(selectedDate)) {
      day.classList.add('selected');
    }

    const clickDate = new Date(currentDate);
    day.addEventListener('click', () => {
        if(onSelectCallback) onSelectCallback(clickDate);
        close();
    });

    calDays.appendChild(day);
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

export function open(currentSelectedDate) {
    selectedDate = currentSelectedDate; // Update internal selection reference
    calendarViewDate = new Date(selectedDate);
    buildCalendar();
    calModal.classList.remove('hidden');
}

export function close() {
    calModal.classList.add('hidden');
}

export function init(onSelect) {
    onSelectCallback = onSelect;
    
    calPrevMonth.addEventListener('click', () => {
        calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
        buildCalendar();
    });

    calNextMonth.addEventListener('click', () => {
        calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
        buildCalendar();
    });

    calModal.addEventListener('click', (e) => {
        if (e.target === calModal) close();
    });

    calToday.addEventListener('click', () => {
        if(onSelectCallback) onSelectCallback(new Date());
        close();
    });
    
    document.addEventListener('click', (e) => {
        if (!calModal.classList.contains('hidden') && !e.target.closest('.date-container')) {
            close();
        }
    });
}
