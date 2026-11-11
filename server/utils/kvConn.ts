import { SqliteKv, type SqlStorageLike } from "./sqliteKv.ts";

// The store lives in the Durable Object's SQLite (see server/hawkDO.ts), which
// calls initKv() from its constructor before handling any request. Handlers
// import `kv` as before; ES module live bindings pick up the instance.
export let kv: SqliteKv;

export function initKv(storage: SqlStorageLike) {
  kv = new SqliteKv(storage);
}
