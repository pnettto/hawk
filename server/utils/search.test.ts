// The matcher's test table. app/src/lib/search/match.test.ts runs the same
// cases against the guest-mode copy; keep the two in step.
import { describe, expect, it } from "vitest";
import {
  type DayDoc,
  highlight,
  type NoteDoc,
  normalize,
  parseQuery,
  searchNotes,
  searchTasks,
  snippetAround,
} from "./search.ts";

const note = (id: string, title: string, body: string, extra: Partial<NoteDoc> = {}): NoteDoc => ({
  id,
  title,
  body,
  tags: [],
  updatedAt: 1,
  ...extra,
});

async function noteIds(q: string, docs: NoteDoc[], limit = 30) {
  const parsed = parseQuery(q);
  if (!parsed) return null;
  return (await searchNotes(docs, parsed, limit)).results.map((h) => h.id);
}

describe("normalize and parseQuery", () => {
  it("folds case and diacritics", () => {
    expect(normalize("Pedro PÁRAMO Ünïcode")).toBe("pedro paramo unicode");
  });

  it("splits terms, phrases and tags", () => {
    expect(parseQuery('Café "Old Man" #Travel sea')).toEqual({
      needles: ["old man", "cafe", "sea"],
      tags: ["travel"],
    });
  });

  it("returns null under 2 characters unless there are tags", () => {
    expect(parseQuery("")).toBeNull();
    expect(parseQuery("  a ")).toBeNull();
    expect(parseQuery("ab")).not.toBeNull();
    expect(parseQuery("#x")).toEqual({ needles: [], tags: ["x"] });
  });
});

describe("matching notes", () => {
  const docs = [
    note("a", "Reading list", "Pedro Páramo by Juan Rulfo", { tags: ["books"] }),
    note("b", "Trip", "Book the train to the sea", { tags: ["travel", "personal"] }),
    note("c", "Old man", "The Old Man and the Sea"),
  ];

  it("ignores diacritics both ways", async () => {
    expect(await noteIds("paramo", docs)).toEqual(["a"]);
    expect(await noteIds("rúlfo", docs)).toEqual(["a"]);
  });

  it("needs every term (AND)", async () => {
    expect(await noteIds("sea train", docs)).toEqual(["b"]);
    expect(await noteIds("sea nothing", docs)).toEqual([]);
  });

  it("matches quoted phrases as written", async () => {
    expect(await noteIds('"the sea"', docs)).toEqual(["b", "c"]);
    expect(await noteIds('"sea the"', docs)).toEqual([]);
  });

  it("filters by #tag instead of matching text", async () => {
    expect(await noteIds("#travel", docs)).toEqual(["b"]);
    expect(await noteIds("#travel sea", docs)).toEqual(["b"]);
    expect(await noteIds("#books sea", docs)).toEqual([]);
    expect(await noteIds("#trav", docs)).toEqual([]);
  });

  it("skips trash and empty drafts", async () => {
    const more = [...docs, note("t", "Sea trash", "", { deletedAt: 5 }), note("e", "", "")];
    expect(await noteIds("sea", more)).not.toContain("t");
    expect(await noteIds("#books", more)).not.toContain("e");
  });
});

