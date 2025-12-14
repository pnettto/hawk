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

// Load environment variables
const BACKUP_KEY = Deno.env.get("BACKUP_KEY");
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Validate required environment variables
if (!BACKUP_KEY || ALLOWED_ORIGINS.length === 0) {
  console.error("ERROR: Environment variables not set.");
  throw new Error("Missing required environment variables");
}

console.log("Server starting with config:", {
  allowedOrigins: ALLOWED_ORIGINS,
  rateLimit: 10,
  windowMs: 60_000,
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

function normalizeOrigin(origin: string) {
  return origin.replace(/\/$/, "");
}

function isOriginAllowed(origin: string) {
  return origin === "cli" || ALLOWED_ORIGINS.includes(origin);
}

async function handleBackup(req: Request, origin: string) {
  const body = await req.text();
  if (!body) return new Response("Empty body", { status: 400 });

  await kv.set(["backup", BACKUP_KEY], body);
  console.log(`[POST /backup] ✓ Backup saved (${body.length} bytes)`);

  return new Response("Backup saved", {
    status: 200,
    headers: { "Access-Control-Allow-Origin": origin },
  });
}

async function handleRecover(req: Request, origin: string) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) return new Response("Missing key", { status: 400 });

  const result = await kv.get<string>(["backup", key]);
  if (!result.value) return new Response("Not found", { status: 404 });

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

async function handleRequest(req: Request) {
  const url = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const originHeader = req.headers.get("origin");
  const origin = originHeader ? normalizeOrigin(originHeader) : "cli";

  console.log(`[${req.method}] ${url.pathname} | IP: ${ip} | Origin: ${origin}`);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (!(await rateLimit(ip))) return new Response("Too many requests", { status: 429 });

  const path = url.pathname.replace(/\/$/, "");

  if (req.method === "POST" && path === "/backup") {
    if (!isOriginAllowed(origin)) return new Response("Forbidden", { status: 403 });
    return handleBackup(req, origin);
  }

  if (req.method === "GET" && path === "/recover") {
    if (!isOriginAllowed(origin)) return new Response("Forbidden", { status: 403 });
    return handleRecover(req, origin);
  }

  return new Response("Not Found", { status: 404 });
}

Deno.serve(handleRequest);
