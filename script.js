const HOURS_START = 9;
const HOURS_END = 17;
const LOCALSTORAGE_KEY = 'hawk:data';

const dateDisplay = document.getElementById('dateDisplay');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const hoursEl = document.getElementById('hours');

const notesInput = document.getElementById('notesInput');

const calModal = document.getElementById('calendarModal');
const calMonth = document.getElementById('calMonth');
const calDays = document.getElementById('calDays');
const calPrevMonth = document.getElementById('calPrevMonth');
const calNextMonth = document.getElementById('calNextMonth');
const calToday = document.getElementById('calToday');

let selectedDate = new Date();
let calendarViewDate = new Date();

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function prettyDisplay(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function loadAll() {
  const raw = localStorage.getItem(LOCALSTORAGE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {} } catch (e) { return {} }
}

function saveAll(obj) {
  try { localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(obj)) } catch (e) { /* ignore quota errors */ }
}

function debounce(fn, wait = 300) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait) };
}

function saveForDate(dateStr, data) {
  const all = loadAll();
  all[dateStr] = data;
  saveAll(all);
}

function loadForDate(dateStr) {
  const all = loadAll();
  return all[dateStr] || null;
}

function buildRow(hour) {
  const row = document.createElement('div'); 
  row.className = 'row';

  const time = document.createElement('div'); 
  time.className = 'hour-time';
  const hourDisplay = new Date(); hourDisplay.setHours(hour, 0, 0, 0);
  time.textContent = hourDisplay.toLocaleTimeString([], { hour: 'numeric' });

  const hourCheckboxWrap = document.createElement('div'); 
  hourCheckboxWrap.className = 'hour-checkbox-wrap';
  const hourCheckbox = document.createElement('input'); 
  hourCheckbox.type = 'checkbox'; 
  hourCheckbox.className = 'hour-checkbox'; 
  hourCheckbox.dataset.hour = hour;
  hourCheckboxWrap.appendChild(hourCheckbox);

  const input = document.createElement('input'); 
  input.className = 'input'; 
  input.dataset.hour = hour;
  const now = new Date();
  const isSameDay = now.toLocaleDateString() === selectedDate.toLocaleDateString()
  const isSameHour = now.getHours() === hourDisplay.getHours()
  if (isSameDay && isSameHour) {
    input.classList.add('highlighted')
  }

  row.appendChild(time);
  row.appendChild(hourCheckboxWrap);
  row.appendChild(input);

  return { row, hourCheckbox, input };
}

const debouncedSave = debounce(() => {
  const data = collectCurrentState();
  const ds = formatDate(selectedDate);
  saveForDate(ds, data);
}, 320);

function render(date) {
  hoursEl.innerHTML = '';
  const dateStr = formatDate(date);
  const saved = loadForDate(dateStr) || {};

  for (let h = HOURS_START; h <= HOURS_END; h++) {
    const { row, hourCheckbox, input } = buildRow(h);
    const state = saved[h] || { checked: false, text: '' };
    hourCheckbox.checked = !!state.checked;
    input.value = state.text || '';

    hourCheckbox.addEventListener('change', () => {
      const data = collectCurrentState();
      saveForDate(dateStr, data);
    });
    input.addEventListener('input', debouncedSave);
    
    hoursEl.appendChild(row);
  }

  notesInput.value = saved.notes || '';
}

notesInput.addEventListener('input', debouncedSave);

function collectCurrentState() {
  const map = {};
  const inputs = hoursEl.querySelectorAll('.input');
  inputs.forEach(inp => {
    const h = inp.dataset.hour;
    const hourCheckbox = hoursEl.querySelector(`.hour-checkbox[data-hour=\"${h}\"]`);
    map[h] = { checked: !!hourCheckbox.checked, text: inp.value };
  });
  map.notes = notesInput.value;
  return map;
}

function setSelected(d) {
  selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  dateDisplay.textContent = prettyDisplay(selectedDate);
  render(selectedDate);
}

// CALENDAR FUNCTIONALITY
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

    if (formatDate(currentDate) === formatDate(selectedDate)) {
      day.classList.add('selected');
    }

    const clickDate = new Date(currentDate);
    day.addEventListener('click', () => {
      setSelected(clickDate);
      closeCalendar();
    });

    calDays.appendChild(day);
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function openCalendar() {
  calendarViewDate = new Date(selectedDate);
  buildCalendar();
  calModal.classList.remove('hidden');
}

function closeCalendar() {
  calModal.classList.add('hidden');
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

prevBtn.addEventListener('click', goPrev);
nextBtn.addEventListener('click', goNext);
// Add keyboard bindings to navigate
window.addEventListener("keydown", (event) => {
    const isSomeInputInFocus= document.querySelectorAll('input:focus, textarea:focus').length > 0;
    if (isSomeInputInFocus) return;

    if (event.key === "ArrowLeft") {
        goPrev();
    }
    if (event.key === "ArrowRight") {
      goNext();
    }
    if (event.key === "t" | event.key === " ") {
      setSelected(new Date());
    }
});

dateDisplay.addEventListener('click', openCalendar);

calPrevMonth.addEventListener('click', () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
  buildCalendar();
});

calNextMonth.addEventListener('click', () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
  buildCalendar();
});

calModal.addEventListener('click', (e) => {
  if (e.target === calModal) closeCalendar();
});

calToday.addEventListener('click', () => {
  setSelected(new Date());
  closeCalendar();
});

document.addEventListener('click', (e) => {
  if (!calModal.classList.contains('hidden') && !e.target.closest('.date-container')) {
    closeCalendar();
  }
});



setSelected(new Date());
