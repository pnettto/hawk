import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";

// ... existing functions
export async function getDayLog(c: Context) {
  const dateStr = c.req.query("date");
  if (!dateStr) return c.json({ error: "Missing date parameter" }, 400);

  const result = await kv.get<string>(["logs", dateStr]);
  if (!result.value) return c.json({}, 200);

  console.log(`[GET /api/day] ✓ Retrieved log for ${dateStr}`);
  return c.text(result.value, 200);
}

export async function getRangeLog(c: Context) {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end) {
    return c.json({ error: "Missing start or end date" }, 400);
  }

  const logs: Record<string, unknown> = {};
  // Use start and end to fetch the range from KV
  const entries = kv.list({
    start: ["logs", start],
    end: ["logs", end + "\uffff"],
  });

  for await (const entry of entries) {
    const dateStr = entry.key[1] as string;
    try {
      logs[dateStr] = typeof entry.value === "string"
        ? JSON.parse(entry.value)
        : entry.value;
    } catch {
      logs[dateStr] = entry.value;
    }
  }

  console.log(`[GET /api/range] ✓ Retrieved ${Object.keys(logs).length} days`);
  return c.json(logs, 200);
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
