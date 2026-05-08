import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";

import { auth } from "./server/middleware/auth.ts";
import { rateLimit } from "./server/middleware/rateLimit.ts";

import {
  getDayLog,
  getDayVersion,
  getRangeLog,
  listDayVersions,
  restoreDayVersion,
  setDayLog,
} from "./server/routeHandlers/app.ts";
import {
  deleteCollection,
  emptyTrash,
  getCollectionNotes,
  getCollections,
  getNote,
  getNotesIndex,
  getNoteVersion,
  getPublicCollection,
  getPublicNote,
  getSharedCollectionPage,
  getSharedNotePage,
  getTrash,
  listNoteVersions,
  permanentlyDeleteNote,
  restoreNote,
  restoreNoteVersion,
  saveCollections,
  saveNote,
  trashNote,
} from "./server/routeHandlers/notes.ts";
import {
  deleteEntry,
  listEntries,
  setEntry,
} from "./server/routeHandlers/kv.ts";
import { authCheck, login, logout } from "./server/routeHandlers/auth.ts";
import {
  getPreferences,
  patchPreferences,
} from "./server/routeHandlers/preferences.ts";
import { streamSync } from "./server/routeHandlers/sync.ts";

const app = new Hono();

app.onError((err, c) => {
  console.error(`[CRASH] ${err.message}`);
  return c.json({ error: err.message, stack: err.stack }, 500);
});

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

// Protected routes: API Logs and KV Entries (EXCEPT public notes)
app.use(
  "/api/*",
  async (c, next) => {
    const path = c.req.path;
    // SSE stream skips both rate-limit (reconnect storms shouldn't trip the
    // 60/min IP cap) and middleware auth — it authenticates from the query
    // string itself, since EventSource can't set headers.
    if (path === "/api/sync/stream") return await next();
    return await rateLimit(c, next);
  },
  async (c, next) => {
    const path = c.req.path;
    // Skip auth for public, login, logout, auth-check, and sync stream routes
    if (
      path.startsWith("/api/public/") ||
      path === "/api/login" ||
      path === "/api/logout" ||
      path === "/api/auth-check" ||
      path === "/api/sync/stream"
    ) {
      return await next();
    }
    return await auth(c, next);
  },
);

// Per-day API (new)
app.get("/api/day", getDayLog);
app.get("/api/range", getRangeLog);
app.post("/api/day", setDayLog);

// Day log version history
app.get("/api/day/versions", listDayVersions);
app.get("/api/day/versions/one", getDayVersion);
app.post("/api/day/versions/restore", restoreDayVersion);

// Auth API
app.post("/api/login", login);
app.get("/api/logout", logout);
app.get("/api/auth-check", authCheck);

// Notes API
app.get("/api/notes/collections", getCollections);
app.post("/api/notes/collections", saveCollections);
app.delete("/api/notes/collections/:cid", deleteCollection);
app.get("/api/notes/collections/:cid/notes", getCollectionNotes);
app.get("/api/notes/index", getNotesIndex);
app.post("/api/notes/notes", saveNote);
app.get("/api/notes/notes/:nid", getNote);
app.delete("/api/notes/notes/:nid", permanentlyDeleteNote);

// Note version history
app.get("/api/notes/notes/:nid/versions", listNoteVersions);
app.get("/api/notes/notes/:nid/versions/:savedAt", getNoteVersion);
app.post("/api/notes/notes/:nid/versions/:savedAt/restore", restoreNoteVersion);

// Trash Bin API
app.post("/api/notes/notes/:nid/trash", trashNote);
app.post("/api/notes/notes/:nid/restore", restoreNote);
app.get("/api/notes/collections/:cid/trash", getTrash);
app.delete("/api/notes/collections/:cid/trash", emptyTrash);

// Public Note API
app.get("/api/public/notes/:nid", getPublicNote);
app.get("/api/public/collections/:cid", getPublicCollection);

// Public Note View (SSR Page)
app.get("/shared/:nid", getSharedNotePage);
app.get("/shared/collection/:cid", getSharedCollectionPage);

// KV Entries (existing)
app.get("/api/entries", listEntries);
app.post("/api/entries", setEntry);
app.delete("/api/entries", deleteEntry);

// Preferences (theme + future settings)
app.get("/api/preferences", getPreferences);
app.post("/api/preferences", patchPreferences);

// Cross-device sync stream (SSE; auths from query string)
app.get("/api/sync/stream", streamSync);

// Serve frontend
app.use(
  "/kv/*",
  serveStatic({
    root: "./kv",
    rewriteRequestPath: (path: string) => path.replace(/^\/kv/, ""),
  }),
);
// Frontend is built by Vite into app/dist (see app/vite.config.ts).
// In dev, run `deno task dev` — Vite serves the frontend on :5173 and proxies API to this server.
app.use("/*", serveStatic({ root: "./app/dist" }));

// 404 handler
app.notFound((c) => c.text("Not found", 404));

const port = Number(Deno.env.get("PORT")) || 8000;
Deno.serve({ port }, app.fetch);
