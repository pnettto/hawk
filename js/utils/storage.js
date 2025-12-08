import { LOCALSTORAGE_KEY } from '../constants.js';

export function loadAll() {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
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
