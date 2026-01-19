#!/usr/bin/env -S deno run --allow-read --allow-net

/**
 * Test Runner for Hawk Application
 *
 * This script runs all tests and provides a summary
 */

console.log("🧪 Running Hawk Application Test Suite\n");
console.log("=".repeat(60));

// Run component tests
console.log("\n📦 Running Component Tests...\n");
const componentTests = new Deno.Command("deno", {
  args: [
    "test",
    "--no-check",
    "--allow-read",
    "--allow-net",
    "tests/components.test.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
});

const componentResult = await componentTests.output();

// Run integration tests
console.log("\n🔗 Running Integration Tests...\n");
const integrationTests = new Deno.Command("deno", {
  args: [
    "test",
    "--no-check",
    "--allow-read",
    "--allow-net",
    "tests/integration.test.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
});

const integrationResult = await integrationTests.output();

// Summary
console.log("\n" + "=".repeat(60));
console.log("\n📊 Test Summary:\n");

if (componentResult.success && integrationResult.success) {
  console.log("✅ All tests passed!");
  console.log("\nComponents tested:");
  console.log("  • Base Component");
  console.log("  • MainApp");
  console.log("  • NotesApp");
  console.log("  • DailyLog");
  console.log("  • Report");
  console.log("  • DatePicker");
  console.log("  • ZenMode");
  console.log("  • RichEditor");
  console.log("  • Notes");
  console.log("  • MoodTracker");
  console.log("  • Shortcuts");
  console.log("  • Mirror");
  console.log("  • Backup");
  console.log("  • Auth");
  console.log("\nUtilities tested:");
  console.log("  • Date utilities");
  console.log("  • DOM utilities");
  console.log("  • Store management");
  console.log("  • Storage utilities");
  console.log("  • Global constants");
  console.log("\n✨ Your application is working correctly!\n");
  Deno.exit(0);
} else {
  console.log("❌ Some tests failed. Please review the output above.\n");
  Deno.exit(1);
}
