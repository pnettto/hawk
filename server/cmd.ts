import { corsResponse } from "./utils/cors.ts";

export async function handleCmd(req: Request) {
    const url = new URL(req.url);
    const cmd = url.searchParams.get("cmd");

    if (!cmd) return corsResponse("Send ?cmd=<JS code>", { status: 500 });

    try {
        const kv = await Deno.openKv();

        const AsyncFunction =
            Object.getPrototypeOf(async function () {}).constructor;
        const func = new AsyncFunction("kv", cmd); // the cmd code can use 'kv'

        const result = await func(kv);

        return corsResponse(JSON.stringify(result), { status: 200 });
    } catch (e) {
        return corsResponse(
            e instanceof Error ? e.message : String(e),
            { status: 500 },
        );
    }
}
