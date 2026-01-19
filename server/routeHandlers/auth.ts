import { Context } from "hono";
import { deleteCookie } from "hono/cookie";

export function logout(c: Context) {
  deleteCookie(c, "hawk_token");
  return c.json({ success: true });
}
