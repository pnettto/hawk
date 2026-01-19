/**
 * Browser Tests for Hawk Web Components
 *
 * These tests verify the application works in a real browser.
 *
 * Setup: Run `deno run -A tests/setup-browser-tests.ts` first
 * Run with: deno task test:browser (requires dev server running)
 */

import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const SERVER_URL = "http://localhost:8000";
const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Helper to launch browser
 */
async function launchBrowser() {
  try {
    return await puppeteer.launch({
      headless: true,
      executablePath: CHROME_PATH,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (error) {
    console.error("⚠️  Could not launch system Chrome:", error.message);
    console.error("💡 Run: deno run -A tests/setup-browser-tests.ts");
    throw error;
  }
}

/**
 * Helper to bypass auth and wait for app to load
 */
async function setupPage(page: any) {
  await page.goto(SERVER_URL);
  await page.waitForTimeout(1000);

  // Click guest link
  await page.evaluate(() => {
    const authOverlay = document.querySelector("auth-overlay");
    const guestLink = authOverlay?.shadowRoot?.querySelector(
      ".guest",
    ) as HTMLElement;
    if (guestLink) {
      guestLink.click();
    }
  });

  // Wait for app to load
  await page.waitForTimeout(2000);
}

Deno.test({
  name: "Browser - Application loads successfully",
  async fn() {
    const browser = await launchBrowser();

    try {
      const page = await browser.newPage();
      await page.goto(SERVER_URL);

      // Check page loaded
      const title = await page.title();
      assertExists(title, "Page should have a title");

      // Check main-app exists
      const hasMainApp = await page.evaluate(() => {
        return document.querySelector("main-app") !== null;
      });

      assertEquals(hasMainApp, true, "Main app component should exist");
    } finally {
      await browser.close();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Browser - Main app renders content",
  async fn() {
    const browser = await launchBrowser();

    try {
      const page = await browser.newPage();
      await setupPage(page);

      // Check if main-app has shadow DOM content
      const hasShadowContent = await page.evaluate(() => {
        const mainApp = document.querySelector("main-app");
        const shadowHTML = mainApp?.shadowRoot?.innerHTML || "";
        return shadowHTML.length > 100; // Should have substantial content
      });

      assertEquals(
        hasShadowContent,
        true,
        "Main app should have shadow DOM content",
      );
    } finally {
      await browser.close();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Browser - Navigation elements exist",
  async fn() {
    const browser = await launchBrowser();

    try {
      const page = await browser.newPage();
      await setupPage(page);

      // Check for navigation buttons
      const hasNavButtons = await page.evaluate(() => {
        const mainApp = document.querySelector("main-app");
        const navApp = mainApp?.shadowRoot?.querySelector("#nav-app");
        const navReport = mainApp?.shadowRoot?.querySelector("#nav-report");
        const navNotes = mainApp?.shadowRoot?.querySelector("#nav-notes");
        return navApp !== null && navReport !== null && navNotes !== null;
      });

      assertEquals(hasNavButtons, true, "Navigation buttons should exist");
    } finally {
      await browser.close();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

console.log("\n✅ All browser tests completed!");
console.log(
  "ℹ️  These tests verify the application works in a real browser.\n",
);
