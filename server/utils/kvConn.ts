const KV_URL = Deno.env.get("KV_URL");
export const kv = KV_URL ? await Deno.openKv(KV_URL) : await Deno.openKv();