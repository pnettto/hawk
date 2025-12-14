// Minimal test server
// Run with: deno run --allow-net test-server.ts

console.log("=== TEST SERVER STARTING ===");

Deno.serve({ port: 8000 }, async (req) => {
  const url = new URL(req.url);
  const method = req.method;
  const origin = req.headers.get("origin") || "no-origin";
  
  console.log(`\n[${method}] ${url.pathname}`);
  console.log(`Origin: ${origin}`);
  console.log(`Headers:`, Object.fromEntries(req.headers.entries()));
  
  // Handle preflight
  if (method === "OPTIONS") {
    console.log("→ Responding to OPTIONS with allow all");
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  
  // POST /backup
  if (method === "POST" && url.pathname === "/backup") {
    const body = await req.text();
    console.log(`Body length: ${body.length}`);
    console.log(`Body: ${body.substring(0, 200)}`);
    
    return new Response("Backup saved - TEST MODE", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain",
      },
    });
  }
  
  console.log("→ 404");
  return new Response("Not Found", { status: 404 });
});

console.log("Server listening on http://localhost:8000");