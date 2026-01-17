import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";

// New per-day API
export async function getDayLog(c: Context) {
  const dateStr = c.req.query("date");
  if (!dateStr) return c.json({ error: "Missing date parameter" }, 400);

  const result = await kv.get<string>(["logs", dateStr]);
  if (!result.value) return c.json({}, 200);

  console.log(`[GET /api/day] ✓ Retrieved log for ${dateStr}`);
  return c.text(result.value, 200);
}

export async function setDayLog(c: Context) {
  const dateStr = c.req.query("date");
  if (!dateStr) return c.json({ error: "Missing date parameter" }, 400);

  const body = await c.req.text();
  if (!body) return c.text("Empty body", 400);

  await kv.set(["logs", dateStr], body);
  console.log(
    `[POST /api/day] ✓ Saved log for ${dateStr} (${body.length} bytes)`,
  );

  return c.text("Day log saved", 200);
}

export async function getAllLogs(c: Context) {
  const allLogs: Record<string, unknown> = {};
  const entries = kv.list({ prefix: ["logs"] });

  for await (const entry of entries) {
    const dateStr = entry.key[1] as string;
    try {
      allLogs[dateStr] = typeof entry.value === "string"
        ? JSON.parse(entry.value)
        : entry.value;
    } catch {
      allLogs[dateStr] = entry.value;
    }
  }

  console.log(
    `[GET /api/logs] ✓ Retrieved ${Object.keys(allLogs).length} days`,
  );
  return c.json(allLogs, 200);
}

// Legacy API for backwards compatibility (reads from old backup key)
export async function getLogs(c: Context) {
  // First try the new format
  const allLogs: Record<string, unknown> = {};
  const entries = kv.list({ prefix: ["logs"] });

  let hasNewFormat = false;
  for await (const entry of entries) {
    hasNewFormat = true;
    const dateStr = entry.key[1] as string;
    try {
      allLogs[dateStr] = typeof entry.value === "string"
        ? JSON.parse(entry.value)
        : entry.value;
    } catch {
      allLogs[dateStr] = entry.value;
    }
  }

  if (hasNewFormat) {
    console.log(
      `[GET /logs] ✓ Retrieved ${
        Object.keys(allLogs).length
      } days (new format)`,
    );
    return c.json(allLogs, 200);
  }

  // Fallback to old format
  const result = await kv.get<string>(["backup", "hawk_backup"]);
  if (!result.value) return c.json({}, 200);

  console.log(
    `[GET /logs] ✓ Retrieved legacy backup (${result.value?.length} bytes)`,
  );
  return c.text(result.value, 200);
}

export async function setLogs(c: Context) {
  const body = await c.req.text();
  if (!body) return c.text("Empty body", 400);

  // Parse body and save each day separately
  try {
    const logs = JSON.parse(body);
    for (const [dateStr, dayData] of Object.entries(logs)) {
      await kv.set(["logs", dateStr], JSON.stringify(dayData));
    }
    console.log(`[POST /logs] ✓ Saved ${Object.keys(logs).length} days`);
  } catch {
    // Fallback to old behavior
    await kv.set(["backup", "hawk_backup"], body);
    console.log(`[POST /logs] ✓ Legacy backup saved (${body.length} bytes)`);
  }

  return c.text("Logs saved", 200);
}

// Migration endpoint
export async function migrateLogs(c: Context) {
  const result = await kv.get<string>(["backup", "hawk_backup"]);
  if (!result.value) return c.text("No legacy data to migrate", 200);

  try {
    const logs = JSON.parse(result.value);
    let count = 0;
    for (const [dateStr, dayData] of Object.entries(logs)) {
      await kv.set(["logs", dateStr], JSON.stringify(dayData));
      count++;
    }
    console.log(`[MIGRATE] ✓ Migrated ${count} days from legacy backup`);
    return c.text(`Migrated ${count} days`, 200);
  } catch (e) {
    console.error("[MIGRATE] ✗ Failed:", e);
    return c.text("Migration failed", 500);
  }
}
