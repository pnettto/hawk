// Run locally with:
// deno run \
//   --env-file=.env \
//   --allow-net \
//   --allow-env \
//   --allow-read \
//   --unstable-kv \
//   --watch \
//   backup.ts

import { readTextWithLimit } from "./utils/payload.ts";
import { kv } from "./utils/kv.ts";

// Load environment variables
const BACKUP_KEY = Deno.env.get("BACKUP_KEY");

// Validate required environment variables
if (!BACKUP_KEY) {
  console.error("ERROR: Environment variables not set.");
  throw new Error("Missing required environment variables");
}

export async function handleBackup(req: Request) {
  let body: string;
  
  try {
    body = await readTextWithLimit(req, 1024 * 1024); // 1024 KB
  } catch {
    return new Response("Payload too large", { status: 413 });
  }

  if (!body) return new Response("Empty body", { status: 400 });

  await kv.set(["backup", BACKUP_KEY], body);
  console.log(`[POST /backup] ✓ Backup saved (${body.length} bytes)`);

  return new Response("Backup saved", {
    status: 200,
    headers: { "Access-Control-Allow-Origin": '*' },
  });
}

export async function handleRecover(_req: Request) {
  const result = await kv.get<string>(["backup", BACKUP_KEY]);
  if (!result.value) return new Response("Not found", { status: 404 });

  console.log(`[GET /recover] ✓ Recovered ${result.value.length} bytes for key: ${BACKUP_KEY}`);
  return new Response(result.value, {
    status: 200,
    headers: {
      "content-type": "text/plain",
      "Access-Control-Allow-Origin":  '*',
      "Cache-Control": "no-store",
    },
  });
}
