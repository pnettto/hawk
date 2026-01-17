/**
 * Migration script: Run this to migrate backup.json data to the new per-day KV format
 * Usage: deno run --allow-read --allow-net --allow-env migrate.ts
 */

const backupFile = Deno.readTextFileSync("./backup.json");
const logs = JSON.parse(backupFile);

const API_KEY = Deno.env.get("API_KEY");
const API_URL = Deno.env.get("API_URL") || "http://localhost:8000";

if (!API_KEY) {
  console.error("Missing API_KEY environment variable");
  Deno.exit(1);
}

console.log(`Migrating ${Object.keys(logs).length} days to ${API_URL}...`);

let success = 0;
let failed = 0;

for (const [dateStr, dayData] of Object.entries(logs)) {
  try {
    const res = await fetch(
      `${API_URL}/api/day?date=${encodeURIComponent(dateStr)}`,
      {
        method: "POST",
        body: JSON.stringify(dayData),
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (res.ok) {
      console.log(`✓ ${dateStr}`);
      success++;
    } else {
      console.error(`✗ ${dateStr}: ${res.status} ${res.statusText}`);
      failed++;
    }
  } catch (e: unknown) {
    const error = e as Error;
    console.error(`✗ ${dateStr}: ${error.message}`);
    failed++;
  }
}

console.log(`\nMigration complete: ${success} succeeded, ${failed} failed`);
