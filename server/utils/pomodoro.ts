import { kv } from "./kvConn.ts";
import { emitSyncEvent } from "./syncEvents.ts";

// The Pomodoro state is shared across devices; the session (tab) that last
// changed it owns the notification for the current block. That owner lives in
// this record so a closing tab can hand the duty to another session.

export type PomodoroMode = "focus" | "break";

export interface PomodoroState {
  taskId: string | null;
  taskText: string;
  dateStr: string | null;
  mode: PomodoroMode;
  running: boolean;
  endsAt: number | null;
  remainingMs: number;
  focusMs: number;
  breakMs: number;
  completed: number;
}

export interface PomodoroRecord {
  state: PomodoroState;
  rev: number;
  updatedAt: number;
  // Tab that shows the end-of-block notification.
  ownerClientId: string | null;
  // Browser that tab belongs to, so a sibling tab can take over first.
  ownerBrowserId: string | null;
}

export interface PomodoroSession {
  clientId: string;
  browserId: string | null;
}

export const POMODORO_KEY = ["pomodoro"] as const;
const MIN_BLOCK_MS = 1_000;
const MAX_BLOCK_MS = 24 * 60 * 60_000;
const MAX_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_FOCUS_MS = 25 * 60_000;
const DEFAULT_BREAK_MS = 5 * 60_000;

const numberInRange = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

// Keep the stored blob predictable: clients own the timer logic, but the
// server shouldn't persist arbitrary values from an old or broken tab.
export function sanitizePomodoroState(value: unknown): PomodoroState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const mode = raw.mode;
  if (mode !== "focus" && mode !== "break") return null;

  const focusMs = numberInRange(raw.focusMs, DEFAULT_FOCUS_MS, MIN_BLOCK_MS, MAX_BLOCK_MS);
  const breakMs = numberInRange(raw.breakMs, DEFAULT_BREAK_MS, MIN_BLOCK_MS, MAX_BLOCK_MS);
  const running = raw.running === true &&
    typeof raw.endsAt === "number" && Number.isFinite(raw.endsAt);

  return {
    taskId: typeof raw.taskId === "string" && raw.taskId ? raw.taskId.slice(0, 200) : null,
    taskText: typeof raw.taskText === "string" ? raw.taskText.slice(0, 500) : "",
    dateStr: typeof raw.dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.dateStr)
      ? raw.dateStr
      : null,
    mode,
    running,
    endsAt: running ? numberInRange(raw.endsAt, Date.now(), 0, MAX_MS + Date.now()) : null,
    remainingMs: numberInRange(raw.remainingMs, focusMs, 0, MAX_MS),
    focusMs,
    breakMs,
    completed: numberInRange(raw.completed, 0, 0, 100_000),
  };
}

export function hasActivePomodoro(state: PomodoroState): boolean {
  return state.running || state.taskId !== null || state.mode === "break";
}

// Prefer a sibling tab in the same browser; otherwise the first remaining
// session takes over. The caller decides whether the connecting tab itself is
// a candidate.
export function pickPomodoroNotifier(
  sessions: readonly PomodoroSession[],
  browserId: string | null,
): PomodoroSession | null {
  const sameBrowser = browserId
    ? sessions.find((s) => s.browserId === browserId)
    : undefined;
  return sameBrowser ?? sessions[0] ?? null;
}

function sessionsOf(
  ctx: DurableObjectState,
  exclude?: WebSocket,
): PomodoroSession[] {
  const out: PomodoroSession[] = [];
  for (const ws of ctx.getWebSockets()) {
    if (ws === exclude) continue;
    let clientId: string | null = null;
    let browserId: string | null = null;
    for (const tag of ctx.getTags(ws)) {
      if (tag.startsWith("client:")) clientId = tag.slice("client:".length);
      else if (tag.startsWith("browser:")) browserId = tag.slice("browser:".length);
    }
    if (clientId) out.push({ clientId, browserId });
  }
  return out;
}

async function setPomodoroOwner(
  clientId: string | null,
  browserId: string | null,
  onlyIfOwner: string | null = null,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await kv.get<PomodoroRecord>(POMODORO_KEY);
    const record = cur.value;
    if (!record) return;
    if (onlyIfOwner !== null && record.ownerClientId !== onlyIfOwner) return;
    if (record.ownerClientId === clientId && record.ownerBrowserId === browserId) return;
    const next: PomodoroRecord = {
      ...record,
      ownerClientId: clientId,
      ownerBrowserId: browserId,
    };
    const res = await kv.atomic().check(cur).set(POMODORO_KEY, next).commit();
    if (res.ok) {
      await emitSyncEvent({ type: "pomodoro.saved", ref: "pomodoro" });
      return;
    }
  }
}

// A socket just opened. If the stored owner isn't connected any more (the
// object may have woken without a close event, or the state predates sync),
// give the duty to this session.
export async function ensurePomodoroDuty(
  ctx: DurableObjectState,
  clientId: string | null,
  browserId: string | null,
): Promise<void> {
  if (!clientId) return;
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await kv.get<PomodoroRecord>(POMODORO_KEY);
    const record = cur.value;
    if (!record || !hasActivePomodoro(record.state)) return;
    const sessions = sessionsOf(ctx);
    if (record.ownerClientId && sessions.some((s) => s.clientId === record.ownerClientId)) return;

    const session = sessions.find((s) => s.clientId === clientId) ??
      pickPomodoroNotifier(sessions, browserId ?? record.ownerBrowserId);
    const next: PomodoroRecord = {
      ...record,
      ownerClientId: session?.clientId ?? null,
      ownerBrowserId: session?.browserId ?? record.ownerBrowserId,
    };
    if (next.ownerClientId === record.ownerClientId && next.ownerBrowserId === record.ownerBrowserId) return;
    const res = await kv.atomic().check(cur).set(POMODORO_KEY, next).commit();
    if (res.ok) {
      await emitSyncEvent({ type: "pomodoro.saved", ref: "pomodoro" });
      return;
    }
  }
}

// The notifying tab is going away: hand the duty to another open session,
// preferring one in the same browser. With none left, keep the browser id so a
// reconnect from it is preferred when someone opens the app again.
export async function relayPomodoroDuty(
  ctx: DurableObjectState,
  departing: PomodoroSession,
  closing: WebSocket,
): Promise<void> {
  const sessions = sessionsOf(ctx, closing)
    .filter((s) => s.clientId !== departing.clientId);
  const next = pickPomodoroNotifier(sessions, departing.browserId);
  await setPomodoroOwner(
    next?.clientId ?? null,
    next?.browserId ?? departing.browserId,
    departing.clientId,
  );
}
