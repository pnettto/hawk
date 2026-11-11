// A small Deno.Kv-compatible store on top of a Durable Object's SQLite.
//
// It implements only the subset Hawk uses: get, getMany, set, delete, list
// (prefix / start / end / limit / reverse) and atomic() with check/set/delete.
// Route handlers keep the exact key shapes they had on Deno KV, so the data
// migrates as a straight key-for-key copy.
//
// Keys are stored as an order-preserving binary encoding (see encodeKey), so
// SQLite's memcmp ordering of BLOBs matches Deno KV's key ordering and range
// queries map onto `k >= ? AND k < ?`.
//
// Everything here runs synchronously inside the Durable Object (SQL calls are
// synchronous there), so each commit is atomic. The async signatures only
// mirror Deno.Kv so callers didn't have to change.

export type KvKeyPart = Uint8Array | string | number | bigint | boolean;
export type KvKey = readonly KvKeyPart[];

export interface KvEntry<T> {
  key: KvKey;
  value: T;
  versionstamp: string;
}

export type KvEntryMaybe<T> = KvEntry<T> | {
  key: KvKey;
  value: null;
  versionstamp: null;
};

export type KvListSelector =
  | { prefix: KvKey }
  | { prefix: KvKey; start: KvKey }
  | { prefix: KvKey; end: KvKey }
  | { start: KvKey; end: KvKey };

export interface KvListOptions {
  limit?: number;
  reverse?: boolean;
}

export interface KvCommitResult {
  ok: true;
  versionstamp: string;
}
export interface KvCommitError {
  ok: false;
}

// The slice of DurableObjectStorage this module needs. Kept structural so tests
// can pass any SQLite-backed implementation.
export interface SqlStorageLike {
  sql: {
    exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
  };
  transactionSync<T>(fn: () => T): T;
}

// ---- key encoding ------------------------------------------------------------

// Type tags follow Deno KV's cross-type order:
// Uint8Array < string < number < bigint < boolean.
const T_BYTES = 0x01;
const T_STRING = 0x02;
const T_NUMBER = 0x03;
const T_BIGINT = 0x04;
const T_FALSE = 0x05;
const T_TRUE = 0x06;

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

// 0x00 inside bytes/strings is escaped as 0x00 0xFF; 0x00 alone terminates.
function pushEscaped(out: number[], bytes: Uint8Array) {
  for (const b of bytes) {
    out.push(b);
    if (b === 0) out.push(0xff);
  }
  out.push(0);
}

export function encodeKey(key: KvKey): Uint8Array {
  const out: number[] = [];
  for (const part of key) {
    if (part instanceof Uint8Array) {
      out.push(T_BYTES);
      pushEscaped(out, part);
    } else if (typeof part === "string") {
      out.push(T_STRING);
      pushEscaped(out, utf8.encode(part));
    } else if (typeof part === "number") {
      out.push(T_NUMBER);
      const buf = new DataView(new ArrayBuffer(8));
      buf.setFloat64(0, part === 0 ? 0 : part); // fold -0 into 0
      const bytes = new Uint8Array(buf.buffer);
      // Flip so byte order matches numeric order.
      if (bytes[0] & 0x80) for (let i = 0; i < 8; i++) bytes[i] ^= 0xff;
      else bytes[0] ^= 0x80;
      out.push(...bytes);
    } else if (typeof part === "bigint") {
      if (part < -(2n ** 63n) || part >= 2n ** 63n) throw new RangeError("bigint key part out of range");
      out.push(T_BIGINT);
      const buf = new DataView(new ArrayBuffer(8));
      buf.setBigUint64(0, BigInt.asUintN(64, part + 2n ** 63n));
      out.push(...new Uint8Array(buf.buffer));
    } else if (typeof part === "boolean") {
      out.push(part ? T_TRUE : T_FALSE);
    } else {
      throw new TypeError(`Unsupported key part: ${typeof part}`);
    }
  }
  return new Uint8Array(out);
}

