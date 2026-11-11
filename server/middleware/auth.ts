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

  if (await isValidToken(tokenFromRequest(c))) {
    return await next();
  } else {
    return c.json({ error: "Unauthorized" }, 401);
  }
};
