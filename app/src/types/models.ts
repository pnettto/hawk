// Shared models — kept in sync with server/routeHandlers/notes.ts and app.ts.

export interface Collection {
  id: string;
  name: string;
}

export interface NoteMetadata {
  id: string;
  cid: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  preview?: string;
}

export interface Note extends NoteMetadata {
  content: string;
  isPublic?: boolean;
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
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  // "HH:MM" (24h); absent for untimed tasks.
  time?: string;
  comment?: string;
  // Sort key among untimed tasks.
  order: number;
  updatedAt?: number;
}

export interface DayNote {
  id: string;
  title: string;
  markdown: string;
  order: number;
  rev: number;
  updatedAt: number;
}

// Normalized day log — the server converts the legacy hour-slot shape on read.
export interface DayLog {
  tasks: Task[];
  notes: DayNote[];
}

export type LogsByDate = Record<string, DayLog>;

export interface SnapshotMeta {
  savedAt: number;
  preview: string;
}

export type SnapshotKind = "note" | "day-notes" | "day-tasks";
