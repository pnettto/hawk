<script lang="ts">
  interface Props {
    onClose: () => void
  }
  let { onClose }: Props = $props()

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  // Focus moves into the dialog, Tab stays inside it, and focus returns to
  // whatever opened it on close. Page scroll is locked meanwhile.
  let dialogEl = $state<HTMLDivElement | null>(null)
  $effect(() => {
    const opener = document.activeElement as HTMLElement | null
    dialogEl?.querySelector<HTMLElement>('.btn-secondary')?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  })

  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !dialogEl) return
    const items = dialogEl.querySelectorAll<HTMLElement>('a[href], button')
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() {
        if (node.parentNode === document.body) document.body.removeChild(node)
      },
    }
  }
</script>

<div
  class="about-backdrop"
  use:portal
  onclick={onBackdropClick}
  role="presentation"
>
  <div
    class="about-dialog"
    bind:this={dialogEl}
    onkeydown={trapTab}
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-title"
  >
    <div class="header">
      <span class="logo" aria-hidden="true"></span>
      <h2 id="about-title">Hawk</h2>
    </div>

    <p class="tagline">Hawk is a daily journal that keeps you organized in one place: your new tabs.</p>

    <ul class="highlights">
      <li><strong>Tasks</strong> — a simple list for each day, with optional times and comments.</li>
      <li><strong>Day notes</strong> — as many free-form notes per day as you like, also kept in Notepad.</li>
      <li><strong>Notepad</strong> — markdown notes organized with #tags, shared publicly, restored from history.</li>
      <li><strong>Files</strong> — drop anything here and grab it from any device.</li>
      <li><strong>Cross-device sync</strong> — live updates across tabs and devices (premium).</li>
    </ul>

    <div class="footer">
      <span class="credit">
        Made by <a href="https://pnetto.com" target="_blank" rel="noopener noreferrer">Pedro Netto</a>
      </span>
      <button class="btn-secondary" type="button" onclick={onClose}>Close</button>
    </div>
  </div>
</div>

<style>
  .about-backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    backdrop-filter: blur(4px);
    animation: fadeIn var(--dur-base) var(--ease-out);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-overlay);
    padding: 1rem;
    animation: fadeIn var(--dur-base) var(--ease-out);
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .about-dialog {
    background: var(--panel, #2f343d);
    border: 1px solid var(--line, #3a3f47);
    border-radius: 10px;
    padding: 1.5rem;
    width: min(440px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    font-family: var(--font-ui, inherit);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .logo {
    display: inline-block;
    width: 2rem;
    height: 2rem;
    opacity: 0.85;
    background-color: var(--logo-color);
    -webkit-mask: url(/logo.svg) center / contain no-repeat;
            mask: url(/logo.svg) center / contain no-repeat;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text);
  }
  .tagline {
    margin: 0 0 1rem;
    color: var(--muted);
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .highlights {
    list-style: none;
    margin: 0 0 1.25rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .highlights li {
    font-size: 0.85rem;
    color: var(--text);
    line-height: 1.5;
    padding-left: 0.85rem;
    position: relative;
  }
  .highlights li::before {
    content: '·';
    position: absolute;
    left: 0;
    color: var(--accent);
    font-weight: bold;
  }
  .highlights strong {
    color: var(--text);
    font-weight: 600;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
  }
  .credit {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .credit a {
    color: var(--accent);
    text-decoration: none;
  }
  .credit a:hover {
    text-decoration: underline;
  }
  .btn-secondary {
    background: none;
    border: 1px solid var(--line);
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.75rem;
  }
  .btn-secondary:hover {
    background: var(--glass-dark);
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .about-dialog {
    animation: popIn var(--dur-base) var(--ease-spring);
    box-shadow: var(--shadow-pop);
  }
  .about-dialog:focus { outline: none; }
</style>
