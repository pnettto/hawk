import { LOCALSTORAGE_KEY } from '../global.js';
import { formatDate } from './date.js';

const apiRoot = 'https://hawk.pnettto.deno.net/';

let loadAllPromise = null;

export function loadAll() {
    if (window.logs) {
        return Promise.resolve(window.logs);
    }

    if (loadAllPromise) {
        return loadAllPromise;
    }

    loadAllPromise = (async () => {
        const apiKey = localStorage.getItem('apiKey');
        const res = await fetch(apiRoot + 'api/logs', {
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });

        if (!res.ok) {
            loadAllPromise = null;
            return {};
        }

        const data = await res.json();
        window.logs = data;
        return data;
    })();

    return loadAllPromise;
}

export function saveAll(obj) {
    const apiKey = localStorage.getItem('apiKey');
    fetch(apiRoot + 'api/logs', {
        method: 'POST',
        body: JSON.stringify(obj),
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(obj))
}

export async function loadForDate(dateStr) {
    const all = await loadAll();
    return all[dateStr] || null;
}

export async function saveForDate(dateStr, data) {
    const all = await loadAll();
    all[dateStr] = data;
    saveAll(all);
}

export async function backup() {
    const obj = await loadAll()
    const dateStr = formatDate(new Date());
    try {
        localStorage.setItem(`${LOCALSTORAGE_KEY}_backup_${dateStr}`, JSON.stringify(obj));
        console.log(`Backup ${dateStr} for  saved`)
    } catch (e) {
        console.error('Error saving backup', e);
    }
}
