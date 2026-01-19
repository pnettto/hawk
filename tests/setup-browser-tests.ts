#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run

/**
 * Setup script for browser testing
 *
 * This script helps you set up Chrome for Puppeteer browser tests
 */

console.log("🔧 Browser Testing Setup\n");
console.log("=".repeat(60));

console.log("\n📋 Browser testing requires Chrome/Chromium to be installed.\n");
console.log("You have two options:\n");

console.log("Option 1: Use your system Chrome (Recommended)");
console.log("  ✅ No download needed");
console.log("  ✅ Uses your existing Chrome installation");
console.log("  ℹ️  Tests will use: /Applications/Google Chrome.app\n");

console.log("Option 2: Download Chromium for Puppeteer");
console.log("  ⚠️  Large download (~170MB)");
console.log("  ⚠️  May not work with Deno 2.0");
console.log("  ℹ️  Not recommended\n");

console.log("=".repeat(60));

// Check if Chrome is installed
const chromeExists = await Deno.stat(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)
  .then(() => true)
  .catch(() => false);

if (chromeExists) {
  console.log("\n✅ Google Chrome found!");
  console.log("   Location: /Applications/Google Chrome.app");
  console.log("\n✨ You're ready to run browser tests!");
  console.log("\n   Run: deno task test:browser\n");
} else {
  console.log("\n❌ Google Chrome not found at default location");
  console.log("\n📥 Please install Google Chrome:");
  console.log("   https://www.google.com/chrome/\n");
  console.log("Or update the CHROME_PATH in tests/browser.test.ts");
  console.log("to point to your Chrome/Chromium installation.\n");
}

console.log("=".repeat(60));
console.log("\n💡 Tip: Browser tests require the dev server to be running:");
console.log("   Terminal 1: deno task dev");
console.log("   Terminal 2: deno task test:browser\n");
