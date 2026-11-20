import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initKv, kv } from "../utils/kvConn.ts";
import type { SqlStorageLike } from "../utils/sqliteKv.ts";
import { setBroadcaster, type SyncEvent } from "../utils/syncEvents.ts";
import { listVersions, getVersion } from "../utils/versioning.ts";
import { moveTasksBetween, type Task } from "../utils/dayLog.ts";
import { moveDayTasks } from "./app.ts";

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

const app = new Hono()
  .onError((err, c) => c.json({ error: err.message }, 500))
  .post("/api/day/tasks/move", moveDayTasks);

const FROM = "2026-05-14";
const TO = "2026-05-15";

const t = (id: string, order: number, extra: Partial<Task> = {}): Task => ({
  id,
  text: id.toUpperCase(),
  done: false,
  order,
  ...extra,
});

async function putDay(date: string, tasks: Task[]) {
  await kv.set(["logs", date], JSON.stringify({ tasks, notes: [] }));
}

async function readDay(date: string): Promise<Task[]> {
  const res = await kv.get<string>(["logs", date]);
  return res.value ? JSON.parse(res.value).tasks : [];
}

async function move(body: unknown) {
  const res = await app.request("/api/day/tasks/move", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": "tab-1" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

let events: SyncEvent[] = [];

beforeEach(async () => {
  initKv(memoryStorage());
  events = [];
  setBroadcaster((e) => events.push(e));
  await putDay(FROM, [
    t("a", 1, { done: true, comment: "note" }),
    t("g", 2),
    t("g1", 1, { parentId: "g", done: true }),
    t("g2", 2, { parentId: "g", time: "10:00" }),
    t("timed", 3, { time: "09:00" }),
    t("stay", 4),
  ]);
  await putDay(TO, [t("x", 5), t("y", 9), t("late", 50, { time: "18:00" })]);
});

describe("POST /api/day/tasks/move", () => {
  it("moves tasks with their subtasks, keeping ids and fields", async () => {
    const { status, json } = await move({ from: FROM, to: TO, ids: ["g", "a"] });
    expect(status).toBe(200);
    expect(json.moved).toEqual(["a", "g", "g1", "g2"]);
    const from = await readDay(FROM);
    const to = await readDay(TO);
    expect(from.map((x) => x.id)).toEqual(["timed", "stay"]);
    const byId = new Map(to.map((x) => [x.id, x]));
    expect(byId.get("a")).toMatchObject({ done: true, comment: "note" });
    expect(byId.get("g1")).toMatchObject({ parentId: "g", done: true, order: 1 });
    expect(byId.get("g2")).toMatchObject({ parentId: "g", time: "10:00", order: 2 });
    expect(byId.get("a")!.updatedAt).toBeTypeOf("number");
    expect((json.to as { tasks: Task[] }).tasks).toEqual(to);
    expect((json.from as { tasks: Task[] }).tasks).toEqual(from);
  });

  it("puts moved untimed tasks after the target's untimed tasks, in their order", async () => {
    await move({ from: FROM, to: TO, ids: ["stay", "g", "a", "timed"] });
    const to = await readDay(TO);
    const order = (id: string) => to.find((x) => x.id === id)!.order;
    // Timed tasks keep their time; untimed land after y (order 9).
    expect(to.find((x) => x.id === "timed")!.time).toBe("09:00");
    expect(order("a")).toBeGreaterThan(9);
    expect(order("a")).toBeLessThan(order("g"));
    expect(order("g")).toBeLessThan(order("stay"));
  });

  it("pins explicit orders, so undo puts tasks back in place", async () => {
    await move({ from: FROM, to: TO, ids: ["g"] });
    await move({ from: TO, to: FROM, ids: ["g"], orders: { g: 2 } });
    const from = await readDay(FROM);
    expect(from.find((x) => x.id === "g")!.order).toBe(2);
    expect(from.filter((x) => x.parentId === "g").map((x) => x.id).sort()).toEqual(["g1", "g2"]);
  });

  it("gives a clashing id a new one and remaps its subtasks", async () => {
    await putDay(TO, [t("g", 1, { text: "Other" })]);
    const { json } = await move({ from: FROM, to: TO, ids: ["g"] });
    const moved = json.moved as string[];
    expect(moved).toHaveLength(3);
    const newId = moved[0];
    expect(newId).not.toBe("g");
    const to = await readDay(TO);
    expect(to.find((x) => x.id === "g")!.text).toBe("Other");
    expect(to.find((x) => x.id === newId)!.text).toBe("G");
    expect(to.filter((x) => x.parentId === newId).map((x) => x.id).sort()).toEqual(["g1", "g2"]);
  });

  it("ignores unknown ids and leaves both days alone", async () => {
    const before = [await readDay(FROM), await readDay(TO)];
    const { status, json } = await move({ from: FROM, to: TO, ids: ["nope"] });
    expect(status).toBe(200);
    expect(json.moved).toEqual([]);
    expect([await readDay(FROM), await readDay(TO)]).toEqual(before);
    expect(events).toEqual([]);
  });

  it("rejects bad requests", async () => {
    expect((await move({ from: FROM, to: FROM, ids: ["a"] })).status).toBe(400);
    expect((await move({ from: FROM, to: TO, ids: [] })).status).toBe(400);
    expect((await move({ from: "yesterday", to: TO, ids: ["a"] })).status).toBe(400);
  });

  it("returns 413 when the target would get too large, changing nothing", async () => {
    await putDay(TO, [t("big", 1, { text: "x".repeat(63 * 1024 - 100) })]);
    const before = await readDay(FROM);
    const { status, json } = await move({ from: FROM, to: TO, ids: ["a"] });
    expect(status).toBe(413);
    expect(json.error).toBe("Day is too large");
    expect(await readDay(FROM)).toEqual(before);
  });

  it("snapshots both days and tells other clients about both", async () => {
    await move({ from: FROM, to: TO, ids: ["a"] });
    for (const date of [FROM, TO]) {
      const [latest] = await listVersions("day-tasks", date);
      const v = await getVersion<{ tasks: Task[] }>("day-tasks", date, latest.savedAt);
      // The snapshot is the day as it was before the move.
      expect(v!.content.tasks.some((x) => x.id === "a")).toBe(date === FROM);
    }
    expect(events.map((e) => [e.type, e.ref, e.originClientId])).toEqual([
      ["log.saved", FROM, "tab-1"],
      ["log.saved", TO, "tab-1"],
    ]);
  });

  it("retries when the target changes mid-write and keeps both changes", async () => {
    const atomic = kv.atomic.bind(kv);
    let raced = false;
    const spy = vi.spyOn(kv, "atomic").mockImplementation(() => {
      const op = atomic();
      const commit = op.commit.bind(op);
      op.commit = async () => {
        if (!raced) {
          raced = true;
          // Another device adds a task between our read and our write.
          await putDay(TO, [...await readDay(TO), t("other", 7)]);
        }
        return commit();
      };
      return op;
    });
    const { status } = await move({ from: FROM, to: TO, ids: ["a"] });
    spy.mockRestore();
    expect(status).toBe(200);
    const to = await readDay(TO);
    expect(to.map((x) => x.id)).toEqual(expect.arrayContaining(["other", "a"]));
    expect((await readDay(FROM)).some((x) => x.id === "a")).toBe(false);
  });

  it("never applies half a move when the write keeps losing", async () => {
    const before = [await readDay(FROM), await readDay(TO)];
    const atomic = kv.atomic.bind(kv);
    let n = 0;
    const spy = vi.spyOn(kv, "atomic").mockImplementation(() => {
      const op = atomic();
      const commit = op.commit.bind(op);
      op.commit = async () => {
        // Bump only the target key; the source write must not go through alone.
        await kv.set(["logs", TO], JSON.stringify({ tasks: before[1], notes: [], n: n++ }));
        return commit();
      };
      return op;
    });
    const { status } = await move({ from: FROM, to: TO, ids: ["a"] });
    spy.mockRestore();
    expect(status).toBe(500);
    expect(await readDay(FROM)).toEqual(before[0]);
    expect(await readDay(TO)).toEqual(before[1]);
  });
});

describe("moveTasksBetween", () => {
  it("makes a subtask moved without its group top-level", () => {
    const r = moveTasksBetween([t("p", 1), t("c", 1, { parentId: "p" })], [], ["c"]);
    expect(r.to[0].parentId).toBeUndefined();
    expect(r.from.map((x) => x.id)).toEqual(["p"]);
  });
});
