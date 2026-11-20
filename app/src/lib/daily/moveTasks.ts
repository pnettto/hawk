// Moving tasks between days. Mirrors moveTasksBetween in
// server/utils/dayLog.ts (keep the two in step): the store uses it for the
// optimistic update and guest mode uses it as the server.
import type { Task } from '../../types/models'

function compareTasks(a: Task, b: Task): number {
  if (a.time && b.time) return a.time.localeCompare(b.time) || a.order - b.order
  if (a.time) return -1
  if (b.time) return 1
  return a.order - b.order
}

// The ids plus every subtask under them.
export function withDescendantIds(tasks: Task[], ids: Iterable<string>): Set<string> {
  const out = new Set([...ids].filter((id) => tasks.some((t) => t.id === id)))
  let grew = true
  while (grew) {
    grew = false
    for (const t of tasks) {
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id)
        grew = true
      }
    }
  }
  return out
}

export interface MoveResult {
  from: Task[]
  to: Task[]
  moved: string[]
}

export function moveTasksBetween(
  from: Task[],
  to: Task[],
  ids: string[],
  opts: { orders?: Record<string, number>; now?: number; newId?: () => string } = {},
): MoveResult {
  const now = opts.now ?? Date.now()
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const picked = withDescendantIds(from, ids)
  if (!picked.size) return { from, to, moved: [] }

  const moving = from.filter((t) => picked.has(t.id))
  // A task whose parent stays behind becomes top-level on the target.
  const isRoot = (t: Task) => !t.parentId || !picked.has(t.parentId)
  const roots = moving.filter(isRoot).sort(compareTasks)
  let next = Math.max(0, ...to.filter((t) => !t.parentId && !t.time).map((t) => t.order))
  const rootOrder = new Map<string, number>()
  for (const r of roots) {
    const pinned = opts.orders?.[r.id]
    rootOrder.set(r.id, typeof pinned === 'number' ? pinned : ++next)
  }

  const taken = new Set(to.map((t) => t.id))
  const idMap = new Map<string, string>()
  for (const t of moving) {
    let id = t.id
    while (taken.has(id)) id = newId()
    taken.add(id)
    idMap.set(t.id, id)
  }

  const moved: Task[] = moving.map((t) => {
    const root = isRoot(t)
    const out: Task = { ...t, id: idMap.get(t.id)!, order: root ? rootOrder.get(t.id)! : t.order, updatedAt: now }
    if (root) delete out.parentId
    else out.parentId = idMap.get(t.parentId!)!
    return out
  })

  return {
    from: from.filter((t) => !picked.has(t.id)),
    to: [...to, ...moved],
    moved: moved.map((t) => t.id),
  }
}
