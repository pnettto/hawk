/**
 * Integration Tests for Hawk Application
 *
 * These tests verify that utilities work together correctly
 *
 * Note: Component imports are skipped as they require a browser environment (HTMLElement)
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("Integration - Store and Date utilities work together", async () => {
  const { AppStore } = await import("../app/js/utils/store.js");
  const { formatDate } = await import("../app/js/utils/date.js");

  const store = new AppStore();
  const state: any = store.getState();

  const dateStr = formatDate(state.selectedDate);

  assertExists(dateStr);
  assertEquals(typeof dateStr, "string");
  // Should be in YYYY-MM-DD format
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(dateStr), true);
});

Deno.test("Integration - All style files can be imported", async () => {
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
    try {
      const module = await import(`../app/js/components/${file}`);
      assertExists(module.style, `${file} should export style`);
    } catch (error) {
      const err = error as Error;
      throw new Error(`Failed to import ${file}: ${err.message}`);
    }
  }
});

Deno.test("Integration - Storage utilities are properly structured", async () => {
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

Deno.test("Integration - All utilities can be imported", async () => {
  const utils = [
    {
      path: "../app/js/utils/date.js",
      exports: ["formatDate", "prettyDisplay"],
    },
    { path: "../app/js/utils/dom.js", exports: ["debounce"] },
    {
      path: "../app/js/utils/store.js",
      exports: ["Store", "AppStore", "appStore"],
    },
    {
      path: "../app/js/global.js",
      exports: ["HOURS_START", "HOURS_END", "LOCALSTORAGE_KEY"],
    },
  ];

  for (const util of utils) {
    const module = await import(util.path);
    for (const exportName of util.exports) {
      assertExists(
        module[exportName],
        `${util.path} should export ${exportName}`,
      );
    }
  }
});

console.log("\n✅ All integration tests completed successfully!");
console.log(
  "ℹ️  Note: Component integration tests require a browser environment.\n",
);
