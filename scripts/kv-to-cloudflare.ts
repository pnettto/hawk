// Copy every Deno KV entry into the Cloudflare backend, key for key.
//
//   # 1. Dump a Deno KV to a file (local path, or a KV Connect URL with
//   #    DENO_KV_ACCESS_TOKEN set):
//   deno run -A --unstable-kv scripts/kv-to-cloudflare.ts dump <kv-url-or-path> kv-export.json
//
//   # 2. Load the file into the Worker (HAWK_PASSWORD = the API_KEY password):
//   HAWK_PASSWORD=… deno run -A scripts/kv-to-cloudflare.ts load kv-export.json https://hawk.pnetto.store
//
// The dump contains every note, private ones included. Keep it outside the
// repo or rely on the kv-export*.json rule in .gitignore; never commit it.
//
// Skipped: the old SSE sync queue and rate-limit counters (not used anymore)
// and Deno.KvU64 values (only the old sync tail counter).
//
// Wire format matches server/routeHandlers/admin.ts.

type WirePart = string | number | boolean | { $bytes: string } | { $bigint: string };
type WireEntry = { key: WirePart[]; value: unknown } | { key: WirePart[]; bytes: string };

const SKIP_PREFIXES = ["sync", "rate_limit", "login_rate_limit"];

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function partToWire(p: Deno.KvKeyPart): WirePart {
  if (p instanceof Uint8Array) return { $bytes: b64(p) };
  if (typeof p === "bigint") return { $bigint: p.toString() };
  return p;
}

async function dump(source: string, out: string) {
  const kv = await Deno.openKv(source);
  const entries: WireEntry[] = [];
  const skipped: Record<string, number> = {};
  for await (const e of kv.list({ prefix: [] })) {
    const head = String(e.key[0]);
    if (SKIP_PREFIXES.includes(head) || e.value instanceof Deno.KvU64) {
      skipped[head] = (skipped[head] ?? 0) + 1;
      continue;
    }
    const key = e.key.map(partToWire);
    entries.push(e.value instanceof Uint8Array ? { key, bytes: b64(e.value) } : { key, value: e.value });
  }
  kv.close();
  await Deno.writeTextFile(out, JSON.stringify(entries));
  console.log(`Wrote ${entries.length} entries to ${out}`);
  if (Object.keys(skipped).length) console.log("Skipped:", skipped);
  summarize(entries);
}

async function load(file: string, base: string) {
  const password = Deno.env.get("HAWK_PASSWORD");
  if (!password) throw new Error("Set HAWK_PASSWORD");
  base = base.replace(/\/$/, "");
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const { token } = await login.json();

  const entries = JSON.parse(await Deno.readTextFile(file)) as WireEntry[];
  // Batches stay well under request size limits (notes are capped at 64 KiB).
  const MAX_BATCH_BYTES = 2 * 1024 * 1024;
  let batch: WireEntry[] = [];
  let bytes = 0;
  let sent = 0;
  const flush = async () => {
    if (!batch.length) return;
    const res = await fetch(`${base}/api/admin/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entries: batch }),
    });
    if (!res.ok) throw new Error(`Import failed at entry ${sent}: ${res.status} ${await res.text()}`);
    sent += batch.length;
    console.log(`Imported ${sent}/${entries.length}`);
    batch = [];
    bytes = 0;
  };
  for (const e of entries) {
    const size = JSON.stringify(e).length;
    if (batch.length && (bytes + size > MAX_BATCH_BYTES || batch.length >= 200)) await flush();
    batch.push(e);
    bytes += size;
  }
  await flush();
  summarize(entries);
}

// Counts per key family, to compare against the app after the import.
function summarize(entries: WireEntry[]) {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    const fam = e.key.slice(0, 2)
      .map((p) => (typeof p === "object" ? "?" : String(p).replace(/^\d{4}-\d{2}-\d{2}$/, "<date>")))
      .join("/");
    counts[fam] = (counts[fam] ?? 0) + 1;
  }
  console.table(counts);
}

const [cmd, a, b] = Deno.args;
if (cmd === "dump" && a && b) await dump(a, b);
else if (cmd === "load" && a && b) await load(a, b);
else {
  console.error("Usage:\n  kv-to-cloudflare.ts dump <kv-url-or-path> <out.json>\n  kv-to-cloudflare.ts load <in.json> <worker-url>");
  Deno.exit(2);
}
