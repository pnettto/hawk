import { describe, expect, it } from "vitest";
import {
  pickPomodoroNotifier,
  sanitizePomodoroState,
  type PomodoroSession,
} from "./pomodoro.ts";

const session = (clientId: string, browserId: string | null): PomodoroSession => ({
  clientId,
  browserId,
});

describe("pickPomodoroNotifier", () => {
  it("prefers a session in the same browser", () => {
    const sessions = [
      session("phone", "phone-browser"),
      session("desktop-2", "desktop-browser"),
      session("desktop-1", "desktop-browser"),
    ];
    expect(pickPomodoroNotifier(sessions, "desktop-browser")).toEqual(session("desktop-2", "desktop-browser"));
  });

  it("falls back to another connected session", () => {
    const sessions = [session("phone", "phone-browser"), session("tablet", null)];
    expect(pickPomodoroNotifier(sessions, "desktop-browser")).toEqual(session("phone", "phone-browser"));
  });

  it("returns null when nothing is left to notify", () => {
    expect(pickPomodoroNotifier([], "desktop-browser")).toBeNull();
  });
});

describe("sanitizePomodoroState", () => {
  it("keeps a running block", () => {
    const now = Date.now();
    const state = sanitizePomodoroState({
      taskId: "t1",
      taskText: "Write",
      dateStr: "2024-05-01",
      mode: "focus",
      running: true,
      endsAt: now + 60_000,
      remainingMs: 60_000,
      focusMs: 25 * 60_000,
      breakMs: 5 * 60_000,
      completed: 2,
    });
    expect(state).toMatchObject({
      taskId: "t1",
      mode: "focus",
      running: true,
      completed: 2,
    });
    expect(state?.endsAt).toBe(now + 60_000);
  });

  it("drops an unknown mode", () => {
    expect(sanitizePomodoroState({ mode: "nap", remainingMs: 1 })).toBeNull();
  });
});
