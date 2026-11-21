// Search matching. Pure: callers feed it notes and days, it returns ranked
// hits. Kept in sync with app/src/lib/search/match.ts (guest mode), and both
// copies share the same test table.
//
// Rules: case- and diacritic-insensitive; every term must match (AND);
// "quoted phrases" match as written; #tag tokens filter by tag instead of
// matching text. Hidden notes match on title and tags only and never return
// a snippet. Trashed notes are skipped.
import { parseTags } from "./tags.ts";

export type Range = [number, number];

export interface SearchQuery {
  // Normalized words and phrases; each has to match.
  needles: string[];
  // Normalized tags (without "#"); each has to be on the item.
  tags: string[];
}

export interface NoteDoc {
  id: string;
  title: string;
  // Plain text: markdown and the tag line already stripped.
  body: string;
  tags: string[];
  updatedAt: number;
  day?: string;
  hidden?: boolean;
  deletedAt?: number;
}

export interface NoteHit {
  id: string;
  title: string;
  day?: string;
  tags: string[];
  updatedAt: number;
  hidden?: boolean;
  // Omitted for hidden notes.
  snippet?: string;
  titleMatches: Range[];
  snippetMatches: Range[];
  field: "title" | "tag" | "body";
}

export interface TaskDoc {
  id: string;
  text: string;
  done: boolean;
  time?: string;
  comment?: string;
  parentId?: string;
  order?: number;
}

export interface DayDoc {
  date: string;
  tasks: TaskDoc[];
}

export interface TaskHit {
  date: string;
  id: string;
  text: string;
  done: boolean;
  time?: string;
  // Set on subtasks.
  parentText?: string;
  // A snippet of the comment, when the comment matched.
  comment?: string;
  textMatches: Range[];
  commentMatches: Range[];
}

export interface KindResult<T> {
  results: T[];
  truncated: boolean;
}

const SNIPPET_LEN = 140;
const COMMENT_SNIPPET_LEN = 100;

function foldChar(ch: string): string {
  return ch.normalize("NFD").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalize(s: string): string {
  return foldChar(s);
}

// Normalized text plus, for each of its code units, the span of the original
// it came from, so hits found in the normalized text can be marked in the
// original.
function fold(s: string): { text: string; from: number[]; to: number[] } {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = foldChar(ch);
    // A lone combining mark belongs to the character before it.
    if (!f && to.length) to[to.length - 1] = i + ch.length;
    text += f;
    for (let k = 0; k < f.length; k++) {
      from.push(i);
      to.push(i + ch.length);
    }
    i += ch.length;
  }
  return { text, from, to };
}

// Null when there's nothing to search for: under 2 characters of text and no
// tags.
export function parseQuery(q: string): SearchQuery | null {
  const needles: string[] = [];
  const tags: string[] = [];
  const rest = (q ?? "").replace(/"([^"]*)"?/g, (_, phrase: string) => {
    const p = normalize(phrase).replace(/\s+/g, " ").trim();
    if (p) needles.push(p);
    return " ";
  });
  for (const word of rest.split(/\s+/)) {
    if (!word) continue;
    if (word.startsWith("#") && word.length > 1) {
      const tag = normalize(word.slice(1)).replace(/[-/]+$/, "");
      if (tag && !tags.includes(tag)) tags.push(tag);
      continue;
    }
    const n = normalize(word);
    if (n && !needles.includes(n)) needles.push(n);
  }
  const textLen = needles.join(" ").length;
  if (textLen < 2 && !tags.length) return null;
  return { needles, tags };
}

