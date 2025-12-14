import { LOCALSTORAGE_KEY } from '../global.js';
import { formatDate } from './date.js';

export function loadAll() {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);

    fetch("/api/backup/recover", {
        method: "GET",
    })
    .then(res => res.json())
    .then(data => console.log(data))
    .catch(err => console.error(err));

    if (!raw) return {};
    try { return JSON.parse(raw) || {} } catch (e) { return {} }
}

export function saveAll(obj) {
    try { localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(obj)) } catch (e) { /* ignore quota errors */ }
}

export function loadForDate(dateStr) {
    const all = loadAll();
    return all[dateStr] || null;
}

export function saveForDate(dateStr, data) {
    const all = loadAll();
    all[dateStr] = data;
    saveAll(all);
}

export function backup() {
    const obj = loadAll()
    const dateStr = formatDate(new Date());
    try {
        localStorage.setItem(`${LOCALSTORAGE_KEY}_backup_${dateStr}`, JSON.stringify(obj));

        fetch(`/api/backup/create`, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain",
            },
            body: JSON.stringify({[dateStr]: obj}),
        })
        .then(res => res.text())
        .then(console.log)
        .catch(console.error);

        console.log(`Backup ${dateStr} for  saved`)
    } catch (e) {
        console.error('Error saving backup', e);
    }
}
