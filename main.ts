import { serveDir } from "https://deno.land/std/http/file_server.ts";
import { handleBackup, handleRecover } from "./server/backup.ts";
import { kv } from "./server/utils/kv.ts";

// Load environment variables
const API_KEY = Deno.env.get("API_KEY") || '';
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Validate required environment variables
if (API_KEY === ''  || ALLOWED_ORIGINS.length === 0 ) {
  console.error("ERROR: Environment variables not set.");
  throw new Error("Missing required environment variables");
}

// Rate limiting settings
const RATE_LIMIT = 10; // max requests
const WINDOW_MS = 60_000; // 1 minute

console.log("Server starting with config:", {
  allowedOrigins: ALLOWED_ORIGINS,
  rateLimit: RATE_LIMIT,
});

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
    console.warn(
      `[RATE_LIMIT] Exceeded for ${ip}: ${record.value.count}/${RATE_LIMIT}`,
    );
    return false;
  }

  await kv.set(key, { count: record.value.count + 1, ts: record.value.ts });
  console.log(`[RATE_LIMIT] ${ip}: ${record.value.count + 1}/${RATE_LIMIT}`);
  return true;
}

function getClientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

function normalizeOrigin(origin: string) {
  return origin.replace(/\/$/, "");
}

function isAuth(req: Request): boolean {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return false;

    const token = authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7)
        : null;

    return token === API_KEY;
}

export async function handleRequest(req: Request) {
  const url = new URL(req.url);
  const ip = getClientIp(req);
  const originHeader = req.headers.get("origin");
  const origin = originHeader ? normalizeOrigin(originHeader) : "";

  console.log(
    `[${req.method}] ${url.pathname} | IP: ${ip} | Origin: ${origin}`,
  );

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const path = url.pathname.replace(/\/$/, "");

  if (req.method === "POST" && path === "/api/backup/create") {
    if (!(await rateLimit(ip))) {
      return new Response("Too many requests", { status: 429 });
    }
    if (!isAuth(req)) {
      return new Response("Forbidden", { status: 403 });
    }
    return handleBackup(req, origin);
  }

  if (req.method === "GET" && path === "/api/backup/recover") {
    if (!(await rateLimit(ip))) {
      return new Response("Too many requests", { status: 429 });
    }
    if (!isAuth(req)) {
      return new Response("Forbidden", { status: 403 });
    }
    return handleRecover(req, origin);
  }

  // Static files
  const res = await serveDir(req, {
    fsRoot: "app",
    urlRoot: "",
    showDirListing: false,
    enableCors: true,
  });

  if (res.status === 404) {
    return new Response("Not found", { status: 404 });
  }

  return res;
}

Deno.serve(handleRequest);
