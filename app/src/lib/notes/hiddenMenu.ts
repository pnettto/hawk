import { notesStore } from '../../stores/notes'
import { conceal } from '../../stores/hidden'
import type { NoteMetadata } from '../../types/models'
import type { ActionMenuItem } from '../ui/menuItem'

export const LOCK_ICON = ['M4.5 7.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z', 'M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2']
const SHOW_ICON = ['M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z', 'M8 6.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z']
const HIDE_ICON = ['M2 2l12 12', 'M6.6 3.7A6.6 6.6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-1.9 2.4', 'M4.2 4.9A11.6 11.6 0 0 0 1.5 8S4 12.5 8 12.5a6.4 6.4 0 0 0 3-.8']

// Hide/lock/unhide actions for a note whose content is on screen. A draft
// that hasn't been saved yet can't be hidden.
export function hiddenMenuItems(note: NoteMetadata | null | undefined): ActionMenuItem[] {
  if (!note || note.local) return []
  const nid = note.id
  if (!note.hidden) {
    return [{
      label: 'Hide note',
      icon: HIDE_ICON,
      onSelect: () => {
        conceal(nid)
        void notesStore.setHidden(nid, true)
      },
    }]
  }
  return [
    { label: 'Lock note', icon: LOCK_ICON, onSelect: () => conceal(nid) },
    { label: 'Unhide note', icon: SHOW_ICON, onSelect: () => void notesStore.setHidden(nid, false) },
  ]
}
