import { describe, expect, it } from "vitest";
import type { NoteMetadata, StoredNote } from "./notesStore.ts";
import { noteType, pickReport, reportUser, toNoteListItem, toNoteResource, toTaskResource } from "./readModel.ts";

const ORIGIN = "https://hawk.test";
const DATE = "2026-11-20";

const meta = (id: string, extra: Partial<NoteMetadata> = {}): NoteMetadata => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  tags: [],
  ...extra,
});

describe("noteType", () => {
  it("is journal with a day and notepad without", () => {
    expect(noteType({ day: DATE })).toBe("journal");
    expect(noteType({})).toBe("notepad");
  });
});

describe("toNoteResource", () => {
  it("uses ISO dates, an encoded url and nulls for missing fields", () => {
    const note: StoredNote = {
      id: "a b/c",
      title: "T",
      content: "# Hi",
      createdAt: Date.UTC(2026, 10, 20, 9, 12, 3),
      updatedAt: Date.UTC(2026, 10, 20, 10, 1, 44),
      rev: 3,
      tags: ["work"],
    };
    expect(toNoteResource(note, ORIGIN)).toEqual({
      id: "a b/c",
      title: "T",
      type: "notepad",
      date: null,
      source: null,
      author: null,
      createdAt: "2026-11-20T09:12:03.000Z",
      updatedAt: "2026-11-20T10:01:44.000Z",
      url: "https://hawk.test/notes/a%20b%2Fc",
      tags: ["work"],
      hidden: false,
      trashedAt: null,
      content: "# Hi",
    });
  });

  it("carries day, source, hidden and trash", () => {
    const r = toNoteResource(
      { ...meta("day-x"), content: "", rev: 1, day: DATE, source: "pi", hidden: true, deletedAt: 0 + 1000 },
      ORIGIN,
    );
    expect(r).toMatchObject({ type: "journal", date: DATE, source: "pi", author: "pi", hidden: true, trashedAt: "1970-01-01T00:00:01.000Z" });
  });
});

describe("toNoteListItem", () => {
  it("has a preview but no content, and no preview when hidden", () => {
    const item = toNoteListItem(meta("a", { preview: "Hello" }), ORIGIN);
    expect(item.preview).toBe("Hello");
    expect("content" in item).toBe(false);
    expect("preview" in toNoteListItem(meta("h", { preview: "secret", hidden: true }), ORIGIN)).toBe(false);
  });
});

describe("toTaskResource", () => {
  it("maps done to status and fills nulls", () => {
    expect(toTaskResource({ id: "t", text: "Do", done: true, order: 5 })).toEqual({
      id: "t", text: "Do", status: "done", time: null, comment: null, parentId: null, order: 5, updatedAt: null,
    });
    expect(toTaskResource({ id: "s", text: "", done: false, order: 1, time: "09:30", comment: "c", parentId: "t", updatedAt: 0 }))
      .toMatchObject({ status: "open", time: "09:30", comment: "c", parentId: "t", updatedAt: "1970-01-01T00:00:00.000Z" });
    expect(toTaskResource({ id: "c", text: "Dropped", done: false, order: 2, cancelled: true }))
      .toMatchObject({ status: "cancelled" });
  });
});

describe("reportUser", () => {
  it("reads per-user, old-form and replacement ids", () => {
    expect(reportUser(`pi-report-pedro-${DATE}`, DATE)).toBe("pedro");
    expect(reportUser(`pi-report-pedro-netto-${DATE}`, DATE)).toBe("pedro-netto");
    expect(reportUser(`pi-report-${DATE}`, DATE)).toBe("");
    expect(reportUser(`pi-report-pedro-${DATE}-replacement-1b4e28ba-2fa1-11d2-883f-0016d3cca427`, DATE)).toBe("pedro");
  });

  it("rejects other ids and other dates", () => {
    expect(reportUser(`pi-report-pedro-2026-11-21`, DATE)).toBeNull();
    expect(reportUser(`day-${DATE}`, DATE)).toBeNull();
    expect(reportUser(`pi-report-${DATE}-replacement-abc`, DATE)).toBeNull();
    expect(reportUser(`pi-report-pedro-${DATE}-extra`, DATE)).toBeNull();
  });
});

describe("pickReport", () => {
  const day = { day: DATE };
  const metas = [
    meta(`pi-report-pedro-${DATE}`, { ...day, updatedAt: 10 }),
    meta(`pi-report-${DATE}`, { ...day, updatedAt: 5 }),
    meta(`pi-report-pedro-${DATE}-replacement-abc-123`, { ...day, updatedAt: 20 }),
    meta(`pi-report-ana-${DATE}`, { ...day, updatedAt: 15 }),
    // Wrong day field, unrelated note, trashed newer one.
    meta(`pi-report-zed-${DATE}`, { updatedAt: 99 }),
    meta("other", { ...day, updatedAt: 50 }),
    meta(`pi-report-bob-${DATE}`, { ...day, updatedAt: 100, deletedAt: 101 }),
  ];

  it("picks the newest untrashed match and lists the rest", () => {
    const r = pickReport(metas, DATE);
    expect(r.active?.id).toBe(`pi-report-pedro-${DATE}-replacement-abc-123`);
    expect(r.alternatives).toEqual([`pi-report-ana-${DATE}`, `pi-report-pedro-${DATE}`, `pi-report-${DATE}`]);
    expect(r.trashedOnly).toBe(false);
  });

  it("narrows by user", () => {
    const r = pickReport(metas, DATE, "ana");
    expect(r.active?.id).toBe(`pi-report-ana-${DATE}`);
    expect(r.alternatives).toEqual([]);
  });

  it("flags when only trashed reports match", () => {
    expect(pickReport(metas, DATE, "bob")).toEqual({ active: null, alternatives: [], trashedOnly: true });
    expect(pickReport(metas, DATE, "nobody")).toEqual({ active: null, alternatives: [], trashedOnly: false });
    expect(pickReport(metas, "2026-11-21").active).toBeNull();
  });
});
