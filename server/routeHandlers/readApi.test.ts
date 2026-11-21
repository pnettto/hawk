import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initKv, kv } from "../utils/kvConn.ts";
import type { SqlStorageLike } from "../utils/sqliteKv.ts";
import { type Env, setEnv } from "../utils/env.ts";
import { readToken, sessionToken } from "../middleware/auth.ts";
import { metaKey, metaOf, noteKey, type StoredNote } from "../utils/notesStore.ts";

// Text modules bundled by wrangler; not needed here.
vi.mock("../share_template.html", () => ({ default: "" }));
vi.mock("../shared_collection_template.html", () => ({ default: "" }));

const { app } = await import("../app.ts");

function memoryStorage(): SqlStorageLike {
  const db = new DatabaseSync(":memory:");
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const stmt = db.prepare(query);
        const isRead = /^\s*SELECT/i.test(query);
        const rows = isRead ? stmt.all(...(bindings as never[])) : (stmt.run(...(bindings as never[])), []);
        return { toArray: () => rows as Record<string, unknown>[] };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const ORIGIN = "http://hawk.test";
const DATE = "2026-11-20";
let token = "";

async function call(path: string, init: RequestInit & { auth?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.auth !== false) headers.set("Authorization", `Bearer ${token}`);
  const res = await app.request(`${ORIGIN}${path}`, { ...init, headers });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* not JSON */ }
  return { status: res.status, json: json as Record<string, any>, text };
}

const post = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function putNote(n: Partial<StoredNote> & { id: string }) {
  const note: StoredNote = { title: n.id, content: "", createdAt: 1, updatedAt: 1, rev: 1, tags: [], ...n };
  await kv.set(noteKey(note.id), note);
  await kv.set(metaKey(note.id), metaOf(note));
}

const ids = (r: { json: Record<string, any> }) => (r.json.items as { id: string }[]).map((i) => i.id);

beforeEach(async () => {
  initKv(memoryStorage());
  setEnv({ API_KEY: "secret" } as Env);
  token = await sessionToken();
  await kv.set(["notes", "schema"], 2);
  await kv.set(["logs", "schema"], 2);
  await putNote({ id: "pad", title: "Shopping", content: "Buy **apples**\n\n#home", tags: ["home"], updatedAt: 30 });
  await putNote({ id: "pad2", title: "Ideas", content: "apples again", updatedAt: 10, source: "pi" });
  await putNote({ id: `day-${DATE}`, title: "", content: "Met Ana about apples", day: DATE, updatedAt: 20 });
  await putNote({ id: "old-day", content: "x", day: "2026-11-19", updatedAt: 40 });
  await putNote({ id: "gone", content: "apples in the bin", updatedAt: 50, deletedAt: 60 });
  await putNote({ id: "secret", content: "hidden apples", hidden: true, updatedAt: 5 });
});

describe("auth and errors", () => {
  it("answers 401 without a token", async () => {
    for (const path of ["/api/notes", "/api/notes/pad", `/api/tasks?date=${DATE}`, `/api/reports/${DATE}`]) {
      const r = await call(path, { auth: false });
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: "Unauthorized" });
    }
  });

  it("answers unknown /api routes with JSON 404", async () => {
    const r = await call("/api/nope/really");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "Not found" });
  });
});

