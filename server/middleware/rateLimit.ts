import { Context, Next } from "hono";
import { getConnInfo } from "hono/deno";
import { kv } from "../utils/kvConn.ts";
import { getClientIp } from "../utils/ipTools.ts";

const RATE_LIMIT = 60; // Hits allowed per...
const WINDOW_MS = 60_000; // ...1 Minute

export const rateLimit = async (c: Context, next: Next) => {
  const info = getConnInfo(c);
  const ip = info.remote.address || getClientIp(c.req.raw);

  const key = ["rate_limit", ip];
  const now = Date.now();
  const record = await kv.get<{ count: number; ts: number }>(key);

  if (!record.value || now - record.value.ts > WINDOW_MS) {
    await kv.set(key, { count: 1, ts: now });
    console.log(`[RATE_LIMIT] New window for ${ip}: 1/${RATE_LIMIT}`);
    return await next();
  }

  if (record.value.count >= RATE_LIMIT) {
    console.warn(
      `[RATE_LIMIT] Exceeded for ${ip}: ${record.value.count}/${RATE_LIMIT}`,
    );
    return c.text("Too many requests", 429);
  }

  await kv.set(key, { count: record.value.count + 1, ts: record.value.ts });
  console.log(`[RATE_LIMIT] ${ip}: ${record.value.count + 1}/${RATE_LIMIT}`);

  return await next();
};
