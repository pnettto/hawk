import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";

import { auth } from "./server/middleware/auth.ts";
import { rateLimit } from "./server/middleware/rateLimit.ts";

import {
  getDayLog,
  getLogs,
  getRangeLog,
  setDayLog,
  setLogs,
} from "./server/routeHandlers/app.ts";
import {
  deleteCollection,
  emptyTrash,
  getCollectionNotes,
  getCollections,
  getNote,
  getNotesIndex,
  getPublicNote,
  getSharedNotePage,
  getTrash,
  permanentlyDeleteNote,
  restoreNote,
  saveCollections,
  saveNote,
  trashNote,
} from "./server/routeHandlers/notes.ts";
import {
  deleteEntry,
  listEntries,
  setEntry,
} from "./server/routeHandlers/kv.ts";
import { logout } from "./server/routeHandlers/auth.ts";

const app = new Hono();

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
  rateLimit,
  async (c, next) => {
    // Skip auth for public routes
    if (c.req.path.startsWith("/api/public/")) {
      await next();
      return;
    }
    await auth(c, next);
  },
);

// API Logs (backwards compatible)
app.get("/api/logs", getLogs);
app.post("/api/logs", setLogs);

// Per-day API (new)
app.get("/api/day", getDayLog);
app.get("/api/range", getRangeLog);
app.post("/api/day", setDayLog);

// Auth API
app.post("/api/logout", logout);

// Notes API
app.get("/api/notes/collections", getCollections);
app.post("/api/notes/collections", saveCollections);
app.delete("/api/notes/collections/:cid", deleteCollection);
app.get("/api/notes/collections/:cid/notes", getCollectionNotes);
app.get("/api/notes/index", getNotesIndex);
app.post("/api/notes/notes", saveNote);
app.get("/api/notes/notes/:nid", getNote);
app.delete("/api/notes/notes/:nid", permanentlyDeleteNote);

// Trash Bin API
app.post("/api/notes/notes/:nid/trash", trashNote);
app.post("/api/notes/notes/:nid/restore", restoreNote);
app.get("/api/notes/collections/:cid/trash", getTrash);
app.delete("/api/notes/collections/:cid/trash", emptyTrash);

// Public Note API
app.get("/api/public/notes/:nid", getPublicNote);

// Public Note View (SSR Page)
app.get("/shared/:nid", getSharedNotePage);

// KV Entries (existing)
app.get("/api/entries", listEntries);
app.post("/api/entries", setEntry);
app.delete("/api/entries", deleteEntry);

// Serve frontend
app.use(
  "/kv/*",
  serveStatic({
    root: "./kv",
    rewriteRequestPath: (path: string) => path.replace(/^\/kv/, ""),
  }),
);
app.use("/*", serveStatic({ root: "./app" }));

// 404 handler
app.notFound((c) => c.text("Not found", 404));

Deno.serve(app.fetch);
