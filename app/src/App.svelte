<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { authStore } from './stores/auth'
  import { appStore } from './stores/app'
  import { logsStore } from './stores/logs'
  import { formatDate } from './utils/date'
  import { hasUnsavedWork } from './stores/saving'
  import Auth from './lib/auth/Auth.svelte'
  import Toast from './lib/ui/Toast.svelte'
  import ZenMode from './lib/ui/ZenMode.svelte'
  import SavingIndicator from './lib/ui/SavingIndicator.svelte'

  // Routes are lazy-loaded so Tiptap (~150KB gz) doesn't block initial paint.
  const routeLoaders = {
    app: () => import('./routes/Journal.svelte'),
    notes: () => import('./routes/Notes.svelte'),
    report: () => import('./routes/Report.svelte'),
  } as const

  onMount(() => {
    authStore.checkSession()
  })

  // When authenticated, load the selected day (and prefetch neighbours).
  $effect(() => {
    if (!$authStore.isAuth) return
    const dateStr = formatDate($appStore.selectedDate)
    logsStore.loadForDate(dateStr)
    logsStore.prefetchSurrounding($appStore.selectedDate)
  })

  // Refresh today on window focus, mirroring the legacy behaviour.
  let onFocus: (() => void) | null = null
  $effect(() => {
    if (!$authStore.isAuth) return
    onFocus = () => {
      const dateStr = formatDate($appStore.selectedDate)
      logsStore.loadForDate(dateStr, true)
    }
    globalThis.addEventListener('focus', onFocus)
    return () => {
      if (onFocus) globalThis.removeEventListener('focus', onFocus)
    }
  })

  onDestroy(() => {
    if (onFocus) globalThis.removeEventListener('focus', onFocus)
  })

  // Block reload/close while there's any unsaved work — both in-flight saves
  // AND pending debounces (typed-but-not-yet-flushed). Browsers ignore the
  // custom string and show their own "Leave site?" dialog.
  $effect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!$hasUnsavedWork) return
      e.preventDefault()
      e.returnValue = 'Your work is still saving. Are you sure you want to leave?'
      return e.returnValue
    }
    globalThis.addEventListener('beforeunload', handler)
    return () => globalThis.removeEventListener('beforeunload', handler)
  })
</script>

{#if $authStore.isCheckingAuth}
  <div class="boot-screen">
    <img src="/logo.svg" class="logo-pulse" alt="" />
  </div>
{:else if !$authStore.isAuth}
  <Auth />
{:else}
  <div class="container" class:wide={$appStore.currentPage === 'notes'}>
    <nav>
      <button
        class:active={$appStore.currentPage === 'app'}
        onclick={() => appStore.setCurrentPage('app')}>Journal</button
      >
      <button
        class:active={$appStore.currentPage === 'report'}
        onclick={() => appStore.setCurrentPage('report')}>Report</button
      >
      <button
        class:active={$appStore.currentPage === 'notes'}
        onclick={() => appStore.setCurrentPage('notes')}>Notes</button
      >
      {#if !$authStore.isGuest}
        <button class="nav-logout" onclick={() => authStore.logout()}>Logout</button>
      {/if}
    </nav>

    <main class="page-content">
      {#await routeLoaders[$appStore.currentPage]()}
        <div class="route-loading"></div>
      {:then mod}
        {@const Route = mod.default}
        <Route />
      {:catch err}
        <div class="route-error">Failed to load page: {err.message}</div>
      {/await}
    </main>
  </div>
  <ZenMode />
{/if}

<SavingIndicator />
<Toast />

<style>
  .container {
    display: flex;
    flex-direction: column;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
    position: relative;
    padding: 2rem;
    box-sizing: border-box;
  }
  .container.wide {
    max-width: 1400px;
    padding: 1.5rem 1rem 0;
    height: 100vh;
    min-height: 0;
  }
  .container.wide .page-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 600px) {
    .container { padding: 1rem; }
    .container.wide { padding: 0.75rem 0.5rem 0; }
  }
  .page-content {
    animation: pageEnter var(--dur-base) var(--ease-out);
  }
  @keyframes pageEnter {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  nav {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  @media (max-width: 600px) {
    nav {
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.5rem;
      scrollbar-width: none;
    }
    nav::-webkit-scrollbar { display: none; }
  }
  nav button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0.5rem;
    white-space: nowrap;
  }
  nav button.active {
    color: var(--accent);
    font-weight: bold;
  }
  .nav-logout { margin-left: auto; }
  .route-loading { min-height: 50vh; }
  .route-error { padding: 2rem; color: #ff6b6b; text-align: center; }
  .boot-screen {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    z-index: 9999;
  }
  .logo-pulse {
    width: 2.4rem;
    opacity: 0.8;
    animation: bootPulse 1.4s ease-in-out infinite;
  }
  @keyframes bootPulse {
    0%, 100% { opacity: 0.4; transform: scale(0.96); }
    50% { opacity: 1; transform: scale(1.04); }
  }
</style>
