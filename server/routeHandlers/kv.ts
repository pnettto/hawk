import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";

export async function listEntries(c: Context) {
  const entries = [];
  const iter = kv.list({ prefix: [] }, { consistency: "strong" });
  for await (const entry of iter) {
    entries.push(entry);
  }
  console.log(`[KV-GUI] Listed ${entries.length} total entries.`);
  return c.json(entries);
}

export async function setEntry(c: Context) {
  const { key, value } = await c.req.json();
  if (!Array.isArray(key)) return c.json({ error: "Key must be an array" }, 400);
  await kv.set(key, value);
  return c.json({ success: true });
}

export async function deleteEntry(c: Context) {
  const { key } = await c.req.json();
  if (!Array.isArray(key)) return c.json({ error: "Key must be an array" }, 400);
  await kv.delete(key);
  return c.json({ success: true });
}
