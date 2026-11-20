<script lang="ts">
  interface Props {
    expanded: boolean
    onclick: (event: MouseEvent) => void
    anchor?: HTMLButtonElement | null
    label?: string
    ghost?: boolean
  }
  let { expanded, onclick, anchor = $bindable(null), label = 'More actions', ghost = true }: Props = $props()
</script>

<button
  type="button"
  class="icon-btn more-button"
  class:ghost
  title={label}
  aria-label={label}
  aria-haspopup="menu"
  aria-expanded={expanded}
  bind:this={anchor}
  {onclick}
>
  <svg viewBox="0 0 16 16" fill="currentColor" stroke="none" aria-hidden="true">
    <circle cx="3.4" cy="8" r="1.15" />
    <circle cx="8" cy="8" r="1.15" />
    <circle cx="12.6" cy="8" r="1.15" />
  </svg>
</button>

<style>
  .icon-btn.more-button { flex-shrink: 0; width: 32px; height: 32px; }
  .more-button[aria-expanded='true'] { background: var(--glass-dark); color: var(--text); }
  @media (pointer: coarse) {
    .icon-btn.more-button { width: 40px; height: 40px; }
  }
</style>
