import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";

import { auth } from "./server/middleware/auth.ts";
import { rateLimit } from "./server/middleware/rateLimit.ts";

import {
  getDayLog,
  getLogs,
  migrateLogs,
  setDayLog,
  setLogs,
} from "./server/routeHandlers/app.ts";
import {
  deleteCollection,
  deleteNote,
  getCollectionNotes,
  getCollections,
  saveCollections,
  saveNote,
} from "./server/routeHandlers/notes.ts";
import {
  deleteEntry,
  listEntries,
  setEntry,
} from "./server/routeHandlers/kv.ts";

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  }),
);

// Protected routes: API Logs and KV Entries
app.use("/api/*", rateLimit, auth);

// API Logs (backwards compatible)
app.get("/api/logs", getLogs);
app.post("/api/logs", setLogs);

// Per-day API (new)
app.get("/api/day", getDayLog);
app.post("/api/day", setDayLog);

// Migration endpoint
app.post("/api/migrate", migrateLogs);

// Notes API
app.get("/api/notes/collections", getCollections);
app.post("/api/notes/collections", saveCollections);
app.delete("/api/notes/collections/:cid", deleteCollection);
app.get("/api/notes/collections/:cid/notes", getCollectionNotes);
app.post("/api/notes/notes", saveNote);
app.delete("/api/notes/notes/:nid", deleteNote);

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
