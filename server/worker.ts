import type { Env } from "./utils/env.ts";

export { HawkDO } from "./hawkDO.ts";

// Static assets (app/dist) are served by Cloudflare before this runs; only
// /api/* and /shared/* reach the Worker (run_worker_first in wrangler.jsonc).
// Those all go to the single Durable Object that holds the data.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/shared/")) {
      const stub = env.HAWK.get(env.HAWK.idFromName("hawk"));
      return await stub.fetch(request);
    }
    return await env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
