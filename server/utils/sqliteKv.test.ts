import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeKey, encodeKey, type KvKey, SqliteKv, type SqlStorageLike } from "./sqliteKv.ts";

// Stand-in for DurableObjectStorage backed by node:sqlite.
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

async function keys(iter: AsyncIterable<{ key: KvKey }>) {
  const out: KvKey[] = [];
  for await (const e of iter) out.push(e.key);
  return out;
}

describe("key encoding", () => {
  it("round-trips every part type", () => {
    const key: KvKey = ["a\u0000b", 3.5, -2, 0, 12n, -7n, true, false, new Uint8Array([0, 1, 255])];
    expect(decodeKey(encodeKey(key))).toEqual(key);
  });

  it("orders like Deno KV", () => {
    const sorted: KvKey[] = [
      [new Uint8Array([1])],
      [""],
      ["a"],
      ["a", 1],
      ["a\u0000"],
      ["ab"],
      ["b"],
      ["\uffff"],
      [-Infinity],
      [-1.5],
      [0],
      [2],
      [10],
      [Infinity],
      [-5n],
      [5n],
      [false],
      [true],
    ];
    const cmp = (a: Uint8Array, b: Uint8Array) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
      return a.length - b.length;
    };
    const shuffled = [...sorted].reverse();
    shuffled.sort((a, b) => cmp(encodeKey(a), encodeKey(b)));
    expect(shuffled).toEqual(sorted);
  });
});

describe("SqliteKv", () => {
  let kv: SqliteKv;
  beforeEach(() => {
    kv = new SqliteKv(memoryStorage());
  });

  it("gets, sets and deletes", async () => {
    expect(await kv.get(["x"])).toEqual({ key: ["x"], value: null, versionstamp: null });
    const { versionstamp } = await kv.set(["x"], { a: 1 });
    expect(await kv.get(["x"])).toEqual({ key: ["x"], value: { a: 1 }, versionstamp });
    await kv.delete(["x"]);
    expect((await kv.get(["x"])).value).toBeNull();
  });

  it("stores raw bytes and strings that look like JSON", async () => {
    await kv.set(["b"], new Uint8Array([0, 9, 255]));
    await kv.set(["s"], '{"a":1}');
    expect((await kv.get(["b"])).value).toEqual(new Uint8Array([0, 9, 255]));
    expect((await kv.get(["s"])).value).toBe('{"a":1}');
  });

  it("getMany keeps order and reports misses", async () => {
    await kv.set(["a"], 1);
    await kv.set(["c"], 3);
    const res = await kv.getMany<[number, number, number]>([["a"], ["b"], ["c"]]);
    expect(res.map((r) => r.value)).toEqual([1, null, 3]);
  });

  it("lists by prefix, excluding the prefix key itself", async () => {
    await kv.set(["notes", "meta"], "self");
    await kv.set(["notes", "meta", "b"], 2);
    await kv.set(["notes", "meta", "a"], 1);
    await kv.set(["notes", "metaX", "z"], 0);
    await kv.set(["notes", "note", "a"], 0);
    expect(await keys(kv.list({ prefix: ["notes", "meta"] }))).toEqual([
      ["notes", "meta", "a"],
      ["notes", "meta", "b"],
    ]);
  });

  it("lists by start/end with limit and reverse", async () => {
    for (const d of ["2024-01-01", "2024-01-02", "2024-01-03"]) await kv.set(["logs", d], d);
    await kv.set(["logs", "version_notes", "x", 1], 0);
    // The range used by getRangeLog.
    expect(await keys(kv.list({ start: ["logs", "2024-01-02"], end: ["logs", "2024-01-03\uffff"] }))).toEqual([
      ["logs", "2024-01-02"],
      ["logs", "2024-01-03"],
    ]);
    // The range used by the notes migration skips version rows.
    expect((await keys(kv.list({ start: ["logs", "0"], end: ["logs", ":"] }))).length).toBe(3);
    expect(await keys(kv.list({ prefix: ["logs"] }, { limit: 2, reverse: true }))).toEqual([
      ["logs", "version_notes", "x", 1],
      ["logs", "2024-01-03"],
    ]);
    expect((await keys(kv.list({ prefix: [] }))).length).toBe(4);
  });

  it("commits atomically only when checks pass", async () => {
    const first = await kv.get(["n"]);
    expect((await kv.atomic().check(first).set(["n"], 1).set(["m"], 1).commit()).ok).toBe(true);
    // Stale check (key now exists) fails and writes nothing.
    const stale = await kv.atomic().check(first).set(["n"], 2).delete(["m"]).commit();
    expect(stale.ok).toBe(false);
    expect((await kv.get(["n"])).value).toBe(1);
    expect((await kv.get(["m"])).value).toBe(1);
    // Fresh check passes.
    const cur = await kv.get(["n"]);
    expect((await kv.atomic().check(cur).set(["n"], 2).delete(["m"]).commit()).ok).toBe(true);
    expect((await kv.get(["n"])).value).toBe(2);
    expect((await kv.get(["m"])).value).toBeNull();
  });

  it("never reuses a versionstamp, even after deleting the newest row", async () => {
    const storage = memoryStorage();
    const a = new SqliteKv(storage);
    await a.set(["old"], 0);
    const v1 = (await a.set(["k"], 1)).versionstamp;
    await a.delete(["k"]);
    const b = new SqliteKv(storage);
    const v2 = (await b.set(["k"], 2)).versionstamp;
    expect(v2 > v1).toBe(true);
  });
});
