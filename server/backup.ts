// Run locally with:
// deno run \
//   --env-file=.env \
//   --allow-net \
//   --allow-env \
//   --allow-read \
//   --unstable-kv \
//   --watch \
//   backup.ts

const kv = await Deno.openKv();

// Read environment variables
const BACKUP_KEY = Deno.env.get("BACKUP_KEY");
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Kill app if required env vars are missing
if (!BACKUP_KEY) {
  console.error("ERROR: BACKUP_KEY environment variable is not set.");
  Deno.exit(1);
}

if (ALLOWED_ORIGINS.length === 0) {
  console.error("ERROR: ALLOWED_ORIGINS environment variable is not set or empty.");
  Deno.exit(1);
}

console.log("Server starting with config:", {
  allowedOrigins: ALLOWED_ORIGINS,
  rateLimit: 10,
  windowMs: 60000
});

// Rate limiting settings
const RATE_LIMIT = 10; // max requests
const WINDOW_MS = 60_000; // 1 minute

async function rateLimit(ip: string) {
  const key = ["rate_limit", ip];
  const now = Date.now();

  const record = await kv.get<{ count: number; ts: number }>(key);

  if (!record.value || now - record.value.ts > WINDOW_MS) {
    await kv.set(key, { count: 1, ts: now });
    console.log(`[RATE_LIMIT] New window for ${ip}: 1/${RATE_LIMIT}`);
    return true;
  }

  if (record.value.count >= RATE_LIMIT) {
    console.warn(`[RATE_LIMIT] Exceeded for ${ip}: ${record.value.count}/${RATE_LIMIT}`);
    return false;
  }

  await kv.set(key, { count: record.value.count + 1, ts: record.value.ts });
  console.log(`[RATE_LIMIT] ${ip}: ${record.value.count + 1}/${RATE_LIMIT}`);
  return true;
}

// Normalize origin by removing trailing slash
function normalizeOrigin(origin: string) {
  return origin.replace(/\/$/, "");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const originHeader = req.headers.get("origin");
  let origin = originHeader ? normalizeOrigin(originHeader) : "cli";

  console.log(`[${req.method}] ${url.pathname} | IP: ${ip} | Origin: ${origin}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    console.log(`[OPTIONS] Allowing all origins for testing`);
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Rate limiting
  if (!(await rateLimit(ip))) {
    console.warn(`[429] Too many requests from ${ip}`);
    return new Response("Too many requests", { status: 429 });
  }

  // POST /backup
  if (req.method === "POST" && url.pathname.replace(/\/$/, "") === "/backup") {
    const isAllowed = origin === "cli" || ALLOWED_ORIGINS.includes(origin);
    console.log(`[POST /backup] Origin check: ${isAllowed} | Origin: "${origin}"`);
    
    if (!isAllowed) {
      console.warn(`[POST /backup] ❌ Denied from origin: ${origin}`);
      return new Response("Forbidden", { status: 403 });
    }

    const body = await req.text();
    console.log(`[POST /backup] Body length: ${body.length} bytes`);
    
    if (!body) {
      console.warn(`[POST /backup] ❌ Empty body`);
      return new Response("Empty body", { status: 400 });
    }

    await kv.set(["backup", BACKUP_KEY], body);
    console.log(`[POST /backup] ✓ Backup saved (${body.length} bytes)`);
    
    return new Response("Backup saved", {
      status: 200,
      headers: { "Access-Control-Allow-Origin": origin },
    });
  }

  // GET /recover
  if (req.method === "GET" && url.pathname.replace(/\/$/, "") === "/recover") {
    const isAllowed = origin === "cli" || ALLOWED_ORIGINS.includes(origin);
    console.log(`[GET /recover] Origin check: ${isAllowed} | Origin: "${origin}"`);
    
    if (!isAllowed) {
      console.warn(`[GET /recover] ❌ Denied from origin: ${origin}`);
      return new Response("Forbidden", { status: 403 });
    }

    const key = url.searchParams.get("key");
    console.log(`[GET /recover] Key provided: ${key ? "yes" : "no"}`);
    
    if (!key) {
      console.warn(`[GET /recover] ❌ Missing key parameter`);
      return new Response("Missing key", { status: 400 });
    }

    const result = await kv.get<string>(["backup", key]);
    
    if (!result.value) {
      console.warn(`[GET /recover] ❌ Not found for key: ${key}`);
      return new Response("Not found", { status: 404 });
    }

    console.log(`[GET /recover] ✓ Recovered ${result.value.length} bytes for key: ${key}`);
    
    return new Response(result.value, {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "Access-Control-Allow-Origin": origin,
        "Cache-Control": "no-store",
      },
    });
  }

  console.warn(`[404] Not found: ${req.method} ${url.pathname}`);
  return new Response("Not Found", { status: 404 });
});