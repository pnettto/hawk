import { kv } from "./kvConn.ts";

// Sliding-window of recent snapshots per entity. Entries beyond MAX_VERSIONS
// (oldest by savedAt) are pruned on every write.
export const MAX_VERSIONS = 15;

// Within this window, a snapshot replaces the most recent entry instead of
// appending a new one — unless the change is "substantial" (see isSubstantial).
const COALESCE_WINDOW_MS = 60 * 1000;

export interface SnapshotMeta {
  savedAt: number;
  preview: string;
}

export type SnapshotKind = "note" | "day-notes" | "day-tasks";

interface KeyShape {
  entry: (id: string, savedAt: number) => Deno.KvKey;
  index: (id: string) => Deno.KvKey;
}

const KEYS: Record<SnapshotKind, KeyShape> = {
  "note": {
    entry: (id, ts) => ["notes", "version", id, ts],
    index: (id) => ["notes", "version_index", id],
  },
  "day-notes": {
    entry: (id, ts) => ["logs", "version_notes", id, ts],
    index: (id) => ["logs", "version_notes_index", id],
  },
  "day-tasks": {
    entry: (id, ts) => ["logs", "version_tasks", id, ts],
    index: (id) => ["logs", "version_tasks_index", id],
  },
};

export function keysFor(kind: SnapshotKind) {
  return KEYS[kind];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function makePreview(content: unknown): string {
  if (typeof content === "string") {
    return stripHtml(content).slice(0, 80);
  }
  if (content && typeof content === "object") {
    // Day-tasks: build a preview from the first non-empty hour entries.
    const entries = Object.entries(content as Record<string, unknown>);
    const parts: string[] = [];
    for (const [k, v] of entries) {
      if (parts.join(" • ").length > 80) break;
      if (v && typeof v === "object" && "text" in (v as object)) {
        const e = v as { checked?: boolean; text?: string };
        if (e.text) parts.push(`${k}: ${e.text}`);
      }
    }
    return parts.join(" • ").slice(0, 80);
  }
  return "";
}

// Cheap, length-based change detector — no diff library. Returns true when the
// new state differs enough from the previous to merit a new version entry
// (rather than replacing the most recent one).
export function isSubstantialTextChange(
  prev: string | undefined,
  next: string | undefined,
): boolean {
  const a = (prev ?? "").length;
  const b = (next ?? "").length;
  const delta = Math.abs(a - b);
  return delta > Math.max(200, a * 0.1);
}

// Day tasks: substantial if more than 3 hour keys differ, or if any hour was
// added or fully cleared.
export function isSubstantialTasksChange(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): boolean {
  const a = prev ?? {};
  const b = next ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let differing = 0;
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    const aMissing = av === undefined;
    const bMissing = bv === undefined;
    if (aMissing !== bMissing) return true; // add or clear
    if (JSON.stringify(av) !== JSON.stringify(bv)) differing++;
    if (differing > 3) return true;
  }
  return false;
}

interface MaybeSnapshotArgs<T> {
  kind: SnapshotKind;
  id: string;
  next: T;
  preview: string;
  // Caller decides whether the change is "substantial" — kinds differ in how
  // they compare (text length vs structural hour-entry diff).
  substantialChange: boolean;
}

// Decide whether to append or coalesce, then write the snapshot entry and the
// updated index, pruning to MAX_VERSIONS. Index is sorted desc by savedAt.
export async function maybeSnapshot<T>(args: MaybeSnapshotArgs<T>): Promise<void> {
  const { kind, id, next, preview, substantialChange } = args;
  const k = keysFor(kind);
  const indexRes = await kv.get<SnapshotMeta[]>(k.index(id));
  const index = (indexRes.value ?? []).slice();
  const now = Date.now();
  const latest = index[0];

  // Skip entirely if the latest snapshot already holds identical content.
  // Without this, every blur/visibility/paste/popover trigger past the
  // coalesce window appends a duplicate — most visibly as a wall of
  // "(empty)" entries on a note the user opened but didn't edit.
  if (latest) {
    const latestRes = await kv.get<{ content: T }>(k.entry(id, latest.savedAt));
    if (
      latestRes.value &&
      JSON.stringify(latestRes.value.content) === JSON.stringify(next)
    ) {
      return;
    }
  }

  const shouldCoalesce = latest &&
    !substantialChange &&
    now - latest.savedAt < COALESCE_WINDOW_MS;

  if (shouldCoalesce && latest) {
    // Coalesce in place — keep the original savedAt as the entry's identity
    // so any popover that already listed versions can still resolve this
    // entry by id when the user clicks. We just refresh the stored content
    // and the index's preview. No delete + reinsert with a new timestamp.
    await kv.set(k.entry(id, latest.savedAt), {
      savedAt: latest.savedAt,
      content: next,
    });
    index[0] = { savedAt: latest.savedAt, preview };
  } else {
    await kv.set(k.entry(id, now), { savedAt: now, content: next });
    index.unshift({ savedAt: now, preview });
  }

  // Prune: drop oldest beyond MAX_VERSIONS.
  while (index.length > MAX_VERSIONS) {
    const dropped = index.pop();
    if (dropped) await kv.delete(k.entry(id, dropped.savedAt));
  }

  await kv.set(k.index(id), index);
}

export async function listVersions(
  kind: SnapshotKind,
  id: string,
): Promise<SnapshotMeta[]> {
  const k = keysFor(kind);
  const res = await kv.get<SnapshotMeta[]>(k.index(id));
  return res.value ?? [];
}

export async function getVersion<T = unknown>(
  kind: SnapshotKind,
  id: string,
  savedAt: number,
): Promise<{ savedAt: number; content: T } | null> {
  const k = keysFor(kind);
  const res = await kv.get<{ savedAt: number; content: T }>(
    k.entry(id, savedAt),
  );
  return res.value ?? null;
}
