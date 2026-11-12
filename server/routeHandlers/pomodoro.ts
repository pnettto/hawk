import { Context } from "hono";
import { kv } from "../utils/kvConn.ts";
import { emitSyncEvent, getBrowserIdFromCtx, getClientIdFromCtx } from "../utils/syncEvents.ts";
import {
  POMODORO_KEY,
  type PomodoroRecord,
  sanitizePomodoroState,
} from "../utils/pomodoro.ts";

export async function getPomodoro(c: Context) {
  const result = await kv.get<PomodoroRecord>(POMODORO_KEY);
  return c.json(result.value);
}

// Body: { state, rev, claim }. `rev` is the version the client edited from; a
// write against an older version is rejected with the current record so the
// client can catch up instead of overwriting another device. `claim` is set
// when this session starts a new pomodoro and should own its notifications.
export async function savePomodoro(c: Context) {
  const body = await c.req.json().catch(() => null) as
    | { state?: unknown; rev?: unknown; claim?: unknown }
    | null;
  if (!body) return c.json({ error: "Bad body" }, 400);
  const state = sanitizePomodoroState(body.state);
  if (!state) return c.json({ error: "Bad pomodoro state" }, 400);

  const requestedRev = typeof body.rev === "number" && Number.isFinite(body.rev)
    ? Math.max(0, Math.floor(body.rev))
    : null;
  const clientId = getClientIdFromCtx(c) ?? null;
  const browserId = getBrowserIdFromCtx(c) ?? null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await kv.get<PomodoroRecord>(POMODORO_KEY);
    const currentRev = cur.value?.rev ?? 0;
    // rev 0 means the tab hasn't loaded the server state yet (fresh page,
    // possibly an action straight after reload); let its explicit action win
    // instead of rejecting the first write of every session.
    if (requestedRev !== null && requestedRev > 0 && requestedRev !== currentRev) {
      return c.json(cur.value, 409);
    }
    // Starting a pomodoro claims its notifications. Pausing, resuming or
    // skipping elsewhere leaves them with the session that started it.
    const claim = body.claim === true;
    const keepOwner = !claim && cur.value?.ownerClientId;
    const next: PomodoroRecord = {
      state,
      rev: currentRev + 1,
      updatedAt: Date.now(),
      ownerClientId: keepOwner ? cur.value!.ownerClientId : clientId,
      ownerBrowserId: keepOwner ? cur.value!.ownerBrowserId : browserId,
    };
    const res = await kv.atomic().check(cur).set(POMODORO_KEY, next).commit();
    if (res.ok) {
      await emitSyncEvent({
        type: "pomodoro.saved",
        ref: "pomodoro",
        originClientId: clientId ?? undefined,
        payload: next,
      });
      return c.json(next);
    }
  }
  return c.json({ error: "Pomodoro write contention" }, 409);
}
