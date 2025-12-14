import { readTextWithLimit } from "./utils/payload.ts";
import { kv } from "./utils/kv.ts";
import { corsResponse } from "./utils/cors.ts";

const BACKUP_KEY = Deno.env.get("BACKUP_KEY");

if (!BACKUP_KEY) {
  console.error("ERROR: Environment variables not set.");
  throw new Error("Missing required environment variables");
}

export async function handleBackup(req: Request) {
  let body: string;
  
  try {
    body = await readTextWithLimit(req, 1024 * 1024); // 1024 KB
  } catch {
    return corsResponse("Payload too large", { status: 413 });
  }

  if (!body) return corsResponse("Empty body", { status: 400 });

  await kv.set(["backup", BACKUP_KEY], body);
  console.log(`[POST /backup] ✓ Backup saved (${body.length} bytes)`);

  return corsResponse("Backup saved", { status: 200 });
}

export async function handleRecover(_req: Request) {
  const result = await kv.get<string>(["backup", BACKUP_KEY]);
  if (!result.value) return corsResponse("Not found", { status: 404 });

  console.log(`[GET /recover] ✓ Recovered ${result.value.length} bytes for key: ${BACKUP_KEY}`);
  return corsResponse(result.value, { status: 200 });
}
