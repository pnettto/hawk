<script lang="ts">
  import { onMount } from 'svelte'

  // Single rule: auto-show at off-hours, dismiss on click. There is no other
  // path to visibility — date navigation, store updates, parent re-renders,
  // and HMR cannot flip the overlay on.
  const APPROPRIATE = (() => {
    const h = new Date().getHours()
    return h >= 18 || h < 8
  })()

  // Persist dismissal for the tab session so reloading after dismissing
  // doesn't bring it back during the same evening.
  const DISMISS_KEY = 'hawk:zen-dismissed'
  function readDismissed(): boolean {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  }
  function writeDismissed() {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  let quoteLines = $state<string[]>([])
  let quote = $state<[string, string] | null>(null)
  let dismissed = $state(readDismissed())

  function pickQuote() {
    if (!quoteLines.length) {
      quote = null
      return
    }
    const line = quoteLines[Math.floor(Math.random() * quoteLines.length)]
    const parts = line.split('|')
    quote = [parts[0] ?? '', parts[1] ?? '']
  }

  onMount(async () => {
    if (!APPROPRIATE || dismissed) return
    try {
      const res = await fetch('/data/quotes.csv')
      const text = await res.text()
      quoteLines = text.split(/\r?\n/).filter((l) => l.trim())
      pickQuote()
    } catch (e) {
      console.error('Failed to load quotes:', e)
    }
  })

  let isVisible = $derived(APPROPRIATE && !dismissed)

  function leave() {
    dismissed = true
    writeDismissed()
  }
</script>

{#if isVisible}
  <button
    type="button"
    class="zen-mode"
    onclick={leave}
    aria-label="Exit zen mode"
  >
    <div class="quote-wrapper">
      {#if quote}
        <div class="quote">{quote[0]}</div>
        <div class="author">{quote[1]}</div>
      {/if}
    </div>
  </button>
{/if}

<style>
  .zen-mode {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg);
    z-index: 1000;
    border: 0;
  }
  .quote-wrapper {
    position: absolute;
    right: 2rem;
    bottom: 2rem;
    text-align: right;
    width: 20rem;
  }
  .quote {
    font-size: 0.8rem;
    color: var(--glass);
    margin-bottom: 0.5rem;
  }
  .author {
    font-size: 0.7rem;
    color: var(--glass);
  }
</style>
