// One entry in an ActionMenu. Icons are 16×16 stroke paths, drawn at the same
// weight as the visible action buttons.
export interface ActionMenuItem {
  label: string
  icon?: string | string[]
  danger?: boolean
  onSelect: () => void
}
