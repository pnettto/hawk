import { describe, expect, it } from 'vitest'
import { filterFor, filterIncludes, formatRoute, historyMode, parseRoute, routeFromNav, type NavState, type Route } from './routes'
import type { NoteMetadata } from '../types/models'

const TODAY = '2026-05-20'

describe('parseRoute / formatRoute', () => {
  it.each<[string, Route]>([
    ['/journal/2026-05-14', { page: 'journal', date: '2026-05-14', tab: 'tasks' }],
    ['/journal/2026-05-14/notes', { page: 'journal', date: '2026-05-14', tab: 'notes' }],
    ['/journal/2026-05-14?task=abc', { page: 'journal', date: '2026-05-14', tab: 'tasks', task: 'abc' }],
    ['/notes', { page: 'notes' }],
    ['/notes/all', { page: 'notes', filter: { kind: 'all' } }],
    ['/notes/notepad', { page: 'notes', filter: { kind: 'notepad' } }],
    ['/notes/day', { page: 'notes', filter: { kind: 'day' } }],
    ['/notes/untagged', { page: 'notes', filter: { kind: 'untagged' } }],
    ['/notes/trash', { page: 'notes', filter: { kind: 'trash' } }],
    ['/notes/tag/work', { page: 'notes', filter: { kind: 'tag', tag: 'work' } }],
    ['/notes/0b6a1f5e-1111-4222-8333-444455556666', { page: 'notes', nid: '0b6a1f5e-1111-4222-8333-444455556666' }],
    ['/notes/day-2026-05-14', { page: 'notes', nid: 'day-2026-05-14' }],
    ['/files', { page: 'files' }],
    ['/extensions', { page: 'extensions' }],
    ['/settings', { page: 'settings' }],
  ])('round-trips %s', (url, route) => {
    expect(parseRoute(url)).toEqual(route)
    expect(formatRoute(route, TODAY)).toBe(url)
  })

  it('folds today on the Tasks tab into /', () => {
    expect(formatRoute({ page: 'journal', date: TODAY, tab: 'tasks' }, TODAY)).toBe('/')
    expect(formatRoute({ page: 'journal' }, TODAY)).toBe('/')
    expect(formatRoute({ page: 'journal', date: TODAY, tab: 'notes' }, TODAY)).toBe(`/journal/${TODAY}/notes`)
    expect(formatRoute({ page: 'journal', date: TODAY, tab: 'tasks', task: 'x' }, TODAY)).toBe(`/journal/${TODAY}?task=x`)
  })

  it('keeps explicit dates for links', () => {
    expect(formatRoute({ page: 'journal', date: TODAY, tab: 'tasks' }, null)).toBe(`/journal/${TODAY}`)
  })

  it.each(['work stuff', 'café', 'a#b', 'x/y', 'ü?&='])('encodes the tag %s', (tag) => {
    const url = formatRoute({ page: 'notes', filter: { kind: 'tag', tag } }, TODAY)
    expect(url.slice('/notes/tag/'.length)).not.toMatch(/[ #/?&]/)
    expect(parseRoute(url)).toEqual({ page: 'notes', filter: { kind: 'tag', tag } })
  })

  it.each([
    '/journal/2026-5-14',
    '/journal/yesterday',
    '/journal/2026-05-14/overview',
    '/journal/overview',
    '/notes/tag/',
    '/notes/tag',
    '/notes/a/b',
    '/notes/%E0%A4%A',
    '/files/x',
    '/nope',
    '',
  ])('falls back to the Journal for %s', (url) => {
    expect(parseRoute(url)).toEqual({ page: 'journal' })
  })

  it('ignores unknown and invalid query params', () => {
    expect(parseRoute('/?pomodoro=resume')).toEqual({ page: 'journal' })
    expect(parseRoute('/journal/2026-05-14/notes?task=a')).toEqual({ page: 'journal', date: '2026-05-14', tab: 'notes' })
  })
})

describe('routeFromNav', () => {
  const base: NavState = {
    currentPage: 'app',
    journalTab: 'tasks',
    selectedDate: '2026-05-14',
    highlightTaskId: null,
    notesFilter: { kind: 'notepad' },
    selectedNid: null,
  }

  it('maps each page', () => {
    expect(routeFromNav(base)).toEqual({ page: 'journal', date: '2026-05-14', tab: 'tasks' })
    expect(routeFromNav({ ...base, highlightTaskId: 't' })).toEqual({ page: 'journal', date: '2026-05-14', tab: 'tasks', task: 't' })
    expect(routeFromNav({ ...base, currentPage: 'notes' })).toEqual({ page: 'notes', filter: { kind: 'notepad' } })
    expect(routeFromNav({ ...base, currentPage: 'notes', selectedNid: 'n1' })).toEqual({ page: 'notes', nid: 'n1' })
    expect(routeFromNav({ ...base, currentPage: 'admin' })).toEqual({ page: 'settings' })
    expect(routeFromNav({ ...base, currentPage: 'files' })).toEqual({ page: 'files' })
  })
})

describe('historyMode', () => {
  const day = (date: string): Route => ({ page: 'journal', date, tab: 'tasks' })
  it('pushes places and replaces small steps', () => {
    expect(historyMode(day('2026-05-01'), day('2026-05-02'))).toBe('replace')
    expect(historyMode(day('2026-05-01'), { page: 'journal', date: '2026-05-01', tab: 'notes' })).toBe('replace')
    expect(historyMode(day('2026-05-01'), { page: 'notes' })).toBe('push')
    expect(historyMode({ page: 'notes', filter: { kind: 'all' } }, { page: 'notes', nid: 'a' })).toBe('push')
    expect(historyMode({ page: 'notes', nid: 'a' }, { page: 'notes', nid: 'b' })).toBe('push')
    expect(historyMode({ page: 'notes', filter: { kind: 'all' } }, { page: 'notes', filter: { kind: 'trash' } })).toBe('push')
    expect(historyMode({ page: 'notes', filter: { kind: 'tag', tag: 'a' } }, { page: 'notes', filter: { kind: 'tag', tag: 'a' } })).toBe('replace')
    expect(historyMode(null, { page: 'files' })).toBe('replace')
  })
})

describe('filterFor', () => {
  const note = (p: Partial<NoteMetadata>): NoteMetadata => ({ id: 'n', title: '', createdAt: 0, updatedAt: 0, ...p }) as NoteMetadata
  it('keeps a filter that shows the note', () => {
    expect(filterFor({ kind: 'tag', tag: 'a' }, note({ tags: ['a'] }))).toEqual({ kind: 'tag', tag: 'a' })
    expect(filterIncludes({ kind: 'all' }, note({ day: '2026-05-01' }))).toBe(true)
  })
  it('falls back to a view that contains it', () => {
    expect(filterFor({ kind: 'notepad' }, note({ day: '2026-05-01' }))).toEqual({ kind: 'day' })
    expect(filterFor({ kind: 'day' }, note({}))).toEqual({ kind: 'notepad' })
    expect(filterFor({ kind: 'all' }, note({ deletedAt: 1 }))).toEqual({ kind: 'trash' })
  })
})
