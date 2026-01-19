import { LOCALSTORAGE_KEY } from "../global.js";
import { formatDate } from "./date.js";

const apiUrl = localStorage.getItem("API_URL") ||
  "https://hawk.pnettto.deno.net";

console.log(`[Storage] API Root: ${apiUrl || "(relative local)"}`);

// Cache for loaded logs
let logsCache = {};
const pendingRequests = new Map();

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

function getAuthHeaders() {
  const apiKey = getCookie("hawk_token");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function logout() {
  try {
    await fetch(`${apiUrl}/api/logout`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Logout failed:", e);
  }
}

/**
 * Load all logs (needed for reports)
 */
export async function loadAll() {
  const apiKey = getCookie("hawk_token");
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
export function loadForDate(dateStr, force = false) {
  // 1. Check cache
  if (!force && logsCache[dateStr]) {
    return logsCache[dateStr];
  }

  // 2. Check if already fetching
  if (pendingRequests.has(dateStr)) {
    return pendingRequests.get(dateStr);
  }

  // 3. Fetch from API
  const apiKey = getCookie("hawk_token");
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
  const apiKey = getCookie("hawk_token");
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

  const apiKey = getCookie("hawk_token");
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
  const apiKey = getCookie("hawk_token");
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

export async function getNotesIndex() {
  try {
    const res = await fetch(`${apiUrl}/api/notes/index`, {
      headers: getAuthHeaders(),
    });
    return await res.json();
  } catch (e) {
    console.error("Failed to get notes index:", e);
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

export async function deleteNote(nid, cid) {
  try {
    await fetch(`${apiUrl}/api/notes/notes/${nid}/trash`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ cid }),
    });
  } catch (e) {
    console.error("Failed to trash note:", e);
  }
}

export async function permanentlyDeleteNote(nid) {
  try {
    await fetch(`${apiUrl}/api/notes/notes/${nid}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Failed to permanently delete note:", e);
  }
}

export async function restoreNote(nid) {
  try {
    await fetch(`${apiUrl}/api/notes/notes/${nid}/restore`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Failed to restore note:", e);
  }
}

export async function getTrash(cid) {
  try {
    const res = await fetch(`${apiUrl}/api/notes/collections/${cid}/trash`, {
      headers: getAuthHeaders(),
    });
    return await res.json();
  } catch (e) {
    console.error("Failed to get trash:", e);
    return [];
  }
}

export async function emptyTrash(cid) {
  try {
    await fetch(`${apiUrl}/api/notes/collections/${cid}/trash`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("Failed to empty trash:", e);
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
