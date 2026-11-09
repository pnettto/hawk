import { Context } from "hono";
import { setCookie } from "hono/cookie";
import {
  isValidPassword,
  isValidToken,
  sessionToken,
  tokenFromRequest,
} from "../middleware/auth.ts";

export async function login(c: Context) {
  const { password } = await c.req.json().catch(() => ({}));
  if (!password) return c.json({ error: "Missing password" }, 400);

  if (await isValidPassword(password)) {
    const tokenValue = await sessionToken();
    // Set cookie for browser-based access if needed, but return token for extensions
    setCookie(c, "hawk_token", tokenValue, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    return c.json({ success: true, token: tokenValue });
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

export async function authCheck(c: Context) {
  return c.json({ authenticated: await isValidToken(tokenFromRequest(c)) });
}
