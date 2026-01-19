#!/usr/bin/env -S deno run --allow-read --allow-net --allow-run --allow-env

/**
 * Browser Test Runner
 *
 * Runs browser-based tests using Puppeteer
 * Requires the dev server to be running on port 8000
 */

console.log("🌐 Running Browser Tests\n");
console.log("=".repeat(60));

// Check if server is running
console.log("\n🔍 Checking if dev server is running...");

try {
  const response = await fetch("http://localhost:8000");
  if (response.ok) {
    console.log("✅ Dev server is running\n");
  } else {
    console.log("⚠️  Dev server responded but with status:", response.status);
  }
} catch (_error) {
  console.log("\n❌ Dev server is not running!");
  console.log("\nPlease start the dev server first:");
  console.log("  deno task dev\n");
  console.log("Then run browser tests in another terminal:");
  console.log("  deno task test:browser\n");
  Deno.exit(1);
}

console.log("🧪 Running browser tests...\n");

const browserTests = new Deno.Command("deno", {
  args: [
    "test",
    "--no-check",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-run",
    "--allow-env",
    "tests/browser.test.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
});

const result = await browserTests.output();

console.log("\n" + "=".repeat(60));

if (result.success) {
  console.log("\n✅ All browser tests passed!\n");
  Deno.exit(0);
} else {
  console.log("\n❌ Some browser tests failed.\n");
  Deno.exit(1);
}
