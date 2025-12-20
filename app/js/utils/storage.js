import { LOCALSTORAGE_KEY } from "../global.js";
import { formatDate } from "./date.js";

const isChromeExtension = globalThis.location.href.startsWith(
  "chrome-extension://",
);
const apiUrl = isChromeExtension ? "https://hawk.pnettto.deno.net" : "";

let loadAllPromise = null;

export function loadAll() {
  if (globalThis.logs) {
    return Promise.resolve(globalThis.logs);
  }

  if (loadAllPromise) {
    return loadAllPromise;
  }

  loadAllPromise = (async () => {
    const apiKey = localStorage.getItem("apiKey");
    const res = await fetch(`${apiUrl}/api/logs`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      loadAllPromise = null;
      return {};
    }

    const data = await res.json();

    globalThis.logs = data;
    return data;
  })();

  return loadAllPromise;
}

export function saveAll(obj) {
  const apiKey = localStorage.getItem("apiKey");
  fetch(`${apiUrl}/api/logs`, {
    method: "POST",
    body: JSON.stringify(obj),
    headers: {
      "Content-Type": "text/plain",
      "Authorization": `Bearer ${apiKey}`,
    },
  });
}

export async function loadForDate(dateStr) {
  const all = await loadAll();
  return all[dateStr] || null;
}

export async function saveForDate(dateStr, data) {
  const all = await loadAll();
  if (!all[dateStr]) {
    all[dateStr] = {};
  }
  all[dateStr] = data;
  saveAll(all);
}

export async function backup() {
  const obj = await loadAll();
  const dateStr = formatDate(new Date());
  try {
    localStorage.setItem(
      `${LOCALSTORAGE_KEY}_backup_${dateStr}`,
      JSON.stringify(obj),
    );
    console.log(`Backup ${dateStr} for  saved`);
  } catch (e) {
    console.error("Error saving backup", e);
  }
}
