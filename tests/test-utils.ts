/**
 * Test Suite for Hawk Application Components
 *
 * This file provides utilities for testing web components in a browser environment.
 * Tests run using Deno's built-in test runner with browser automation.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

/**
 * Creates a test HTML page with all necessary dependencies
 */
export function createTestPage(componentHTML: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Component Test</title>
    <link rel="stylesheet" href="https://use.typekit.net/pmu6sig.css">
    <link rel="stylesheet" href="/styles.css" />
</head>
<body>
    ${componentHTML}
    <script src="/js/libs/prism.min.js"></script>
    <script src="/js/libs/marked.min.js"></script>
    <script src="/js/libs/tiptap-bundle.min.js"></script>
    <script type="module" src="/js/index.js"></script>
</body>
</html>
  `;
}

/**
 * Wait for a custom element to be defined
 */
export async function waitForComponent(
  page: any,
  tagName: string,
  timeout = 5000,
): Promise<void> {
  await page.evaluate(
    (tag: string, ms: number) => {
      return new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (customElements.get(tag)) {
            resolve();
          } else if (Date.now() - start > ms) {
            reject(new Error(`Component ${tag} not defined after ${ms}ms`));
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    },
    tagName,
    timeout,
  );
}

/**
 * Get shadow root content from a component
 */
export async function getShadowContent(
  page: any,
  selector: string,
): Promise<string> {
  return await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return el?.shadowRoot?.innerHTML || "";
  }, selector);
}

/**
 * Click element inside shadow DOM
 */
export async function clickInShadow(
  page: any,
  componentSelector: string,
  innerSelector: string,
): Promise<void> {
  await page.evaluate(
    (compSel: string, innerSel: string) => {
      const component = document.querySelector(compSel);
      const element = component?.shadowRoot?.querySelector(innerSel);
      if (element instanceof HTMLElement) {
        element.click();
      }
    },
    componentSelector,
    innerSelector,
  );
}

/**
 * Type text into input inside shadow DOM
 */
export async function typeInShadow(
  page: any,
  componentSelector: string,
  inputSelector: string,
  text: string,
): Promise<void> {
  await page.evaluate(
    (compSel: string, inpSel: string, txt: string) => {
      const component = document.querySelector(compSel);
      const input = component?.shadowRoot?.querySelector(inpSel);
      if (input instanceof HTMLInputElement) {
        input.value = txt;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    componentSelector,
    inputSelector,
    text,
  );
}

export { assertEquals, assertExists };
