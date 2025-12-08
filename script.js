const HOURS_START = 9;
const HOURS_END = 17; // inclusive -> 7pm

const dateDisplay = document.getElementById('dateDisplay');
const datePicker = document.getElementById('datePicker');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const hoursEl = document.getElementById('hours');

let selected = new Date();

function fmtDate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function prettyDisplay(d){
  return d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
}

const ROOT_KEY = 'hawk:data';

function loadAll(){
  const raw = localStorage.getItem(ROOT_KEY);
  if(!raw) return {};
  try{ return JSON.parse(raw) || {} }catch(e){ return {} }
}

function saveAll(obj){
  try{ localStorage.setItem(ROOT_KEY, JSON.stringify(obj)) }catch(e){ /* ignore quota errors */ }
}

function debounce(fn, wait=300){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),wait)};
}

function saveForDate(dateStr, data){
  const all = loadAll();
  all[dateStr] = data;
  saveAll(all);
}

function loadForDate(dateStr){
  const all = loadAll();
  return all[dateStr] || null;
}

function buildRow(hour){
  const row = document.createElement('div'); row.className='row';

  const time = document.createElement('div'); time.className='time';
  const hourDisplay = new Date(); hourDisplay.setHours(hour,0,0,0);
  time.textContent = hourDisplay.toLocaleTimeString([], {hour:'numeric'});

  const cbWrap = document.createElement('div'); cbWrap.className='cb-wrap';
  const cb = document.createElement('input'); cb.type='checkbox'; cb.className='cb'; cb.dataset.hour = hour;
  cbWrap.appendChild(cb);

  const input = document.createElement('input'); input.className='input'; input.dataset.hour = hour;

  row.appendChild(time);
  row.appendChild(cbWrap);
  row.appendChild(input);

  return {row, cb, input};
}

function render(date){
  hoursEl.innerHTML='';
  const dateStr = fmtDate(date);
  const saved = loadForDate(dateStr) || {};
  for(let h=HOURS_START; h<=HOURS_END; h++){
    const {row, cb, input} = buildRow(h);
    const state = saved[h] || {checked:false, text:''};
    cb.checked = !!state.checked;
    input.value = state.text || '';

    cb.addEventListener('change', ()=>{
      const data = collectCurrentState();
      saveForDate(dateStr, data);
    });

    const debouncedSave = debounce(()=>{
      const data = collectCurrentState();
      saveForDate(dateStr, data);
    }, 320);

    input.addEventListener('input', debouncedSave);

    hoursEl.appendChild(row);
  }
}

function collectCurrentState(){
  const map = {};
  const inputs = hoursEl.querySelectorAll('.input');
  inputs.forEach(inp=>{
    const h = inp.dataset.hour;
    const cb = hoursEl.querySelector(`.cb[data-hour=\"${h}\"]`);
    map[h] = {checked: !!cb.checked, text: inp.value};
  });
  return map;
}

function setSelected(d){
  selected = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  dateDisplay.textContent = prettyDisplay(selected);
  datePicker.value = fmtDate(selected);
  render(selected);
}

prevBtn.addEventListener('click', ()=>{
  const d = new Date(selected); d.setDate(d.getDate()-1); setSelected(d);
});
nextBtn.addEventListener('click', ()=>{
  const d = new Date(selected); d.setDate(d.getDate()+1); setSelected(d);
});

dateDisplay.addEventListener('click', ()=> datePicker.focus());
datePicker.addEventListener('change', ()=>{
  const parts = datePicker.value.split('-');
  if(parts.length===3){
    const d = new Date(+parts[0], +parts[1]-1, +parts[2]);
    setSelected(d);
  }
});

// init
setSelected(new Date());
