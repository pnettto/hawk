import { kv } from "./kv.ts";

const RATE_LIMIT = 10; // max requests
const WINDOW_MS = 60_000; // 1 minute

export async function rateLimit(ip: string) {
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