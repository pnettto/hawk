import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";

export async function setLogs(c: Context) {
  const body = await c.req.text();

  if (!body) return c.text("Empty body", 400);

  await kv.set(["backup", "hawk_backup"], body);
  console.log(`[POST /backup] ✓ Backup saved (${body.length} bytes)`);

  return c.text("Backup saved", 200);
}

export async function getLogs(c: Context) {
  const result = await kv.get<string>(["backup", "hawk_backup"]);
  if (!result.value) return c.json({}, 200);

  console.log(`[GET /restore] ✓ Recovered ${result.value.length} bytes for key: hawk_backup`);
  return c.text(result.value, 200);
}
