// Hawk's single Hono app: mounts the API under /api/* and serves the built SPA as a static fallback.
import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";

import { auth } from "./server/middleware/auth.ts";
import { loginRateLimit, rateLimit } from "./server/middleware/rateLimit.ts";

import {
  deleteDayNote,
  getDayLog,
  getDayVersion,
  getRangeLog,
  listDayVersions,
  patchDayTasks,
  restoreDayVersion,
  saveDayNote,
  setDayLog,
} from "./server/routeHandlers/app.ts";
import {
  deleteFile,
  deleteFiles,
  getFile,
  getPublicFile,
  listFiles,
  migrateFilesToR2,
  renameFile,
  uploadFile,
} from "./server/routeHandlers/files.ts";
import {
  emptyTrash,
  getDayNotes,
  getNote,
  getNotesIndex,
  getNoteVersion,
  getPublicCollection,
  getPublicNote,
  getSharedCollectionPage,
  getSharedNotePage,
  listNoteVersions,
  permanentlyDeleteNote,
  restoreNote,
  restoreNoteVersion,
  saveNote,
  trashNote,
} from "./server/routeHandlers/notes.ts";
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
    // SSE stream skips rate-limit (reconnect storms shouldn't trip the IP cap)
    // and middleware auth — it authenticates from the query string itself,
    // since EventSource can't set headers.
    if (path === "/api/sync/stream") return await next();
    // Login has its own stricter bucket so brute-force is bounded without
    // sharing the budget with normal API traffic — otherwise a chatty session
    // can drain the general bucket and the user gets 429 on their own login.
    if (path === "/api/login") return await loginRateLimit(c, next);
    // auth-check and logout are cheap, fire on every page load, and aren't
    // attack-worthy — exempting them avoids the cascade that started this bug.
    if (path === "/api/auth-check" || path === "/api/logout") {
      return await next();
    }
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
app.post("/api/day/tasks", patchDayTasks);
app.post("/api/day/notes", saveDayNote);
app.delete("/api/day/notes", deleteDayNote);

// Day log version history
app.get("/api/day/versions", listDayVersions);
app.get("/api/day/versions/one", getDayVersion);
app.post("/api/day/versions/restore", restoreDayVersion);

// Auth API
app.post("/api/login", login);
app.get("/api/logout", logout);
app.get("/api/auth-check", authCheck);

// Notes API
app.get("/api/notes/index", getNotesIndex);
app.get("/api/notes/days", getDayNotes);
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
app.delete("/api/notes/trash", emptyTrash);

// Files
app.get("/api/files", listFiles);
app.post("/api/files", uploadFile);
// Registered before /api/files/:id so "delete"/"migrate" aren't read as file ids.
app.post("/api/files/delete", deleteFiles);
app.post("/api/files/migrate", migrateFilesToR2);
app.get("/api/files/:id", getFile);
app.post("/api/files/:id", renameFile);
app.delete("/api/files/:id", deleteFile);
app.get("/api/public/files/:id", getPublicFile);

// Public Note API
app.get("/api/public/notes/:nid", getPublicNote);
app.get("/api/public/collections/:cid", getPublicCollection);

// Public Note View (SSR Page)
app.get("/shared/:nid", getSharedNotePage);
app.get("/shared/collection/:cid", getSharedCollectionPage);

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
