import { bearerAuth } from "hono/bearer-auth";

const API_KEY = Deno.env.get("API_KEY") || "";

if (API_KEY === "") {
  console.error("ERROR: API_KEY environment variable not set.");
  throw new Error("Missing required environment variables");
}

export const auth = bearerAuth({ token: API_KEY });
