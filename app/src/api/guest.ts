// In-browser stand-in for the API, used by "Let me test it" (guest mode).
// Data lives in localStorage only; nothing reaches the server. Loaded lazily
// from client.ts, so signed-in users never download it.
//
// Covers what the stores call: day tasks, notes, preferences. Version history
// is always empty and file uploads aren't available.

import { ApiError } from './client'
import { parseTags } from '../lib/notes/tags'
import { buildPreview } from '../stores/notes'
import { formatDate } from '../utils/date'
import type { DayLog, Note, NoteMetadata, Task } from '../types/models'

const STORE_KEY = 'hawk_guest_data'

interface GuestData {
  days: Record<string, DayLog>
  notes: Record<string, Note>
  prefs: Record<string, unknown>
}

let cache: GuestData | null = null

function load(): GuestData {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return (cache = JSON.parse(raw) as GuestData)
  } catch {
    /* unreadable or unavailable — start over */
  }
  cache = seed()
  persist()
  return cache
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cache))
  } catch {
    /* quota or private mode — keep going in memory */
  }
}

const metaOf = ({ content, rev, ...meta }: Note): NoteMetadata => ({
  ...meta,
  preview: buildPreview(content),
})

const clone = <T>(v: T): T => structuredClone(v)

export async function guestRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  return clone(handle(method, path, body as Record<string, unknown>)) as T
}

function handle(method: string, path: string, body: Record<string, unknown> = {}): unknown {
  const url = new URL(path, 'http://guest')
  const q = (k: string) => url.searchParams.get(k) ?? ''
  const data = load()
  const p = url.pathname

  if (p === '/api/auth-check') return { authenticated: true }

  // ---- Days
  if (p === '/api/day' && method === 'GET') return data.days[q('date')] ?? { tasks: [] }
  if (p === '/api/range') {
    const out: Record<string, DayLog> = {}
    for (const [d, log] of Object.entries(data.days)) if (d >= q('start') && d <= q('end')) out[d] = log
    return out
  }
  if (p === '/api/day/tasks' && method === 'POST') {
    const log = (data.days[q('date')] ??= { tasks: [] })
    const remove = new Set((body.remove as string[]) ?? [])
    const byId = new Map(log.tasks.map((t) => [t.id, t]))
    for (const id of remove) byId.delete(id)
    for (const t of (body.upsert as Task[]) ?? []) {
      if (!remove.has(t.id)) byId.set(t.id, { ...t, done: !!t.done, updatedAt: Date.now() })
    }
    log.tasks = [...byId.values()]
    persist()
    return { tasks: log.tasks }
  }
  if (p.startsWith('/api/day/versions')) return method === 'GET' && p === '/api/day/versions' ? [] : notFound()

  // ---- Notes
  if (p === '/api/notes/index') return Object.values(data.notes).map(metaOf)
  if (p === '/api/notes/days') {
    return Object.values(data.notes).filter((n) => n.day && !n.deletedAt && n.day >= q('start') && n.day <= q('end'))
  }
  if (p === '/api/notes/notes' && method === 'POST') return saveNote(data, body)
  if (p === '/api/notes/trash' && method === 'DELETE') {
    for (const n of Object.values(data.notes)) if (n.deletedAt) delete data.notes[n.id]
    persist()
    return { success: true }
  }
  const m = p.match(/^\/api\/notes\/notes\/([^/]+)(\/.*)?$/)
  if (m) {
    const [, nid, rest = ''] = m
    const note = data.notes[decodeURIComponent(nid)]
    if (rest === '/versions') return []
    if (rest.startsWith('/versions/')) return notFound()
    if (method === 'GET' && !rest) return note ?? notFound()
    if (method === 'DELETE' && !rest) {
      delete data.notes[decodeURIComponent(nid)]
      persist()
      return { success: true }
    }
    if (rest === '/trash' || rest === '/restore') {
      if (note) {
        if (rest === '/trash') note.deletedAt = Date.now()
        else delete note.deletedAt
        persist()
      }
      return { success: true }
    }
  }

  // ---- Preferences
  if (p === '/api/preferences') {
    if (method === 'POST') {
      Object.assign(data.prefs, body)
      persist()
    }
    return data.prefs
  }

  // ---- Files: none in the demo
  if (p === '/api/files' && method === 'GET') return []

  return notFound()
}

