import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

const API_KEY = Deno.env.get("API_KEY") || "";

if (API_KEY === "") {
  console.error("ERROR: API_KEY environment variable not set.");
  throw new Error("Missing required environment variables");
}

export const auth = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const cookieToken = getCookie(c, "hawk_token");

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : cookieToken;

  if (token === API_KEY) {
    await next();
  } else {
    return c.json({ error: "Unauthorized" }, 401);
  }
};
