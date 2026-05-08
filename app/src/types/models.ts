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
}

export interface HourEntry {
  checked: boolean;
  text: string;
  comment: string;
}

// A day log is a map of "9", "9-30", "10", ... → HourEntry, plus a few reserved keys.
export interface DayLog {
  notesMarkdown?: string;
  [hour: string]: HourEntry | string | undefined;
}

export type LogsByDate = Record<string, DayLog>;