function notFound(): never {
  throw new ApiError(404, 'Not available in the demo')
}

// Mirrors server/routeHandlers/notes.ts saveNote: omitted fields keep their
// value, tags come from the body, rev counts text changes.
function saveNote(data: GuestData, body: Record<string, unknown>) {
  const id = body.id as string
  if (!id) throw new ApiError(400, 'Missing ID')
  const prev = data.notes[id]
  const now = Date.now()
  const content = typeof body.content === 'string' ? body.content : prev?.content ?? ''
  const title = typeof body.title === 'string' ? body.title : prev?.title ?? ''
  const changed = !prev || content !== prev.content || title !== prev.title
  const note: Note = {
    ...prev,
    id,
    title,
    content,
    createdAt: prev?.createdAt ?? (typeof body.createdAt === 'number' ? body.createdAt : now),
    updatedAt: changed ? now : prev.updatedAt,
    rev: (prev?.rev ?? 0) + (changed ? 1 : 0),
    tags: parseTags(content),
  }
  if (!prev && typeof body.day === 'string') note.day = body.day
  if (note.day && typeof body.dayOrder === 'number') note.dayOrder = body.dayOrder
  if (typeof body.isPublic === 'boolean') note.isPublic = body.isPublic
  delete note.preview
  data.notes[id] = note
  persist()
  return { success: true, rev: note.rev, updatedAt: note.updatedAt }
}

// ---- First-visit demo content

function seed(): GuestData {
  const today = formatDate(new Date())
  const now = Date.now()
  let order = 0
  const task = (text: string, time?: string, done = false, comment?: string): Task => ({
    id: crypto.randomUUID(),
    text,
    done,
    order: order++,
    ...(time ? { time } : {}),
    ...(comment ? { comment } : {}),
  })
  const note = (id: string, title: string, content: string, ageMin: number, extra: Partial<Note> = {}): Note => ({
    id,
    title,
    content,
    createdAt: now - ageMin * 60_000,
    updatedAt: now - ageMin * 60_000,
    rev: 1,
    tags: parseTags(content),
    ...extra,
  })

  return {
    days: {
      [today]: {
        tasks: [
          task('Plan the week', '09:00', true),
          task('Call with the designer', '11:30', false, 'Ask about the new logo.'),
          task('Lunch with Ana', '12:30'),
          task('Gym', '17:00'),
          task('Buy coffee beans'),
          task('Reply to the landlord'),
        ],
      },
    },
    notes: {
      'demo-welcome': note(
        'demo-welcome',
        'Welcome to Hawk',
        `This is a demo. Everything you write stays in this browser and nothing is sent anywhere.

- The **Journal** has a task list for each day. Type a time first ("14:30 Gym") to schedule a task.
- The **Notepad** holds notes. A word starting with "#" anywhere in a note becomes a tag, like the one below.
- In a note, type "/" on an empty line to add a heading, checklist, table or image.

#hawk`,
        5,
      ),
      'demo-trip': note(
        'demo-trip',
        'Weekend trip',
        `Leaving Friday after work.

- [x] Book the train
- [x] Find a place to stay
- [ ] Pack the camera
- [ ] Check the weather

#travel #personal`,
        60,
      ),
      'demo-reading': note(
        'demo-reading',
        'Reading list',
        `| Book | Author | Status |
| --- | --- | --- |
| The Old Man and the Sea | Ernest Hemingway | Reading |
| Invisible Cities | Italo Calvino | Next |
| Pedro Páramo | Juan Rulfo | Done |

#personal #books`,
        120,
      ),
      'demo-ideas': note(
        'demo-ideas',
        'Ideas',
        `A place for quick thoughts before they turn into notes.

- New cover image for the blog
- Try a no-meeting Wednesday
- Fix the creaky kitchen drawer`,
        90,
      ),
      [`day-${today}`]: note(`day-${today}`, '', `Started the week with a plan. The call with the designer is the main thing today.\n\n#journal`, 30, {
        day: today,
        dayOrder: 0,
      }),
    },
    prefs: {},
  }
}
