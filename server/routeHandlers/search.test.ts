import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { initKv, kv } from "../utils/kvConn.ts";
import type { SqlStorageLike } from "../utils/sqliteKv.ts";
import { metaKey, metaOf, noteKey, type StoredNote } from "../utils/notesStore.ts";
import { search } from "./search.ts";

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

const app = new Hono().get("/api/search", search);

async function get(q: string, kind = "all") {
  const res = await app.request(`/api/search?${new URLSearchParams({ q, kind })}`);
  expect(res.status).toBe(200);
  return await res.json() as {
    notes: { id: string; snippet?: string; field: string }[];
    tasks: { id: string; date: string }[];
    truncated: boolean;
  };
}

async function putNote(n: Partial<StoredNote> & { id: string; content: string }) {
  const note: StoredNote = { title: "", createdAt: 1, updatedAt: 1, rev: 1, tags: [], ...n };
  await kv.set(noteKey(note.id), note);
  await kv.set(metaKey(note.id), metaOf(note));
}

beforeEach(async () => {
  initKv(memoryStorage());
  await kv.set(["notes", "schema"], 2);
  await putNote({ id: "a", title: "Garden", content: "**Tomatoes** and [basil](https://x.test/link)\n\n#plants", tags: ["plants"] });
  await putNote({ id: "t", title: "Trashed garden", content: "", deletedAt: 9 });
  await putNote({ id: "h", title: "Diary", content: "my secret tomatoes", hidden: true });
  await kv.set(["logs", "2026-05-14"], JSON.stringify({ tasks: [{ id: "x", text: "Water tomatoes", done: false, order: 0 }] }));
  // Legacy hour-slot shape is normalized on read.
  await kv.set(["logs", "2025-01-01"], JSON.stringify({ "9": { checked: true, text: "Buy tomatoes", comment: "" } }));
  // Version history shares the logs prefix and is skipped.
  await kv.set(["logs", "version_tasks", "2026-05-14", 1], { content: { tasks: [{ id: "v", text: "tomatoes" }] } });
  await kv.set(["logs", "version_tasks_index", "2026-05-14"], [{ savedAt: 1, preview: "tomatoes" }]);
});

describe("GET /api/search", () => {
  it("finds notes and tasks, newest day first", async () => {
    const r = await get("tomatoes");
    expect(r.notes.map((n) => n.id)).toEqual(["a"]);
    expect(r.tasks.map((t) => [t.date, t.id])).toEqual([["2026-05-14", "x"], ["2025-01-01", "legacy-9"]]);
    expect(r.truncated).toBe(false);
  });

  it("matches stripped text, not markdown syntax or the tag line", async () => {
    expect((await get("https")).notes).toEqual([]);
    expect((await get("basil")).notes.map((n) => n.id)).toEqual(["a"]);
    // A plain word still finds the tag, but the tag line isn't body text.
    expect((await get("plants")).notes.map((n) => [n.id, n.field])).toEqual([["a", "tag"]]);
    expect((await get("#plants")).notes.map((n) => n.id)).toEqual(["a"]);
    expect((await get("tomatoes and")).notes[0].snippet).toBe("Tomatoes and basil");
  });

  it("leaves out trash and hidden note bodies", async () => {
    expect((await get("garden")).notes.map((n) => n.id)).toEqual(["a"]);
    const diary = (await get("diary")).notes;
    expect(diary.map((n) => n.id)).toEqual(["h"]);
    expect(diary[0].snippet).toBeUndefined();
  });

  it("honours kind and short queries", async () => {
    expect((await get("tomatoes", "notes")).tasks).toEqual([]);
    expect((await get("tomatoes", "tasks")).notes).toEqual([]);
    expect(await get("t")).toEqual({ notes: [], tasks: [], truncated: false });
  });
});
