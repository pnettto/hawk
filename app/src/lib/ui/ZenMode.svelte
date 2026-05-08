<script lang="ts">
  import { onMount } from 'svelte'
  import { appStore } from '../../stores/app'
  import { formatDate } from '../../utils/date'

  let quoteLines = $state<string[]>([])
  let quote = $state<[string, string] | null>(null)
  let forceShow = $state(false)
  let dismissed = $state(false)

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
    try {
      const res = await fetch('/data/quotes.csv')
      const text = await res.text()
      quoteLines = text.split(/\r?\n/).filter((l) => l.trim())
      pickQuote()
    } catch (e) {
      console.error('Failed to load quotes:', e)
    }
  })

  let shouldHideByTime = $derived.by(() => {
    const date = $appStore.selectedDate
    const todayStr = formatDate(new Date())
    const isToday = todayStr === formatDate(date)
    const h = date.getHours()
    return isToday && h >= 8 && h <= 18
  })

  let hiddenByDefault = $derived.by(() => {
    const h = new Date().getHours()
    return !(h >= 18 || h < 8)
  })

  let isVisible = $derived(!dismissed && !hiddenByDefault && (!shouldHideByTime || forceShow))

  function leave() {
    dismissed = true
    forceShow = false
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