describe("ranking notes", () => {
  it("puts title over tag over body, newest first within a tier", async () => {
    const docs = [
      note("body-old", "x", "a garden plan", { updatedAt: 1 }),
      note("body-new", "y", "garden again", { updatedAt: 9 }),
      note("tag", "z", "nothing", { tags: ["garden"], updatedAt: 2 }),
      note("title-old", "Garden", "", { updatedAt: 3 }),
      note("title-new", "My garden", "", { updatedAt: 4 }),
    ];
    expect(await noteIds("garden", docs)).toEqual(["title-new", "title-old", "tag", "body-new", "body-old"]);
  });

  it("returns the top `limit` and flags truncation", async () => {
    const docs = Array.from({ length: 20 }, (_, i) => note(`n${i}`, "", `garden ${i}`, { updatedAt: i }));
    const r = await searchNotes(docs, parseQuery("garden")!, 2);
    expect(r.results.map((h) => h.id)).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});

describe("hidden notes", () => {
  const docs = [
    note("h", "Passwords", "the secret garden", { hidden: true, tags: ["private"] }),
  ];

  it("match on title and tags only", async () => {
    expect(await noteIds("garden", docs)).toEqual([]);
    expect(await noteIds("passwords", docs)).toEqual(["h"]);
    expect(await noteIds("#private", docs)).toEqual(["h"]);
  });

  it("never return a snippet", async () => {
    const r = await searchNotes(docs, parseQuery("pass")!, 10);
    expect(r.results[0].snippet).toBeUndefined();
    expect(r.results[0].snippetMatches).toEqual([]);
    expect(r.results[0].hidden).toBe(true);
  });
});

describe("snippets and highlights", () => {
  it("marks every hit in the original text", () => {
    expect(highlight("Café and CAFE", ["cafe"])).toEqual([[0, 4], [9, 13]]);
    // Decomposed input keeps its marks inside the range.
    expect(highlight("Cafe\u0301!", ["cafe"])).toEqual([[0, 5]]);
    expect(highlight("abcabc", ["bc", "abc"])).toEqual([[0, 6]]);
  });

  it("keeps short text whole", () => {
    expect(snippetAround("short text", 3)).toBe("short text");
  });

  it("cuts long text at word boundaries around the hit", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const pos = words.indexOf("word40");
    const s = snippetAround(words, pos);
    expect(s.startsWith("…word")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("word40");
    expect(s.length).toBeLessThanOrEqual(142);
    // No partial words at the cuts.
    for (const w of s.replace(/…/g, "").split(" ")) expect(w).toMatch(/^word\d+$/);
  });

  it("starts at the beginning when the hit is near it", () => {
    const text = "garden " + "x".repeat(300);
    expect(snippetAround(text, 0).startsWith("garden")).toBe(true);
  });

  it("gives body hits a snippet with marks", async () => {
    const r = await searchNotes([note("a", "T", "We planted the garden today")], parseQuery("garden")!, 5);
    const h = r.results[0];
    expect(h.field).toBe("body");
    expect(h.snippet).toBe("We planted the garden today");
    expect(h.snippetMatches).toEqual([[15, 21]]);
  });
});

describe("matching tasks", () => {
  const days: DayDoc[] = [
    {
      date: "2026-05-14",
      tasks: [
        { id: "p", text: "Plan the trip", done: false, order: 0 },
        { id: "s", text: "Book the train", done: true, parentId: "p", order: 1 },
        { id: "o", text: "Book a café", done: false, order: 2, comment: "Ask Ana about the #travel budget" },
      ],
    },
    {
      date: "2026-01-02",
      tasks: [{ id: "old", text: "Book dentist", done: false, order: 0 }],
    },
  ];

  const run = async (q: string, limit = 30) => (await searchTasks(days, parseQuery(q)!, limit));

  it("matches text and comment with AND", async () => {
    expect((await run("book")).results.map((t) => t.id)).toEqual(["o", "s", "old"]);
    expect((await run("book ana")).results.map((t) => t.id)).toEqual(["o"]);
    expect((await run("cafe")).results.map((t) => t.id)).toEqual(["o"]);
  });

  it("returns a comment snippet only when the comment matched", async () => {
    const [hit] = (await run("budget")).results;
    expect(hit.comment).toBe("Ask Ana about the #travel budget");
    expect(hit.commentMatches).toEqual([[26, 32]]);
    const [plain] = (await run("cafe")).results;
    expect(plain.comment).toBeUndefined();
  });

  it("skips cancelled tasks", async () => {
    const withCancelled: DayDoc[] = [{
      date: "2026-05-14",
      tasks: [
        { id: "keep", text: "Book the train", done: false, order: 0 },
        { id: "gone", text: "Book the bus", done: false, order: 1, cancelled: true },
      ],
    }];
    const r = await searchTasks(withCancelled, parseQuery("book")!, 30);
    expect(r.results.map((t) => t.id)).toEqual(["keep"]);
  });

  it("names the parent of a subtask", async () => {
    const [hit] = (await run("train")).results;
    expect(hit.parentText).toBe("Plan the trip");
  });

  it("filters by tags written in the task", async () => {
    expect((await run("#travel")).results.map((t) => t.id)).toEqual(["o"]);
  });

  it("orders newest day first, open before done", async () => {
    const r = await run("book");
    expect(r.results.map((t) => [t.date, t.done])).toEqual([
      ["2026-05-14", false],
      ["2026-05-14", true],
      ["2026-01-02", false],
    ]);
  });

  it("stops scanning at limit × 3 candidates", async () => {
    const r = await run("book", 1);
    expect(r.results.map((t) => t.id)).toEqual(["o"]);
    expect(r.truncated).toBe(true);
  });
});