// Every occurrence of any needle in `text`, merged, in original offsets.
export function highlight(text: string, needles: string[]): Range[] {
  if (!text || !needles.length) return [];
  const f = fold(text);
  const raw: Range[] = [];
  for (const n of needles) {
    let at = f.text.indexOf(n);
    while (at !== -1 && raw.length < 200) {
      raw.push([f.from[at], f.to[at + n.length - 1]]);
      at = f.text.indexOf(n, at + n.length);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: Range[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

// About `len` characters of `text` around `pos`, cut at word boundaries, with
// "…" where it was cut.
export function snippetAround(text: string, pos: number, len = SNIPPET_LEN): string {
  if (text.length <= len) return text;
  let start = Math.max(0, Math.min(pos - Math.floor(len / 4), text.length - len));
  let end = Math.min(text.length, start + len);
  if (start > 0 && !isSpace(text[start - 1])) {
    const sp = text.slice(start, pos).search(/\s/);
    if (sp !== -1) start += sp + 1;
  }
  if (end < text.length && !isSpace(text[end])) {
    const sp = text.slice(Math.max(pos, start), end).search(/\s\S*$/);
    if (sp !== -1) end = Math.max(pos, start) + sp;
  }
  const body = text.slice(start, end).trim();
  return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "");
}

// The first place any needle occurs, in original offsets, or -1.
function firstHit(text: string, needles: string[]): number {
  const f = fold(text);
  let best = -1;
  for (const n of needles) {
    const at = f.text.indexOf(n);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best === -1 ? -1 : f.from[best];
}

const hasTags = (have: string[], want: string[]) => {
  if (!want.length) return true;
  const norm = have.map(normalize);
  return want.every((t) => norm.includes(t));
};

type Field = NoteHit["field"];
const TIER: Record<Field, number> = { title: 0, tag: 1, body: 2 };

interface NoteCandidate {
  doc: NoteDoc;
  field: Field;
}

function matchNote(doc: NoteDoc, q: SearchQuery): NoteCandidate | null {
  if (doc.deletedAt) return null;
  // Day drafts nobody typed into.
  if (!doc.title.trim() && !doc.body.trim()) return null;
  if (!hasTags(doc.tags, q.tags)) return null;
  const title = normalize(doc.title).replace(/\s+/g, " ");
  const tags = doc.tags.map(normalize);
  const body = doc.hidden ? "" : normalize(doc.body);
  let inTitle = false;
  let inTag = false;
  for (const n of q.needles) {
    const t = title.includes(n);
    const g = !t && tags.some((tag) => tag.includes(n));
    if (!t && !g && !body.includes(n)) return null;
    inTitle ||= t;
    inTag ||= g;
  }
  const field: Field = inTitle ? "title" : inTag || !q.needles.length ? "tag" : "body";
  return { doc, field };
}

// Whether a note matches at all, without ranking or snippets (read API).
export function noteMatches(doc: NoteDoc, q: SearchQuery): boolean {
  return matchNote(doc, q) !== null;
}

function noteHit({ doc, field }: NoteCandidate, q: SearchQuery): NoteHit {
  const hit: NoteHit = {
    id: doc.id,
    title: doc.title,
    tags: doc.tags,
    updatedAt: doc.updatedAt,
    titleMatches: highlight(doc.title, q.needles),
    snippetMatches: [],
    field,
  };
  if (doc.day) hit.day = doc.day;
  if (doc.hidden) {
    hit.hidden = true;
    return hit;
  }
  const at = firstHit(doc.body, q.needles);
  const snippet = snippetAround(doc.body, Math.max(0, at));
  if (snippet) {
    hit.snippet = snippet;
    hit.snippetMatches = highlight(snippet, q.needles);
  }
  return hit;
}

export async function searchNotes(
  docs: Iterable<NoteDoc> | AsyncIterable<NoteDoc>,
  q: SearchQuery,
  limit: number,
): Promise<KindResult<NoteHit>> {
  const cands: NoteCandidate[] = [];
  let truncated = false;
  for await (const doc of docs) {
    const c = matchNote(doc, q);
    if (!c) continue;
    if (cands.length >= limit * 3) {
      truncated = true;
      break;
    }
    cands.push(c);
  }
  cands.sort((a, b) => TIER[a.field] - TIER[b.field] || b.doc.updatedAt - a.doc.updatedAt);
  if (cands.length > limit) truncated = true;
  return { results: cands.slice(0, limit).map((c) => noteHit(c, q)), truncated };
}

interface TaskCandidate {
  date: string;
  task: TaskDoc;
  parent?: TaskDoc;
  inComment: boolean;
}

function matchTask(task: TaskDoc, q: SearchQuery): { inComment: boolean } | null {
  const text = normalize(task.text ?? "").replace(/\s+/g, " ");
  const comment = normalize(task.comment ?? "").replace(/\s+/g, " ");
  if (!text.trim() && !comment.trim()) return null;
  if (q.tags.length && !hasTags(parseTags(`${task.text ?? ""}\n${task.comment ?? ""}`), q.tags)) return null;
  let inComment = false;
  for (const n of q.needles) {
    const t = text.includes(n);
    const c = comment.includes(n);
    if (!t && !c) return null;
    inComment ||= c;
  }
  return { inComment };
}

function taskHit(c: TaskCandidate, q: SearchQuery): TaskHit {
  const t = c.task;
  const hit: TaskHit = {
    date: c.date,
    id: t.id,
    text: t.text ?? "",
    done: !!t.done,
    textMatches: highlight(t.text ?? "", q.needles),
    commentMatches: [],
  };
  if (t.time) hit.time = t.time;
  if (c.parent) hit.parentText = c.parent.text;
  if (c.inComment && t.comment) {
    const comment = t.comment.replace(/\s+/g, " ").trim();
    hit.comment = snippetAround(comment, Math.max(0, firstHit(comment, q.needles)), COMMENT_SNIPPET_LEN);
    hit.commentMatches = highlight(hit.comment, q.needles);
  }
  return hit;
}

// Feed days newest first: once there are enough candidates the scan stops,
// so the oldest days are the ones left out.
export async function searchTasks(
  days: Iterable<DayDoc> | AsyncIterable<DayDoc>,
  q: SearchQuery,
  limit: number,
): Promise<KindResult<TaskHit>> {
  const cands: TaskCandidate[] = [];
  let truncated = false;
  scan: for await (const day of days) {
    const byId = new Map(day.tasks.map((t) => [t.id, t]));
    for (const task of day.tasks) {
      const m = matchTask(task, q);
      if (!m) continue;
      if (cands.length >= limit * 3) {
        truncated = true;
        break scan;
      }
      const parent = task.parentId ? byId.get(task.parentId) : undefined;
      cands.push({ date: day.date, task, parent, inComment: m.inComment });
    }
  }
  cands.sort((a, b) =>
    (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
    Number(!!a.task.done) - Number(!!b.task.done) ||
    (a.task.time ?? "99:99").localeCompare(b.task.time ?? "99:99") ||
    (a.task.order ?? 0) - (b.task.order ?? 0)
  );
  if (cands.length > limit) truncated = true;
  return { results: cands.slice(0, limit).map((c) => taskHit(c, q)), truncated };
}
