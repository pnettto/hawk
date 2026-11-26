// Shared models — kept in sync with server/routeHandlers/notes.ts and app.ts.

export interface NoteMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  preview?: string;
  isPublic?: boolean;
  // Content concealed until the main password is entered (stores/hidden.ts).
  hidden?: boolean;
  // #words found in the body.
  tags?: string[];
  // "YYYY-MM-DD" for a day's journal note.
  day?: string;
  // Order among the same day's notes.
  dayOrder?: number;
  // Where the note was created ("web", "pi", …). Set once on create.
  source?: string;
  // Client-only: created here and not saved yet.
  local?: boolean;
}

export interface Note extends NoteMetadata {
  content: string;
  rev?: number;
}

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  chunks: number;
  createdAt: number;
  inline?: boolean;
  isPublic?: boolean;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  // "HH:MM" (24h); absent for untimed tasks.
  time?: string;
  comment?: string;
  // Set on a subtask: the id of the task it belongs to.
  parentId?: string;
  // Cancelled tasks stay on the day, greyed out below the list.
  cancelled?: boolean;
  // Sort key among untimed tasks.
  order: number;
  updatedAt?: number;
}

// Normalized day log — the server converts the legacy hour-slot shape on read.
// (Day notes are regular notes with `day` set; see Note.)
export interface DayLog {
  tasks: Task[];
}

export type LogsByDate = Record<string, DayLog>;

export interface SnapshotMeta {
  savedAt: number;
  preview: string;
}

export type SnapshotKind = "note" | "day-tasks";
