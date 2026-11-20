// One entry in an ActionMenu. Icons are 16×16 stroke paths, drawn at the same
// weight as the visible action buttons.
export interface ActionMenuItem {
  label: string
  icon?: string | string[]
  danger?: boolean
  onSelect: () => void
}

// Chain link, for "Copy link" actions.
export const LINK_ICON = ['M7 9a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.2l-1 1', 'M9 7a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.2l1-1']