function readEscaped(bytes: Uint8Array, i: number): [Uint8Array, number] {
  const out: number[] = [];
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b === 0) {
      if (bytes[i] === 0xff) {
        out.push(0);
        i++;
        continue;
      }
      break;
    }
    out.push(b);
  }
  return [new Uint8Array(out), i];
}

export function decodeKey(bytes: Uint8Array): KvKey {
  const key: KvKeyPart[] = [];
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i++];
    if (tag === T_BYTES || tag === T_STRING) {
      const [raw, next] = readEscaped(bytes, i);
      key.push(tag === T_STRING ? utf8d.decode(raw) : raw);
      i = next;
    } else if (tag === T_NUMBER) {
      const b = bytes.slice(i, i + 8);
      if (b[0] & 0x80) b[0] ^= 0x80;
      else for (let j = 0; j < 8; j++) b[j] ^= 0xff;
      key.push(new DataView(b.buffer).getFloat64(0));
      i += 8;
    } else if (tag === T_BIGINT) {
      const v = new DataView(bytes.slice(i, i + 8).buffer).getBigUint64(0);
      key.push(v - 2n ** 63n);
      i += 8;
    } else if (tag === T_FALSE || tag === T_TRUE) {
      key.push(tag === T_TRUE);
    } else {
      throw new Error(`Corrupt key (tag ${tag})`);
    }
  }
  return key;
}

// ---- value encoding ----------------------------------------------------------

// Uint8Array values (legacy file chunks) are stored raw; everything else as
// JSON. Hawk only stores JSON-shaped values and byte arrays.
const V_JSON = 0;
const V_BYTES = 1;

function encodeValue(value: unknown): [number, string | Uint8Array] {
  if (value instanceof Uint8Array) return [V_BYTES, value];
  if (value === undefined) throw new TypeError("Cannot store undefined");
  return [V_JSON, JSON.stringify(value)];
}

function decodeValue(t: number, v: unknown): unknown {
  if (t === V_BYTES) return new Uint8Array(v as ArrayBuffer);
  return JSON.parse(v as string);
}

// ---- store -------------------------------------------------------------------

const vsString = (n: number) => n.toString(16).padStart(20, "0");

interface Row {
  k: ArrayBuffer;
  t: number;
  v: unknown;
  vs: number;
}

type Mutation = { type: "set"; key: KvKey; value: unknown } | { type: "delete"; key: KvKey };

export class SqliteKv {
  #storage: SqlStorageLike;
  #vs: number;