describe("read-only token", () => {
  it("is issued by login with scope read, without a cookie", async () => {
    const r = await app.request(`${ORIGIN}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret", scope: "read" }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, token: await readToken(), scope: "read" });
    expect(r.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects an unknown scope", async () => {
    expect((await post("/api/login", { password: "secret", scope: "admin" })).status).toBe(400);
  });

  it("reads the read API", async () => {
    token = await readToken();
    for (const path of ["/api/notes", "/api/notes/pad", `/api/tasks?date=${DATE}`, "/api/search?q=apples"]) {
      expect((await call(path)).status).toBe(200);
    }
    expect((await call("/api/notes/missing")).status).toBe(404);
  });

  it("answers 403 for writes and other routes", async () => {
    token = await readToken();
    const r = await post("/api/notes/notes", { id: "new", content: "x" });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "Read-only token" });
    expect((await call("/api/admin/export")).status).toBe(403);
    expect((await call("/api/preferences")).status).toBe(403);
    expect((await call("/api/notes/notes/pad")).status).toBe(403);
    expect((await call("/api/notes/pad", { method: "DELETE" })).status).toBe(403);
    expect((await kv.get(noteKey("new"))).value).toBeNull();
  });
});

describe("GET /api/notes/:id", () => {
  it("returns the note resource", async () => {
    const r = await call("/api/notes/pad2");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id: "pad2",
      type: "notepad",
      date: null,
      source: "pi",
      author: "pi",
      url: `${ORIGIN}/notes/pad2`,
      content: "apples again",
      trashedAt: null,
      updatedAt: "1970-01-01T00:00:00.010Z",
    });
  });

  it("returns a trashed note with trashedAt", async () => {
    const r = await call("/api/notes/gone");
    expect(r.status).toBe(200);
    expect(r.json.trashedAt).toBe("1970-01-01T00:00:00.060Z");
  });

  it("answers 404 for a missing note", async () => {
    const r = await call("/api/notes/missing");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "Note not found" });
  });

  it("leaves the internal note routes alone", async () => {
    expect(Array.isArray((await call("/api/notes/index")).json)).toBe(true);
    expect((await call("/api/notes/notes/pad")).json.rev).toBe(1);
  });
});

describe("GET /api/notes", () => {
  it("lists newest first without trash or content", async () => {
    const r = await call("/api/notes");
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(["old-day", "pad", `day-${DATE}`, "pad2", "secret"]);
    expect(r.json.truncated).toBe(false);
    const pad = r.json.items[1];
    expect(pad.preview).toBe("Buy apples");
    expect("content" in pad).toBe(false);
    expect("preview" in r.json.items[4]).toBe(false);
  });

  it("filters by type, with note as an alias for notepad", async () => {
    expect(ids(await call("/api/notes?type=journal"))).toEqual(["old-day", `day-${DATE}`]);
    expect(ids(await call("/api/notes?type=notepad"))).toEqual(["pad", "pad2", "secret"]);
    expect(ids(await call("/api/notes?type=note"))).toEqual(["pad", "pad2", "secret"]);
  });

  it("filters by date", async () => {
    expect(ids(await call(`/api/notes?date=${DATE}`))).toEqual([`day-${DATE}`]);
    expect(ids(await call(`/api/notes?date=${DATE}&type=notepad`))).toEqual([]);
  });

  it("searches with the ⌘K syntax", async () => {
    expect(ids(await call("/api/notes?q=apples"))).toEqual(["pad", `day-${DATE}`, "pad2"]);
    expect(ids(await call("/api/notes?q=%23home"))).toEqual(["pad"]);
    expect(ids(await call(`/api/notes?q=apples&type=journal`))).toEqual([`day-${DATE}`]);
    expect(ids(await call(`/api/notes?q=${encodeURIComponent('"about apples"')}`))).toEqual([`day-${DATE}`]);
  });

  it("applies the limit and reports truncation", async () => {
    const r = await call("/api/notes?limit=2");
    expect(ids(r)).toEqual(["old-day", "pad"]);
    expect(r.json.truncated).toBe(true);
    const q = await call("/api/notes?q=apples&limit=1");
    expect(ids(q)).toHaveLength(1);
    expect(q.json.truncated).toBe(true);
    expect((await call("/api/notes?limit=5")).json.truncated).toBe(false);
  });

  it("rejects bad parameters", async () => {
    for (const qs of ["type=report", "date=yesterday", "limit=0", "limit=201", "limit=abc"]) {
      const r = await call(`/api/notes?${qs}`);
      expect(r.status, qs).toBe(400);
      expect(typeof r.json.error).toBe("string");
    }
  });
});

describe("GET /api/tasks", () => {
  it("returns the day's tasks in Journal order", async () => {
    await kv.set(["logs", DATE], JSON.stringify({
      tasks: [
        { id: "b", text: "Later", done: false, order: 2 },
        { id: "a", text: "Review", done: true, order: 9, time: "09:30", updatedAt: 0 },
        { id: "s", text: "Sub", done: false, order: 1, parentId: "b", comment: "c" },
      ],
    }));
    const r = await call(`/api/tasks?date=${DATE}`);
    expect(r.status).toBe(200);
    expect(r.json.date).toBe(DATE);
    expect(r.json.url).toBe(`${ORIGIN}/journal/${DATE}`);
    expect(r.json.tasks.map((t: { id: string }) => t.id)).toEqual(["a", "s", "b"]);
    expect(r.json.tasks[0]).toEqual({
      id: "a", text: "Review", status: "done", time: "09:30", comment: null, parentId: null, order: 9,
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(r.json.tasks[1]).toMatchObject({ parentId: "b", comment: "c", status: "open" });
  });

  it("returns an empty list for an empty day", async () => {
    const r = await call(`/api/tasks?date=${DATE}`);
    expect(r.status).toBe(200);
    expect(r.json.tasks).toEqual([]);
  });

  it("requires a valid date", async () => {
    expect((await call("/api/tasks")).status).toBe(400);
    expect((await call("/api/tasks?date=2026-1-1")).status).toBe(400);
  });
});

describe("GET /api/reports/:date", () => {
  beforeEach(async () => {
    await putNote({ id: `pi-report-pedro-${DATE}`, content: "first", day: DATE, updatedAt: 100, source: "pi" });
    await putNote({ id: `pi-report-pedro-${DATE}-replacement-abc`, content: "second", day: DATE, updatedAt: 200 });
    await putNote({ id: `pi-report-ana-${DATE}`, content: "ana", day: DATE, updatedAt: 150 });
    await putNote({ id: `pi-report-bob-2026-11-19`, content: "", day: "2026-11-19", deletedAt: 5 });
  });

  it("returns the newest report with alternatives", async () => {
    const r = await call(`/api/reports/${DATE}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id: `pi-report-pedro-${DATE}-replacement-abc`,
      type: "journal",
      content: "second",
      alternatives: [`pi-report-ana-${DATE}`, `pi-report-pedro-${DATE}`],
    });
  });

  it("narrows by user", async () => {
    const r = await call(`/api/reports/${DATE}?user=ana`);
    expect(r.json.id).toBe(`pi-report-ana-${DATE}`);
    expect(r.json.alternatives).toEqual([]);
  });

  it("answers 404, saying when the report is in the trash", async () => {
    expect(await call("/api/reports/2026-11-18")).toMatchObject({ status: 404, json: { error: "Report not found" } });
    const trashed = await call("/api/reports/2026-11-19");
    expect(trashed.status).toBe(404);
    expect(trashed.json).toEqual({ error: "Report not found", trashed: true });
  });

  it("rejects a bad date", async () => {
    expect((await call("/api/reports/today")).status).toBe(400);
  });
});

describe("note source", () => {
  it("is set on create and kept on later edits", async () => {
    expect((await post("/api/notes/notes", { id: "n1", content: "hi", source: "pi" })).status).toBe(200);
    await post("/api/notes/notes", { id: "n1", content: "edited", source: "web" });
    expect((await kv.get<StoredNote>(noteKey("n1"))).value?.source).toBe("pi");
    expect((await call("/api/notes/n1")).json.source).toBe("pi");
    expect((await kv.get<{ source?: string }>(metaKey("n1"))).value?.source).toBe("pi");
  });

  it("ignores invalid values", async () => {
    for (const [id, source] of [["n2", "Web"], ["n3", "x".repeat(33)], ["n4", 7], ["n5", "a b"]] as const) {
      await post("/api/notes/notes", { id, content: "", source });
      expect((await call(`/api/notes/${id}`)).json.source, String(source)).toBeNull();
    }
  });

  it("stays unset when an existing note without one is edited", async () => {
    await post("/api/notes/notes", { id: "pad", content: "changed", source: "pi" });
    expect((await call("/api/notes/pad")).json.source).toBeNull();
  });
});
