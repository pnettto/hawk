import { Context } from "hono";
import { setCookie } from "hono/cookie";

const API_KEY = Deno.env.get("API_KEY") || "";

async function hash(str: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function login(c: Context) {
  const { password } = await c.req.json().catch(() => ({}));
  if (!password) return c.json({ error: "Missing password" }, 400);

  const hashedInput = await hash(password);

  // Check against plain API_KEY or hashed API_KEY
  if (hashedInput === API_KEY || password === API_KEY) {
    const cookieValue = hashedInput === API_KEY ? hashedInput : password;
    setCookie(c, "hawk_token", cookieValue, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    return c.json({ success: true });
  }

  return c.json({ error: "Invalid password" }, 401);
}

export function logout(c: Context) {
  setCookie(c, "hawk_token", "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
  });
  return c.json({ success: true });
}

export function authCheck(c: Context) {
  // If they reached here, the middleware already verified them
  return c.json({ authenticated: true });
}
