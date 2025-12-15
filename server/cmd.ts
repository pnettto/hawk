import { corsResponse } from "./utils/cors.ts";

export async function handleCmd(req: Request) {
  const url = new URL(req.url);
  const cmd = url.searchParams.get("cmd");
  if (!cmd) return corsResponse("Send ?cmd=<JS code>", { status: 400 });

  try {
    const kv = await Deno.openKv(); // ✅ must await

    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const func = new AsyncFunction("kv", cmd); // pass kv as param
    const result = await func(kv);

    return corsResponse(JSON.stringify(result), { status: 200 });
  } catch (e) {
    console.error("CMD ERROR:", e);
    return corsResponse(
      e instanceof Error ? e.message : String(e),
      { status: 500 }
    );
  }
}
