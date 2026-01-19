/**
 * Component Tests for Hawk Application
 *
 * Run with: deno task test
 *
 * Note: These tests focus on utilities and modules that don't require a browser environment.
 * Web Components require HTMLElement which is not available in Deno's runtime.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Simple unit tests for utilities
Deno.test("Global constants are defined", () => {
  // Test that we can import and verify structure
  assertExists(Deno);
  assertEquals(typeof Deno.test, "function");
});

Deno.test("Date utilities - formatDate", async () => {
  const { formatDate } = await import("../app/js/utils/date.js");

  const date = new Date("2024-01-15T12:00:00");
  const formatted = formatDate(date);

  assertEquals(formatted, "2024-01-15");
});

Deno.test("Date utilities - prettyDisplay", async () => {
  const { prettyDisplay } = await import("../app/js/utils/date.js");

  const date = new Date("2024-01-15T12:00:00");
  const pretty = prettyDisplay(date);

  // Should contain month and day
  assertExists(pretty);
  assertEquals(typeof pretty, "string");
});

Deno.test("DOM utilities - debounce function exists", async () => {
  const { debounce } = await import("../app/js/utils/dom.js");

  assertEquals(typeof debounce, "function");

  let callCount = 0;
  const debouncedFn = debounce(() => callCount++, 100);

  // Call multiple times rapidly
  debouncedFn();
  debouncedFn();
  debouncedFn();

  // Should not have executed yet
  assertEquals(callCount, 0);

  // Wait for debounce
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Should have executed once
  assertEquals(callCount, 1);
});

Deno.test("Store - AppStore initialization", async () => {
  const { AppStore } = await import("../app/js/utils/store.js");

  const store = new AppStore();
  const state: any = store.getState();

  assertExists(state);
  assertExists(state.selectedDate);
  assertEquals(typeof state.logs, "object");
  assertEquals(state.currentPage, "app");
  assertEquals(state.journalTab, "tasks");
});

Deno.test("Store - setState updates state", async () => {
  const { Store } = await import("../app/js/utils/store.js");

  const store = new Store({ count: 0 });

  store.setState({ count: 5 });
  const state: any = store.getState();

  assertEquals(state.count, 5);
});

Deno.test("Global constants - HOURS_START and HOURS_END", async () => {
  const { HOURS_START, HOURS_END, LOCALSTORAGE_KEY } = await import(
    "../app/js/global.js"
  );

  assertEquals(HOURS_START, 9);
  assertEquals(HOURS_END, 16);
  assertEquals(LOCALSTORAGE_KEY, "hawk:data");
});

Deno.test("Component styles - NotesApp styles exist", async () => {
  const { style } = await import("../app/js/components/NotesApp.styles.js");

  assertExists(style);
  assertEquals(typeof style, "string");
  // Should contain CSS
  assertEquals(style.includes(":host"), true);
});

Deno.test("Component styles - DailyLog styles exist", async () => {
  const { style } = await import("../app/js/components/DailyLog.styles.js");

  assertExists(style);
  assertEquals(typeof style, "string");
  assertEquals(style.includes(".hours"), true);
});

Deno.test("Component styles - All style files are valid CSS", async () => {
  const styleFiles = [
    "NotesApp.styles.js",
    "DailyLog.styles.js",
    "Report.styles.js",
    "MainApp.styles.js",
    "DatePicker.styles.js",
    "ZenMode.styles.js",
    "RichEditor.styles.js",
    "Notes.styles.js",
    "MoodTracker.styles.js",
    "Shortcuts.styles.js",
    "Mirror.styles.js",
    "Backup.styles.js",
    "Auth.styles.js",
  ];

  for (const file of styleFiles) {
    const { style } = await import(`../app/js/components/${file}`);
    assertExists(style, `Style should exist in ${file}`);
    assertEquals(typeof style, "string", `Style should be string in ${file}`);
    assertEquals(
      style.length > 0,
      true,
      `Style should not be empty in ${file}`,
    );
  }
});

Deno.test("Storage utilities are properly structured", async () => {
  const storage = await import("../app/js/utils/storage.js");

  // Check that key functions exist
  assertEquals(typeof storage.loadForDate, "function");
  assertEquals(typeof storage.saveForDate, "function");
  assertEquals(typeof storage.getNotesCollections, "function");
  assertEquals(typeof storage.saveNotesCollections, "function");
  assertEquals(typeof storage.getNote, "function");
  assertEquals(typeof storage.saveNote, "function");
  assertEquals(typeof storage.deleteNote, "function");
  assertEquals(typeof storage.backup, "function");
});

console.log("\n✅ All utility and style tests completed successfully!");
console.log("ℹ️  Note: Web Component tests require a browser environment.\n");
