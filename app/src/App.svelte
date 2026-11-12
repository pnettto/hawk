<script lang="ts">
  import { onMount, onDestroy, type Component } from 'svelte'
  import { get } from 'svelte/store'
  import { notesStore } from './stores/notes'
  import { authStore } from './stores/auth'
  import { appStore } from './stores/app'
  import { logsStore } from './stores/logs'
  import { preferencesStore } from './stores/preferences'
  import { pomodoroStore } from './stores/pomodoro'
  import { syncStore } from './stores/sync'
  import { formatDate } from './utils/date'
  import { hasUnsavedWork } from './stores/saving'
  import Auth from './lib/auth/Auth.svelte'
  import Toast from './lib/ui/Toast.svelte'
  import ZenMode from './lib/ui/ZenMode.svelte'
  import PomodoroWidget from './lib/daily/PomodoroWidget.svelte'
  import SavingIndicator from './lib/ui/SavingIndicator.svelte'
  import AboutDialog from './lib/ui/AboutDialog.svelte'
  import ConfirmDialog from './lib/ui/ConfirmDialog.svelte'

  let aboutOpen = $state(false)

  // Routes are lazy-loaded so Tiptap (~150KB gz) doesn't block initial paint.
  // Resolved modules are cached, and the route only changes when the page
  // string does — not on every appStore change (date, tab), which used to
  // remount the whole page.
  const routeLoaders = {
    app: () => import('./routes/Journal.svelte'),
    notes: () => import('./routes/Notes.svelte'),
    files: () => import('./routes/Files.svelte'),
    extensions: () => import('./routes/Extensions.svelte'),
    admin: () => import('./routes/Admin.svelte'),
  } as const
  type PageId = keyof typeof routeLoaders
  const routeCache: Partial<Record<PageId, Component>> = {}
  let page = $derived($appStore.currentPage as PageId)
  let Route = $state<Component | null>(null)
  let routeError = $state<string | null>(null)
  $effect(() => {
    const p = page
    routeError = null
    if (routeCache[p]) {
      Route = routeCache[p]!
      return
    }
    routeLoaders[p]()
      .then((m) => {
        routeCache[p] = m.default as Component
        if (page === p) Route = routeCache[p]!
      })
      .catch((e: Error) => (routeError = e.message))
  })

  onMount(() => {
    authStore.checkSession()
    // Warm the initial route's chunk while the session check runs.
    void routeLoaders[get(appStore).currentPage as PageId]()
  })

  // Page hidden or closing: write drafts and fire keepalive saves everywhere.
  $effect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        notesStore.flushOnHide()
        logsStore.flushOnHide()
      }
    }
    const onPageHide = () => {
      notesStore.flushOnHide()
      logsStore.flushOnHide()
    }
    document.addEventListener('visibilitychange', onHide)
    globalThis.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      globalThis.removeEventListener('pagehide', onPageHide)
    }
  })

  // When authenticated, load the selected day (and prefetch neighbours).
  $effect(() => {
    if (!$authStore.isAuth) return
    const dateStr = formatDate($appStore.selectedDate)
    logsStore.loadForDate(dateStr)
    logsStore.prefetchSurrounding($appStore.selectedDate)
  })

  // Pull saved theme/preferences once per auth so the choice follows the user
  // across devices. localStorage already gave us a fast first paint.
  let prefsLoadedFor = $state(false)
  $effect(() => {
    if (!$authStore.isAuth || $authStore.isGuest) return
    if (prefsLoadedFor) return
    prefsLoadedFor = true
    // Load extensions before the shared timer, so the widget starts with the
    // right settings instead of the defaults.
    void preferencesStore.loadFromServer().then(() => pomodoroStore.loadFromServer())
  })

  // Open the cross-device sync stream once authenticated. Guest mode skips
  // it (no token to authenticate with).
  $effect(() => {
    if (!$authStore.isAuth || $authStore.isGuest) return
    syncStore.start()
    return () => syncStore.stop()
  })

  // Refresh today on window focus, mirroring the legacy behaviour.
  let onFocus: (() => void) | null = null
  let onVisible: (() => void) | null = null
  $effect(() => {
    if (!$authStore.isAuth) return
    onFocus = () => {
      // Safe while typing: sessions ignore anything not newer than theirs.
      const dateStr = formatDate(get(appStore).selectedDate)
      logsStore.loadForDate(dateStr, true)
      void pomodoroStore.loadFromServer()
    }
    // A hidden/suspended tab may have missed live events; catch up on the
    // shared timer as soon as it is looked at again.
    onVisible = () => {
      if (document.visibilityState === 'visible') void pomodoroStore.loadFromServer()
    }
    globalThis.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (onFocus) globalThis.removeEventListener('focus', onFocus)
      if (onVisible) document.removeEventListener('visibilitychange', onVisible)
    }
  })

  onDestroy(() => {
    if (onFocus) globalThis.removeEventListener('focus', onFocus)
    if (onVisible) document.removeEventListener('visibilitychange', onVisible)
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
    <span class="logo-pulse" aria-hidden="true"></span>
  </div>
{:else if !$authStore.isAuth}
  <Auth />
{:else}
  <div class="container" class:wide={$appStore.currentPage === 'notes'}>
    <nav>
      <button
        class="nav-logo-btn"
        type="button"
        onclick={() => (aboutOpen = true)}
        aria-label="About Hawk"
        title="About Hawk"
      >
        <span class="nav-logo" aria-hidden="true"></span>
      </button>
      <button
        class:active={$appStore.currentPage === 'app'}
        onclick={() => appStore.setCurrentPage('app')}>Journal</button
      >
      <button
        class:active={$appStore.currentPage === 'notes'}
        onclick={() => appStore.setCurrentPage('notes')}>Notepad</button
      >
      {#if !$authStore.isGuest}
        <button
          class:active={$appStore.currentPage === 'files'}
          onclick={() => appStore.setCurrentPage('files')}>Files</button
        >
      {/if}
      <button
        class:active={$appStore.currentPage === 'extensions'}
        onclick={() => appStore.setCurrentPage('extensions')}>Extensions</button
      >
      <span class="nav-spacer"></span>
      <SavingIndicator />
      <button
        class="nav-icon"
        class:active={$appStore.currentPage === 'admin'}
        onclick={() => appStore.setCurrentPage('admin')}
        aria-label="Settings"
        title="Settings"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="2.2"/>
          <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4"/>
        </svg>
      </button>
      {#if $authStore.isGuest}
        <button class="nav-logout" onclick={() => authStore.logout()} aria-label="Exit demo" title="Exit demo">
          <span class="logout-label">Exit demo</span>
          <svg class="logout-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6.5 13.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.5M10.5 11l3-3-3-3M13.5 8H6.5" />
          </svg>
        </button>
      {:else}
        <button class="nav-logout" onclick={() => authStore.logout()} aria-label="Log out" title="Log out">
          <span class="logout-label">Logout</span>
          <svg class="logout-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6.5 13.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.5M10.5 11l3-3-3-3M13.5 8H6.5" />
          </svg>
        </button>
      {/if}
    </nav>

    {#key page}
      <main class="page-content">
        {#if routeError}
          <div class="route-error">Failed to load page: {routeError}</div>
        {:else if Route && routeCache[page] === Route}
          <Route />
        {:else}
          <div class="route-loading"></div>
        {/if}
      </main>
    {/key}
  </div>
  <ZenMode />
  <PomodoroWidget />
{/if}

<Toast />
<ConfirmDialog />

{#if aboutOpen}
  <AboutDialog onClose={() => (aboutOpen = false)} />
{/if}

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
    padding: 2rem 1rem 0;
    height: 100vh;
    height: 100dvh;
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
    .container.wide { padding: 1rem 0.5rem 0; }
    nav { margin-bottom: 1rem; }
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
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 2rem;
    font-family: var(--font-ui, inherit);
  }
  .nav-logo-btn {
    background: none;
    border: 0;
    padding: 0;
    margin-right: 0.7rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 999px;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .nav-logo-btn:hover .nav-logo { opacity: 1; }
  .nav-logo {
    display: inline-block;
    width: 1.6rem;
    height: 1.6rem;
    opacity: 0.8;
    flex-shrink: 0;
    background-color: var(--logo-color);
    -webkit-mask: url(/logo.svg) center / contain no-repeat;
            mask: url(/logo.svg) center / contain no-repeat;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  @media (max-width: 600px) {
    nav {
      gap: 0.25rem;
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
    font-size: 0.78rem;
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  nav button:hover {
    color: var(--text);
    background: var(--glass-dark);
  }
  nav button.active {
    color: var(--accent);
    background: var(--glass);
  }
  .nav-spacer { flex: 1; }
  .nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.45rem;
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 999px;
  }
  .nav-icon svg { width: 14px; height: 14px; display: block; }
  .nav-icon.active { color: var(--accent); background: var(--glass); }
  @media (pointer: coarse) {
    nav button { min-height: 40px; }
    .nav-icon { width: 40px; height: 40px; }
  }
  .nav-logout:hover { color: var(--danger); background: var(--danger-bg); }
  .logout-icon { display: none; width: 14px; height: 14px; }
  @media (max-width: 600px) {
    nav button { padding: 0.45rem 0.7rem; }
    .logout-label { display: none; }
    .logout-icon { display: block; }
    .nav-logout { padding: 0.45rem; }
  }
  .route-loading { min-height: 50vh; }
  .route-error { padding: 2rem; color: var(--danger); text-align: center; }
  .boot-screen {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    z-index: var(--z-boot);
  }
  .logo-pulse {
    display: inline-block;
    width: 2.4rem;
    height: 2.4rem;
    opacity: 0.8;
    animation: bootPulse 1.4s ease-in-out infinite;
    background-color: var(--logo-color);
    -webkit-mask: url(/logo.svg) center / contain no-repeat;
            mask: url(/logo.svg) center / contain no-repeat;
  }
  @keyframes bootPulse {
    0%, 100% { opacity: 0.4; transform: scale(0.96); }
    50% { opacity: 1; transform: scale(1.04); }
  }
</style>
