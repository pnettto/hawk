import { serveDir } from "https://deno.land/std/http/file_server.ts";
import { handleBackup, handleRecover } from "./server/backup.ts";
import { getClientIp } from "./server/utils/ip.ts";
import { rateLimit } from "./server/utils/rateLimit.ts";
import { isAuth } from "./server/utils/auth.ts";
import { corsResponse } from "./server/utils/cors.ts";

// Load environment variables
const API_KEY = Deno.env.get("API_KEY") || '';

// Validate required environment variables
if (API_KEY === '') {
  console.error("ERROR: Environment variables not set.");
  throw new Error("Missing required environment variables");
}

export async function handleRequest(req: Request) {
  const url = new URL(req.url);
  const ip = getClientIp(req);

  console.log(
    `[${req.method}] ${url.pathname} | IP: ${ip}`,
  );

  if (req.method === "OPTIONS") {
    return corsResponse(null);
  }

  const path = url.pathname.replace(/\/$/, "");

  if (req.method === "POST" && path === "/api/logs") {
    if (!(await rateLimit(ip))) {
      return corsResponse("Too many requests", { status: 429 });
    }
    if (!isAuth(req)) {
      return corsResponse("Forbidden", { status: 403 });
    }
    return handleBackup(req);
  }

  if (req.method === "GET" && path === "/api/logs") {
    if (!(await rateLimit(ip))) {
      return corsResponse("Too many requests", { status: 429 });
    }
    if (!isAuth(req)) {
      return corsResponse("Forbidden", { status: 403 });
    }
    return handleRecover(req);
  }

  // Static files
  const res = await serveDir(req, {
    fsRoot: "app",
    urlRoot: "",
    showDirListing: false,
    enableCors: true,
  });

  if (res.status === 404) {
    return corsResponse("Not found", { status: 404 });
  }

  return res;
}

Deno.serve(handleRequest);
