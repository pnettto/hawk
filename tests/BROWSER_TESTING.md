# 🌐 Browser Testing Guide

## Overview

Browser tests use **Puppeteer** to test web components in a real browser environment. This allows testing of:

- Component rendering
- Shadow DOM interactions
- User interactions (clicks, typing)
- Navigation and state changes

## Prerequisites

1. **Dev server must be running** on port 8000
2. Puppeteer will be downloaded automatically on first run

## Running Browser Tests

### Step 1: Start the dev server

In one terminal:

```bash
deno task dev
```

### Step 2: Run browser tests

In another terminal:

```bash
deno task test:browser
```

## What Gets Tested

The browser tests cover:

✅ **Component Rendering**

- DatePicker renders correctly
- MoodTracker renders correctly
- DailyLog renders hour rows
- All components mount in the DOM

✅ **User Interactions**

- Navigation tabs work
- Clicking changes application state
- Shadow DOM elements are accessible

✅ **Integration**

- Components work together
- State management across components
- Event handling

## Test Structure

```typescript
Deno.test({
  name: "Browser - My Component Test",
  async fn() {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.goto("http://localhost:8000");

      // Wait for component
      await page.evaluate((tag: string) => {
        return customElements.whenDefined(tag);
      }, "my-component");

      // Test component
      const result = await page.evaluate(() => {
        const component = document.querySelector("my-component");
        return component?.shadowRoot?.innerHTML;
      });

      assertExists(result);
    } finally {
      await browser.close();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
```

## Helper Functions

### Wait for Component

```typescript
await page.evaluate((tag: string) => {
  return customElements.whenDefined(tag);
}, "component-name");
```

### Get Shadow DOM Content

```typescript
const content = await page.evaluate((sel: string) => {
  const el = document.querySelector(sel);
  return el?.shadowRoot?.innerHTML || "";
}, "component-name");
```

### Click Inside Shadow DOM

```typescript
await page.evaluate(
  (compSel: string, btnSel: string) => {
    const component = document.querySelector(compSel);
    const button = component?.shadowRoot?.querySelector(btnSel);
    (button as HTMLElement)?.click();
  },
  "my-component",
  ".my-button"
);
```

### Type in Shadow DOM Input

```typescript
await page.evaluate(
  (compSel: string, inputSel: string, text: string) => {
    const component = document.querySelector(compSel);
    const input = component?.shadowRoot?.querySelector(inputSel);
    if (input instanceof HTMLInputElement) {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },
  "my-component",
  "input",
  "test value"
);
```

## Adding New Browser Tests

1. Edit `tests/browser.test.ts`
2. Add a new test:

```typescript
Deno.test({
  name: "Browser - Your test name",
  async fn() {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.goto("http://localhost:8000");

      // Your test code here
    } finally {
      await browser.close();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
```

3. Run: `deno task test:browser`

## Debugging Browser Tests

### Run with visible browser:

```typescript
const browser = await puppeteer.launch({
  headless: false, // Show browser
  args: ["--no-sandbox"],
});
```

### Take screenshots:

```typescript
await page.screenshot({ path: "test-screenshot.png" });
```

### Add delays to see what's happening:

```typescript
await page.waitForTimeout(2000); // Wait 2 seconds
```

### Log page content:

```typescript
const html = await page.content();
console.log(html);
```

## Common Issues

### "Dev server is not running"

- Make sure `deno task dev` is running in another terminal
- Check that the server is on port 8000

### "Component not found"

- Ensure the component is registered in `app/js/index.js`
- Check that the component name matches the custom element tag

### Tests timeout

- Increase timeout: `await page.waitForTimeout(5000)`
- Check browser console for errors

## Performance

- Browser tests are slower than unit tests (~2-5 seconds each)
- Run unit tests frequently, browser tests before commits
- Use `headless: true` for CI/CD pipelines

## CI/CD Integration

For GitHub Actions or similar:

```yaml
- name: Run browser tests
  run: |
    deno task dev &
    sleep 5  # Wait for server to start
    deno task test:browser
```
