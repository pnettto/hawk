import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from 'hono/cors';

import { auth } from "./server/middleware/auth.ts";
import { rateLimit } from "./server/middleware/rateLimit.ts";

import { setLogs, getLogs } from "./server/routeHandlers/app.ts";
import { listEntries, setEntry, deleteEntry } from "./server/routeHandlers/kv.ts";

const app = new Hono();

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

// Protected routes: API Logs and KV Entries
app.use("/api/*", rateLimit, auth);

// API Logs
app.post("/api/logs", setLogs);
app.get("/api/logs", getLogs);

// KV Entries
app.get("/api/entries", listEntries);
app.post("/api/entries", setEntry);
app.delete("/api/entries", deleteEntry);

// Serve frontend
app.use("/kv/*", serveStatic({ 
    root: "./kv",
    rewriteRequestPath: (path: string) => path.replace(/^\/kv/, "")
}));
app.use("/*", serveStatic({ root: "./app" }));

// 404 handler
app.notFound((c) => c.text("Not found", 404));

Deno.serve(app.fetch);
