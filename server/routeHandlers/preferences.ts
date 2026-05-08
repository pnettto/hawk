import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";

// Single shared-install preferences blob. Shape is intentionally open so new
// keys (theme, density, font, …) can be added without a backend change.
type Preferences = Record<string, unknown>;

const KEY = ["preferences"] as const;

export async function getPreferences(c: Context) {
  const r = await kv.get<Preferences>(KEY);
  return c.json(r.value ?? {});
}

export async function patchPreferences(c: Context) {
  const partial = await c.req.json() as Preferences;
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }
  const cur = (await kv.get<Preferences>(KEY)).value ?? {};
  const next = { ...cur, ...partial };
  await kv.set(KEY, next);
  return c.json(next);
}