  constructor(storage: SqlStorageLike) {
    this.#storage = storage;
    storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS kv (
         k BLOB PRIMARY KEY,
         t INTEGER NOT NULL,
         v NOT NULL,
         vs INTEGER NOT NULL
       ) WITHOUT ROWID`,
    );
    // The versionstamp counter is persisted on its own, so deleting the newest
    // row can never let a versionstamp be handed out twice.
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv_meta (name TEXT PRIMARY KEY, n INTEGER NOT NULL)`);
    const [row] = storage.sql.exec(`SELECT n FROM kv_meta WHERE name = 'vs'`).toArray();
    this.#vs = Number(row?.n ?? 0);
  }

  #exec(query: string, ...bindings: unknown[]) {
    return this.#storage.sql.exec(query, ...bindings).toArray() as unknown as Row[];
  }

  #getSync<T>(key: KvKey): KvEntryMaybe<T> {
    const [row] = this.#exec(`SELECT t, v, vs FROM kv WHERE k = ?`, encodeKey(key));
    if (!row) return { key, value: null, versionstamp: null };
    return { key, value: decodeValue(row.t, row.v) as T, versionstamp: vsString(row.vs) };
  }

  #write(muts: Mutation[]): string {
    const vs = ++this.#vs;
    this.#exec(
      `INSERT INTO kv_meta (name, n) VALUES ('vs', ?) ON CONFLICT(name) DO UPDATE SET n = excluded.n`,
      vs,
    );
    for (const m of muts) {
      if (m.type === "set") {
        const [t, v] = encodeValue(m.value);
        this.#exec(
          `INSERT INTO kv (k, t, v, vs) VALUES (?, ?, ?, ?)
           ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v, vs = excluded.vs`,
          encodeKey(m.key),
          t,
          v,
          vs,
        );
      } else {
        this.#exec(`DELETE FROM kv WHERE k = ?`, encodeKey(m.key));
      }
    }
    return vsString(vs);
  }

  get<T = unknown>(key: KvKey): Promise<KvEntryMaybe<T>> {
    return Promise.resolve(this.#getSync<T>(key));
  }

  getMany<T extends readonly unknown[]>(
    keys: readonly KvKey[],
  ): Promise<{ [K in keyof T]: KvEntryMaybe<T[K]> }> {
    return Promise.resolve(keys.map((k) => this.#getSync(k)) as { [K in keyof T]: KvEntryMaybe<T[K]> });
  }

  set(key: KvKey, value: unknown): Promise<KvCommitResult> {
    const versionstamp = this.#storage.transactionSync(() => this.#write([{ type: "set", key, value }]));
    return Promise.resolve({ ok: true, versionstamp });
  }

  delete(key: KvKey): Promise<void> {
    this.#storage.transactionSync(() => this.#write([{ type: "delete", key }]));
    return Promise.resolve();
  }

  list<T = unknown>(selector: KvListSelector, options: KvListOptions = {}): AsyncIterableIterator<KvEntry<T>> {
    const prefix = "prefix" in selector ? encodeKey(selector.prefix) : null;
    const start = "start" in selector ? encodeKey(selector.start) : null;
    const end = "end" in selector ? encodeKey(selector.end) : null;

    const where: string[] = [];
    const args: unknown[] = [];
    if (start) {
      where.push("k >= ?");
      args.push(start);
    } else if (prefix) {
      // Deno KV's prefix lists exclude the prefix key itself.
      where.push("k > ?");
      args.push(prefix);
    }
    if (end) {
      where.push("k < ?");
      args.push(end);
    } else if (prefix) {
      // Every child key continues with a type tag below 0xFF.
      const upper = new Uint8Array(prefix.length + 1);
      upper.set(prefix);
      upper[prefix.length] = 0xff;
      where.push("k < ?");
      args.push(upper);
    }
    let query = `SELECT k, t, v, vs FROM kv`;
    if (where.length) query += ` WHERE ${where.join(" AND ")}`;
    query += ` ORDER BY k ${options.reverse ? "DESC" : "ASC"}`;
    if (options.limit) {
      query += ` LIMIT ?`;
      args.push(options.limit);
    }
    const rows = this.#exec(query, ...args);
    const entries = rows.map((r) => ({
      key: decodeKey(new Uint8Array(r.k)),
      value: decodeValue(r.t, r.v) as T,
      versionstamp: vsString(r.vs),
    }));
    return (async function* () {
      yield* entries;
    })();
  }

  atomic(): AtomicOperation {
    return new AtomicOperation((checks, muts) =>
      this.#storage.transactionSync(() => {
        for (const c of checks) {
          const cur = this.#getSync(c.key).versionstamp;
          if (cur !== c.versionstamp) return { ok: false } as const;
        }
        return { ok: true, versionstamp: this.#write(muts) } as const;
      }));
  }
}

type Check = { key: KvKey; versionstamp: string | null };
type CommitFn = (checks: Check[], muts: Mutation[]) => KvCommitResult | KvCommitError;

export class AtomicOperation {
  #checks: Check[] = [];
  #muts: Mutation[] = [];
  #commit: CommitFn;

  constructor(commit: CommitFn) {
    this.#commit = commit;
  }

  check(...checks: Check[]): this {
    for (const c of checks) this.#checks.push({ key: c.key, versionstamp: c.versionstamp });
    return this;
  }

  set(key: KvKey, value: unknown): this {
    this.#muts.push({ type: "set", key, value });
    return this;
  }

  delete(key: KvKey): this {
    this.#muts.push({ type: "delete", key });
    return this;
  }

  commit(): Promise<KvCommitResult | KvCommitError> {
    return Promise.resolve(this.#commit(this.#checks, this.#muts));
  }
}
