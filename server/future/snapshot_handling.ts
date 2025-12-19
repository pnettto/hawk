import { Hono } from "https://deno.land/x/hono/mod.ts";
import type { Context } from "https://deno.land/x/hono/mod.ts";
import { openKv } from "https://deno.land/x/kv/mod.ts";

// Initialize Deno KV
const kv = await openKv();

type Snapshot = {
  content: string;
  updated: string;
  created?: string;
};

// Get the current head (latest version)
async function getHead(docId: string): Promise<{ version: number; timestamp: string } | null> {
  const res = await kv.get<{ version: number; timestamp: string }>(["doc", docId, "head"]);
  return res.value ?? null;
}

// Set the head pointer (latest version)
async function setHead(docId: string, version: number, timestamp: string) {
  await kv.set(["doc", docId, "head"], { version, timestamp });
}

// Set a document's content with version
async function setSnapshot(docId: string, version: number, content: Snapshot) {
  await kv.set(["doc", docId, "snapshot", version], content);
}

// Get the latest snapshot
async function loadLatestSnapshot(docId: string): Promise<Snapshot | null> {
  const head = await getHead(docId);
  if (head === null) return null;

  const snap = await kv.get<Snapshot>(["doc", docId, "snapshot", head.version]);
  return snap.value ?? null;
}

// Function to save a snapshot
async function createNextSnapshot(docId: string, snapshot: Snapshot) {
  const head = await getHead(docId);
  const nextVersion = head === null ? 1 : head.version + 1;

  const tx = kv.atomic()
    .set(["doc", docId, "snapshot", nextVersion], snapshot)
    .set(["doc", docId, "head"], { version: nextVersion, timestamp: snapshot.created });

  const res = await tx.commit();
  if (!res.ok) throw new Error("Snapshot commit failed");

  console.log(`📸 Snapshot saved as version: v${nextVersion}`);
}

// Function to check if a snapshot should be created
async function shouldCreateSnapshot(docId: string,): Promise<boolean> {
  const head = await getHead(docId);
  if (head === null) return true;

  const currentTime = new Date();
  const lastSnapshotTime = new Date(head.timestamp);

  // Calculate the difference in minutes
  const diffInMinutes = (currentTime.getTime() - lastSnapshotTime.getTime()) / 60000;

  // Create a new snapshot only if the time difference is greater than 30 minutes
  return diffInMinutes >= 30;
}

async function createFirstSnapshot(docId: string, content: string) {
  const now = new Date().toISOString();
  const currentVersion = 1;
  const currentState = { content, created: now, updated: now };
  
  await setSnapshot(docId, currentVersion, currentState);
  await setHead(docId, currentVersion, currentState.created);
}

async function updateCurrentSnapshot(docId: string, newState: Snapshot) {
  const currentState = await loadLatestSnapshot(docId);
  const head = await getHead(docId);
  if (!head) return;
 
  await setSnapshot(docId, head.version, {...currentState, ...newState});
}

async function createOrUpdateSnapshot(docId: string, newContent: string) {
  const currentState = await loadLatestSnapshot(docId);

  if (!currentState) {
    await createFirstSnapshot(docId, newContent);
    return;
  }

  // Abort if content is the same
  if (currentState.content === newContent) return;

  const now = new Date().toISOString()
  const newState: Snapshot = {
    content: newContent,
    updated: now
  }

  if (await shouldCreateSnapshot(docId)) {
    // Last snapshot is at least 30min old, create new
    await createNextSnapshot(docId, newState);
  } else {
    // Just update current snapshot's content
    await updateCurrentSnapshot(docId, newState);
  }
}

// Create Hono app
const app = new Hono();

// POST endpoint to update content
app.post("/api/snapshot", async (c: Context) => {
  try {
    // Read JSON body from the request
    const body = await c.req.json();
    const { docId, content } = body;

    if (!docId || !content) {
      return c.json({ message: "Missing docId or content" }, 400);
    }

    // Call the function to update content and save snapshot if needed
    await createOrUpdateSnapshot(docId, content);

    return c.json({ message: "Document updated successfully" }, 200);
  } catch (err) {
    console.error("Error:", err);
    return c.json({ message: "Failed to update document" }, 500);
  }
});

// GET endpoint to fetch the current state
app.get("/api/snapshot", async (c: Context) => {
  try {
    // Read JSON body from the request
    const body = await c.req.json();
    const { docId } = body;

    if (!docId) {
      return c.json({ message: "Missing docId" }, 400);
    }

    const currentState = await loadLatestSnapshot(docId);
    if (!currentState) {
      return c.json({ message: "Document not found" }, 404);
    }

    return c.json(currentState, 200);
  } catch (err) {
    console.error("Error:", err);
    return c.json({ message: "Failed to fetch document" }, 500);
  }
});

// Start server
app.listen({ port: 8000 });

console.log("Server running at http://localhost:8000");
