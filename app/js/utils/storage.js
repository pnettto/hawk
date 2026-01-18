import { LOCALSTORAGE_KEY } from "../global.js";
import { formatDate } from "./date.js";

const apiUrl = localStorage.getItem("API_URL") ||
  "https://hawk.pnettto.deno.net";

console.log(`[Storage] API Root: ${apiUrl || "(relative local)"}`);

// Cache for loaded logs
let logsCache = {};
const pendingRequests = new Map();

function getAuthHeaders() {
  const apiKey = localStorage.getItem("apiKey");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Load all logs (needed for reports)
 */
export async function loadAll() {
  const apiKey = localStorage.getItem("apiKey");
  if (!apiKey) return {};

  try {
    const res = await fetch(`${apiUrl}/api/logs`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return {};
    const data = await res.json();
    logsCache = { ...logsCache, ...data };
    return logsCache;
  } catch (e) {
    console.error("Failed to load all logs:", e);
    return logsCache;
  }
}

/**
 * Load a single day's log
 */
export function loadForDate(dateStr) {
  // 1. Check cache
  if (logsCache[dateStr]) {
    return logsCache[dateStr];
  }

  // 2. Check if already fetching
  if (pendingRequests.has(dateStr)) {
    return pendingRequests.get(dateStr);
  }

  // 3. Fetch from API
  const apiKey = localStorage.getItem("apiKey");
  if (!apiKey) return null;

  const promise = (async () => {
    try {
      const res = await fetch(
        `${apiUrl}/api/day?date=${encodeURIComponent(dateStr)}`,
        {
          headers: getAuthHeaders(),
        },
      );
      if (!res.ok) return null;
      const data = await res.json();
      logsCache[dateStr] = data;
      return data;
    } catch (e) {
      console.error(`Failed to load log for ${dateStr}:`, e);
      return null;
    } finally {
      pendingRequests.delete(dateStr);
    }
  })();

  pendingRequests.set(dateStr, promise);
  return promise;
}

/**
 * Load a range of dates
 */
export async function loadForRange(start, end) {
  const apiKey = localStorage.getItem("apiKey");
  if (!apiKey) return {};

  try {
    const res = await fetch(
      `${apiUrl}/api/range?start=${encodeURIComponent(start)}&end=${
        encodeURIComponent(end)
      }`,
      {
        headers: getAuthHeaders(),
      },
    );
    if (!res.ok) return {};
    const data = await res.json();
    logsCache = { ...logsCache, ...data };
    return data;
  } catch (e) {
    console.error(`Failed to load range ${start} to ${end}:`, e);
    return {};
  }
}

/**
 * Pre-emptively load surrounding days
 */
export function prefetchSurrounding(date) {
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  const next = new Date(date);
  next.setDate(next.getDate() + 1);

  loadForDate(formatDate(prev));
  loadForDate(formatDate(next));
}

/**
 * Save a single day's log
 */
export async function saveForDate(dateStr, data) {
  logsCache[dateStr] = data;

  const apiKey = localStorage.getItem("apiKey");
  if (!apiKey) return;

  try {
    await fetch(`${apiUrl}/api/day?date=${encodeURIComponent(dateStr)}`, {
      method: "POST",
      body: JSON.stringify(data),
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error(`Failed to save log for ${dateStr}:`, e);
    throw e;
  }
}

/**
 * Legacy save all
 */
export function saveAll(obj) {
  logsCache = { ...logsCache, ...obj };
  const apiKey = localStorage.getItem("apiKey");
  if (!apiKey) return;

  fetch(`${apiUrl}/api/logs`, {
    method: "POST",
    body: JSON.stringify(obj),
    headers: getAuthHeaders(),
  });
}

/**
 * Notes API
 */

export async function getNotesCollections() {
  try {
    const res = await fetch(`${apiUrl}/api/notes/collections`, {
      headers: getAuthHeaders(),
    });
    return await res.json();
  } catch (e) {
    console.error("Failed to get collections:", e);
    return [];
  }
}

export async function saveNotesCollections(collections) {
  try {
    await fetch(`${apiUrl}/api/notes/collections`, {
      method: "POST",
      body: JSON.stringify(collections),
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Failed to save collections:", e);
  }
}

export async function deleteNotesCollection(cid) {
  try {
    await fetch(`${apiUrl}/api/notes/collections/${cid}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Failed to delete collection:", e);
  }
}

export async function getCollectionNotes(cid) {
  try {
    const res = await fetch(`${apiUrl}/api/notes/collections/${cid}/notes`, {
      headers: getAuthHeaders(),
    });
    return await res.json();
  } catch (e) {
    console.error("Failed to get notes:", e);
    return [];
  }
}

export async function saveNote(note) {
  try {
    await fetch(`${apiUrl}/api/notes/notes`, {
      method: "POST",
      body: JSON.stringify(note),
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Failed to save note:", e);
    throw e;
  }
}

export async function getNote(nid) {
  try {
    const res = await fetch(`${apiUrl}/api/notes/notes/${nid}`, {
      headers: getAuthHeaders(),
    });
    return await res.json();
  } catch (e) {
    console.error("Failed to get note:", e);
    return null;
  }
}

export async function deleteNote(nid) {
  try {
    await fetch(`${apiUrl}/api/notes/notes/${nid}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Failed to delete note:", e);
  }
}

/**
 * Local backup
 */
export function backup() {
  const dateStr = formatDate(new Date());
  try {
    localStorage.setItem(
      `${LOCALSTORAGE_KEY}_backup_${dateStr}`,
      JSON.stringify(logsCache),
    );
  } catch (e) {
    console.error("Error saving backup", e);
  }
}
