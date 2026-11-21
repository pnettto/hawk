import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { env } from "../utils/env.ts";

// API_KEY is the login password, either plain or as its SHA-256 hex. The
// session token handed to clients is derived from it, so a stolen token never
// reveals the password. Changing API_KEY invalidates every session.
const getApiKey = () => env().API_KEY || "";

export async function sha256Hex(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Compares in time independent of where the strings differ. Hashing both
// sides first gives equal lengths without leaking the expected length.
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export function sessionToken(): Promise<string> {
  return sha256Hex(`hawk-session:${getApiKey()}`);
}

// A token that can only call the read API (docs/api.md). Derived like the
// session token, so changing API_KEY revokes it too.
export function readToken(): Promise<string> {
  return sha256Hex(`hawk-read:${getApiKey()}`);
}

// What a read-only token may call: GET/HEAD on the read API and search.
const READ_ONLY_PATH = /^\/api\/(?:notes(?:\/[^/]+)?|tasks|reports\/[^/]+|search)$/;

export function readOnlyAllows(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD") && READ_ONLY_PATH.test(path);
}

export async function isValidReadToken(token: string | undefined | null): Promise<boolean> {
  if (!getApiKey() || !token) return false;
  return safeEqual(token, await readToken());
}

export async function isValidPassword(password: string): Promise<boolean> {
  const API_KEY = getApiKey();
  if (!API_KEY || !password) return false;
  const [plain, hashed] = await Promise.all([
    safeEqual(password, API_KEY),
    safeEqual(await sha256Hex(password), API_KEY),
  ]);
  return plain || hashed;
}

export async function isValidToken(token: string | undefined | null): Promise<boolean> {
  if (!getApiKey() || !token) return false;
  return safeEqual(token, await sessionToken());
}

export function tokenFromRequest(c: Context): string | undefined {
  const authHeader = c.req.header("Authorization");
  return authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : getCookie(c, "hawk_token");
}

export const auth = async (c: Context, next: Next) => {
  if (!getApiKey()) {
    console.error("ERROR: API_KEY environment variable not set.");
    return c.json(
      { error: "Server configuration error (API_KEY missing)" },
      500,
    );
  }

  const token = tokenFromRequest(c);
  if (await isValidToken(token)) return await next();
  if (await isValidReadToken(token)) {
    if (readOnlyAllows(c.req.method, c.req.path)) return await next();
    return c.json({ error: "Read-only token" }, 403);
  }
  return c.json({ error: "Unauthorized" }, 401);
};
