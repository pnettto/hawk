// Run with:
// deno run \
//   --env-file=.env \
//   --allow-net \
//   --allow-env \
//   --allow-read \
//   --unstable-kv \
//   --watch \
//   backup.ts

const kv = await Deno.openKv();
const BACKUP_KEY = Deno.env.get("BACKUP_KEY");
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);


if (!BACKUP_KEY) {
  console.error("ERROR: BACKUP_KEY environment variable is not set.");
  Deno.exit(1);
}

if (ALLOWED_ORIGINS.length === 0) {
  console.error("ERROR: ALLOWED_ORIGINS environment variable is not set or empty.");
  Deno.exit(1);
}

const RATE_LIMIT = 10; // max requests
const WINDOW_MS = 60_000; // 1 minute

async function rateLimit(ip: string) {
  const key = ["rate_limit", ip];
  const now = Date.now();

  const record = await kv.get<{ count: number; ts: number }>(key);

  if (!record.value || now - record.value.ts > WINDOW_MS) {
    await kv.set(key, { count: 1, ts: now });
    return true;
  }

  if (record.value.count >= RATE_LIMIT) {
    console.warn(`Rate limit exceeded for IP: ${ip}`);
    return false;
  }

  await kv.set(key, { count: record.value.count + 1, ts: record.value.ts });
  return true;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const origin = req.headers.get("origin") ?? "";

  // Preflight
  if (req.method === "OPTIONS") {
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : "null";

    if (allowed === "null") {
      console.warn(`Denied preflight from origin: ${origin}`);
    }

    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Rate limiting
  if (!(await rateLimit(ip))) {
    return new Response("Too many requests", { status: 429 });
  }

  // POST /backup
  if (req.method === "POST" && url.pathname === "/backup") {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      console.warn(`Denied POST from origin: ${origin}`);
      return new Response("Forbidden", { status: 403 });
    }

    const body = await req.text();
    if (!body) return new Response("Empty body", { status: 400 });

    await kv.set(["backup", BACKUP_KEY], body);
    return new Response("Backup saved", {
      status: 200,
      headers: { "Access-Control-Allow-Origin": origin },
    });
  }

  // GET /recover
  if (req.method === "GET" && url.pathname === "/recover") {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      console.warn(`Denied GET /recover from origin: ${origin}`);
      return new Response("Forbidden", { status: 403 });
    }

    const result = await kv.get<string>(["backup", BACKUP_KEY]);
    if (!result.value) return new Response("Not found", { status: 404 });

    return new Response(result.value, {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "Access-Control-Allow-Origin": origin,
      },
    });
  }

  return new Response("Not Found", { status: 404 });
});
