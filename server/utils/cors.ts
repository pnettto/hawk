export function corsResponse(body: string = "", init: ResponseInit = {}) {
  const headers = new Headers(init?.headers);
  headers.set("Access-Control-Allow-Origin", "*"); // allow any origin
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  return new Response(body, { ...init, headers });
}