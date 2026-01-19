import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

const getApiKey = () => Deno.env.get("API_KEY") || "";

export const auth = async (c: Context, next: Next) => {
  const API_KEY = getApiKey();
  if (!API_KEY) {
    console.error("ERROR: API_KEY environment variable not set.");
    return c.json(
      { error: "Server configuration error (API_KEY missing)" },
      500,
    );
  }

  const authHeader = c.req.header("Authorization");
  const cookieToken = getCookie(c, "hawk_token");

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : cookieToken;

  if (token === API_KEY) {
    return await next();
  } else {
    return c.json({ error: "Unauthorized" }, 401);
  }
};
