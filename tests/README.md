# Hawk Application Test Suite

This directory contains the test suite for the Hawk application.

## Test Structure

- **`components.test.ts`** - Unit tests for individual components, utilities, and styles
- **`integration.test.ts`** - Integration tests verifying components work together
- **`test-utils.ts`** - Shared utilities for testing (browser automation helpers)
- **`run-tests.ts`** - Main test runner script

## Running Tests

### Run all tests:

```bash
deno task test
```

### Run specific test file:

```bash
deno test --allow-read --allow-net tests/components.test.ts
deno test --allow-read --allow-net tests/integration.test.ts
```

### Run with verbose output:

```bash
deno test --allow-read --allow-net --reporter=dot tests/
```

## What's Tested

### Components

- ✅ Base Component
- ✅ MainApp
- ✅ NotesApp
- ✅ DailyLog
- ✅ Report
- ✅ DatePicker
- ✅ ZenMode
- ✅ RichEditor
- ✅ Notes
- ✅ MoodTracker
- ✅ Shortcuts
- ✅ Mirror
- ✅ Backup
- ✅ Auth

### Utilities

- ✅ Date formatting (`formatDate`, `prettyDisplay`)
- ✅ DOM utilities (`debounce`)
- ✅ Store management (`Store`, `AppStore`)
- ✅ Storage utilities (API interactions)
- ✅ Global constants

### Styles

- ✅ All component style files exist
- ✅ Styles are valid CSS strings
- ✅ Styles match their components

## Test Coverage

The test suite covers:

1. **Unit Tests** - Individual functions and utilities
2. **Integration Tests** - Components working together
3. **Import Tests** - All modules can be loaded
4. **Style Tests** - All styles are properly structured

## Adding New Tests

To add tests for a new component:

1. Add unit tests in `components.test.ts`:

```typescript
Deno.test("MyComponent - basic functionality", async () => {
  const { MyComponent } = await import("../app/js/components/MyComponent.js");
  // Your test here
});
```

2. Add integration tests in `integration.test.ts` if needed

3. Run tests to verify:

```bash
deno task test
```
