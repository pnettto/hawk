import { Context, Next } from "hono";
import { getConnInfo } from "hono/deno";
import { kv } from "../utils/kvConn.ts";
import { getClientIp } from "../utils/ipTools.ts";

interface RateLimitOpts {
  limit: number;
  windowMs: number;
  prefix: string;
  label: string;
}

const makeRateLimit = (opts: RateLimitOpts) =>
async (c: Context, next: Next) => {
  const info = getConnInfo(c);
  const ip = info.remote.address || getClientIp(c.req.raw);

  const key = [opts.prefix, ip];
  const now = Date.now();
  const record = await kv.get<{ count: number; ts: number }>(key);

  if (!record.value || now - record.value.ts > opts.windowMs) {
    await kv.set(key, { count: 1, ts: now });
    console.log(`[${opts.label}] New window for ${ip}: 1/${opts.limit}`);
    return await next();
  }

  if (record.value.count >= opts.limit) {
    console.warn(
      `[${opts.label}] Exceeded for ${ip}: ${record.value.count}/${opts.limit}`,
    );
    return c.text("Too many requests", 429);
  }

  await kv.set(key, { count: record.value.count + 1, ts: record.value.ts });
  console.log(
    `[${opts.label}] ${ip}: ${record.value.count + 1}/${opts.limit}`,
  );

  return await next();
};

// General API budget. Generous because the SPA fans out a lot per page load
// (day fetch + neighbour prefetch + notes index + preferences + auth-check).
export const rateLimit = makeRateLimit({
  limit: 240,
  windowMs: 60_000,
  prefix: "rate_limit",
  label: "RATE_LIMIT",
});

// Stricter, separate bucket for login attempts. Stops password brute-force
// without sharing the budget with normal browsing — so a chatty session can't
// lock you out of your own login.
export const loginRateLimit = makeRateLimit({
  limit: 8,
  windowMs: 15 * 60_000,
  prefix: "login_rate_limit",
  label: "LOGIN_RATE_LIMIT",
});
