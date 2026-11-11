import { Context, Next } from "hono";
import { getClientIp } from "../utils/ipTools.ts";

// Fixed-window rate limits kept in memory. Every request goes through the one
// Durable Object, so a Map sees all traffic; it resets when the object is
// evicted, which only ever makes the limit more lenient for a moment.

interface RateLimitOpts {
  limit: number;
  windowMs: number;
  label: string;
}

const makeRateLimit = (opts: RateLimitOpts) => {
  const windows = new Map<string, { count: number; ts: number }>();
  return async (c: Context, next: Next) => {
    const ip = getClientIp(c.req.raw);
    const now = Date.now();
    const record = windows.get(ip);

    if (!record || now - record.ts > opts.windowMs) {
      // Drop stale windows so the map can't grow without bound.
      if (windows.size > 1000) {
        for (const [k, v] of windows) if (now - v.ts > opts.windowMs) windows.delete(k);
      }
      windows.set(ip, { count: 1, ts: now });
      return await next();
    }

    if (record.count >= opts.limit) {
      console.warn(`[${opts.label}] Exceeded for ${ip}: ${record.count}/${opts.limit}`);
      return c.text("Too many requests", 429);
    }

    record.count++;
    return await next();
  };
};

// General API budget. Generous because the SPA fans out a lot per page load
// (day fetch + neighbour prefetch + notes index + preferences + auth-check).
export const rateLimit = makeRateLimit({
  limit: 240,
  windowMs: 60_000,
  label: "RATE_LIMIT",
});

// Stricter, separate bucket for login attempts. Stops password brute-force
// without sharing the budget with normal browsing — so a chatty session can't
// lock you out of your own login.
export const loginRateLimit = makeRateLimit({
  limit: 8,
  windowMs: 15 * 60_000,
  label: "LOGIN_RATE_LIMIT",
});
