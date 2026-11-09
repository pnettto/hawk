<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { safeFlip } from '../utils/safeFlip'
  import { fade, scale } from 'svelte/transition'
  import { filesStore } from '../stores/files'
  import type { FileMeta } from '../types/models'

  let query = $state('')
  let fileInput = $state<HTMLInputElement | null>(null)
  let dragDepth = $state(0)
  let renaming = $state<string | null>(null)
  let renameValue = $state('')
  let preview = $state<{ file: FileMeta; url: string | null; text?: string } | null>(null)

  // ---- sorting / grouping ----------------------------------------------

  type Sort = 'day' | 'added' | 'size'
  const SORT_KEY = 'hawk_files_sort'
  let sort = $state<Sort>(readSort())
  function readSort(): Sort {
    try {
      const v = localStorage.getItem(SORT_KEY)
      if (v === 'day' || v === 'added' || v === 'size') return v
    } catch {
      /* ignore */
    }
    return 'day'
  }
  function setSort(v: Sort) {
    sort = v
    try {
      localStorage.setItem(SORT_KEY, v)
    } catch {
      /* ignore */
    }
  }

  let files = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const all = $filesStore.files
    const list = q ? all.filter((f) => f.name.toLowerCase().includes(q)) : [...all]
    return sort === 'size'
      ? list.sort((a, b) => b.size - a.size || b.createdAt - a.createdAt)
      : list.sort((a, b) => b.createdAt - a.createdAt)
  })

  function dayTitle(ms: number): string {
    const d = new Date(ms)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    })
  }

  // 'day' groups under date headings; the other sorts are one flat group.
  let groups = $derived.by(() => {
    if (sort !== 'day') return [{ key: sort, title: '', items: files }]
    const out: { key: string; title: string; items: FileMeta[] }[] = []
    for (const f of files) {
      const key = new Date(f.createdAt).toDateString()
      const last = out[out.length - 1]
      if (last?.key === key) last.items.push(f)
      else out.push({ key, title: dayTitle(f.createdAt), items: [f] })
    }
    return out
  })
  let totalBytes = $derived($filesStore.files.reduce((n, f) => n + f.size, 0))

  // ---- selection -------------------------------------------------------

  let selected = $state(new Set<string>())
  let lastToggled: string | null = null
  // Drop ids that no longer exist (deleted here or on another device).
  $effect(() => {
    const ids = new Set($filesStore.files.map((f) => f.id))
    if ([...selected].some((id) => !ids.has(id))) {
      selected = new Set([...selected].filter((id) => ids.has(id)))
    }
  })
  let selectedFiles = $derived(files.filter((f) => selected.has(f.id)))
  let allVisibleSelected = $derived(files.length > 0 && files.every((f) => selected.has(f.id)))

  // Shift-click selects the range from the last toggled row.
  function toggle(f: FileMeta, e?: MouseEvent) {
    const next = new Set(selected)
    if (e?.shiftKey && lastToggled) {
      const a = files.findIndex((x) => x.id === lastToggled)
      const b = files.findIndex((x) => x.id === f.id)
      if (a > -1 && b > -1) {
        const on = !selected.has(f.id)
        for (const x of files.slice(Math.min(a, b), Math.max(a, b) + 1)) {
          if (on) next.add(x.id)
          else next.delete(x.id)
        }
        selected = next
        lastToggled = f.id
        return
      }
    }
    if (next.has(f.id)) next.delete(f.id)
    else next.add(f.id)
    selected = next
    lastToggled = f.id
  }

  function toggleAll() {
    selected = allVisibleSelected ? new Set() : new Set(files.map((f) => f.id))
  }

  // Day heading checkbox: select (or deselect) every file of that day.
  function toggleGroup(items: FileMeta[]) {
    const next = new Set(selected)
    const all = items.every((f) => next.has(f.id))
    for (const f of items) {
      if (all) next.delete(f.id)
      else next.add(f.id)
    }
    selected = next
  }

  async function deleteSelected() {
    if (await filesStore.remove([...selected])) selected = new Set()
  }

  onMount(() => {
    void filesStore.load()
  })

  // ---- formatting ------------------------------------------------------

  function fmtSize(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
    return `${(n / 1024 / 1024).toFixed(1)} MB`
  }

  function fmtDate(ms: number): string {
    const d = new Date(ms)
    const sameYear = d.getFullYear() === new Date().getFullYear()
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
  }

  type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive' | 'other'
  function kindOf(f: FileMeta): Kind {
    const t = f.type
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (t.startsWith('image/')) return 'image'
    if (t.startsWith('video/')) return 'video'
    if (t.startsWith('audio/')) return 'audio'
    if (t === 'application/pdf' || ext === 'pdf') return 'pdf'
    if (t.startsWith('text/') || t === 'application/json' || ['md', 'txt', 'csv', 'json', 'log', 'yml', 'yaml', 'ts', 'js'].includes(ext)) return 'text'
    if (/zip|tar|gzip|rar|7z/.test(t) || ['zip', 'gz', 'tgz', 'rar', '7z'].includes(ext)) return 'archive'
    return 'other'
  }
  const previewable = (f: FileMeta) => kindOf(f) !== 'archive' && kindOf(f) !== 'other' && f.size < 20 * 1024 * 1024

  // ---- upload ----------------------------------------------------------

  function pick() {
    fileInput?.click()
  }

  function onPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) void filesStore.upload(Array.from(input.files))
    input.value = ''
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth++
  }
  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
  }
  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth = 0
    const list = Array.from(e.dataTransfer?.files ?? [])
    if (list.length) void filesStore.upload(list)
  }

  // Paste files (e.g. a screenshot) anywhere on the page, unless typing.
  function onPaste(e: ClipboardEvent) {
    const t = e.target as HTMLElement | null
    if (t?.closest('input, textarea, [contenteditable="true"]')) return
    const list = Array.from(e.clipboardData?.files ?? [])
    if (!list.length) return
    e.preventDefault()
    void filesStore.upload(list)
  }

  // ---- rename ----------------------------------------------------------

  async function startRename(f: FileMeta) {
    renaming = f.id
    renameValue = f.name
    await tick()
    const el = document.querySelector<HTMLInputElement>('.rename-input')
    if (!el) return
    el.focus()
    // Select the base name, not the extension.
    const dot = f.name.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : f.name.length)
  }

  function commitRename() {
    if (!renaming) return
    const id = renaming
    renaming = null
    void filesStore.rename(id, renameValue)
  }

  // ---- open / preview --------------------------------------------------

  async function open(f: FileMeta) {
    if (!previewable(f)) {
      void filesStore.download(f)
      return
    }
    preview = { file: f, url: null }
    try {
      const url = await filesStore.blobUrl(f.id)
      if (preview?.file.id !== f.id) return
      if (kindOf(f) === 'text') {
        const text = await (await fetch(url)).text()
        preview = { file: f, url, text: text.length > 200_000 ? text.slice(0, 200_000) + '\n…' : text }
      } else {
        preview = { file: f, url }
      }
    } catch {
      preview = null
    }
  }

  function onWindowKey(e: KeyboardEvent) {
    // Already handled by a dialog/popover (e.g. Escape closing the confirm).
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      if (preview) preview = null
      else if (selected.size) selected = new Set()
      return
    }
    // Cmd/Ctrl+A selects all files when not typing.
    const t = e.target as HTMLElement | null
    if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !t?.closest('input, textarea, [contenteditable="true"]')) {
      if (!files.length || preview) return
      e.preventDefault()
      selected = new Set(files.map((f) => f.id))
    }
  }

  // Thumbnails load as rows scroll into view.
  function thumb(node: HTMLImageElement, id: string) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting)) return
      io.disconnect()
      filesStore
        .blobUrl(id)
        .then((u) => {
          node.onload = () => node.classList.add('loaded')
          node.src = u
        })
        .catch(() => {})
    }, { rootMargin: '200px' })
    io.observe(node)
    return { destroy: () => io.disconnect() }
  }
</script>

<svelte:window
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  onpaste={onPaste}
  onkeydown={onWindowKey}
/>

{#snippet checkMark(on: boolean, mixed: boolean)}
  <span class="box" class:on class:mixed aria-hidden="true">
    {#if on}
      <svg viewBox="0 0 16 16"><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    {:else if mixed}
      <svg viewBox="0 0 16 16"><path d="M4.5 8h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    {/if}
  </span>
{/snippet}

{#snippet icon(kind: Kind)}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if kind === 'video'}
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M7 6.2v3.6L10 8z" />
    {:else if kind === 'audio'}
      <path d="M6 11.5V4l7-1.5v7.5" /><circle cx="4.5" cy="11.5" r="1.5" /><circle cx="11.5" cy="10" r="1.5" />
    {:else if kind === 'archive'}
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M8 2.5v2M8 6v1.5M7 9h2v2H7z" />
    {:else}
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z" /><path d="M9 2v4h4" />
      {#if kind === 'text' || kind === 'pdf'}<path d="M5.5 9h5M5.5 11h3" />{/if}
    {/if}
  </svg>
{/snippet}

<section class="files">
  <header class="head">
    <div class="title">
      <h1>Files</h1>
      {#if $filesStore.files.length}
        <span class="meta">{$filesStore.files.length} · {fmtSize(totalBytes)}</span>
      {/if}
    </div>
    <div class="head-actions">
      {#if $filesStore.files.length > 6}
        <input class="search" type="search" placeholder="Search" aria-label="Search files" bind:value={query} />
      {/if}
      <button type="button" class="btn-primary" onclick={pick}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="13" height="13">
          <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" />
        </svg>
        Upload
      </button>
      <input bind:this={fileInput} type="file" multiple hidden onchange={onPicked} />
    </div>
  </header>

  {#if $filesStore.uploads.length}
    <ul class="uploads" aria-label="Uploads">
      {#each $filesStore.uploads as u (u.key)}
        <li class="upload" class:failed={!!u.error} transition:fade={{ duration: 140 }}>
          <span class="upload-name">{u.name}</span>
          {#if u.error}
            <span class="upload-error">{u.error}</span>
          {:else}
            <span class="bar"><span style:transform={`scaleX(${u.progress})`}></span></span>
            <span class="pct">{Math.round(u.progress * 100)}%</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if !$filesStore.loaded}
    <div class="list" aria-busy="true">
      {#each [0, 1, 2] as i (i)}
        <div class="row skeleton-row"><span class="skeleton-line" style:width={`${50 + i * 12}%`}></span></div>
      {/each}
    </div>
  {:else if !$filesStore.files.length}
    <button type="button" class="dropzone" onclick={pick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M4 19h16" />
      </svg>
      <span class="dz-head">Drop files here</span>
      <span class="dz-sub">or click to choose · paste works too · up to 100 MB each</span>
    </button>
  {:else}
    <div class="toolbar" class:selecting={selected.size > 0}>
      <button
        type="button"
        class="check all"
        role="checkbox"
        aria-checked={allVisibleSelected ? 'true' : selected.size ? 'mixed' : 'false'}
        aria-label={allVisibleSelected ? 'Deselect all' : 'Select all'}
        title={allVisibleSelected ? 'Deselect all' : 'Select all'}
        onclick={toggleAll}
        disabled={!files.length}
      >
        {@render checkMark(allVisibleSelected, selected.size > 0 && !allVisibleSelected)}
      </button>
      {#if selected.size}
        <span class="sel-count" in:fade={{ duration: 120 }}>{selected.size} selected</span>
        <div class="sel-actions" in:fade={{ duration: 120 }}>
          <button type="button" class="btn-secondary" onclick={() => filesStore.downloadMany(selectedFiles)}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v8M4.5 7.5L8 11l3.5-3.5M3 13h10" /></svg>
            Download
          </button>
          <button type="button" class="btn-secondary danger" onclick={deleteSelected}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
            Delete
          </button>
          <button type="button" class="icon-btn ghost" aria-label="Clear selection" title="Clear selection (Esc)" onclick={() => (selected = new Set())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
          </button>
        </div>
      {:else}
        <div class="segmented" role="radiogroup" aria-label="Sort by" in:fade={{ duration: 120 }}>
          {#each [['day', 'By day'], ['added', 'Recently added'], ['size', 'Largest']] as [id, label] (id)}
            <button type="button" role="radio" aria-checked={sort === id} onclick={() => setSort(id as Sort)}>{label}</button>
          {/each}
        </div>
      {/if}
    </div>

    {#if !files.length}
      <div class="empty">No files match “{query}”.</div>
    {/if}
    {#each groups as group (group.key)}
      {#if group.title}
        {@const groupAll = group.items.every((f) => selected.has(f.id))}
        {@const groupSome = !groupAll && group.items.some((f) => selected.has(f.id))}
        <h2 class="group-title" class:has-selection={groupAll || groupSome}>
          <button
            type="button"
            class="check"
            role="checkbox"
            aria-checked={groupAll ? 'true' : groupSome ? 'mixed' : 'false'}
            aria-label="{groupAll ? 'Deselect' : 'Select'} all files from {group.title}"
            title="{groupAll ? 'Deselect' : 'Select'} this day"
            onclick={() => toggleGroup(group.items)}
          >
            {@render checkMark(groupAll, groupSome)}
          </button>
          <span>{group.title}</span>
          <span class="group-meta">{group.items.length} · {fmtSize(group.items.reduce((n, f) => n + f.size, 0))}</span>
        </h2>
      {/if}
    <ul class="list">
      {#each group.items as f (f.id)}
        {@const kind = kindOf(f)}
        <li class="row" class:selected={selected.has(f.id)} animate:safeFlip={{ duration: 180 }} transition:fade={{ duration: 140 }}>
          <button
            type="button"
            class="check"
            role="checkbox"
            aria-checked={selected.has(f.id)}
            aria-label="Select {f.name}"
            onclick={(e) => toggle(f, e)}
          >
            {@render checkMark(selected.has(f.id), false)}
          </button>
          <button
            type="button"
            class="open"
            onclick={() => open(f)}
            title={previewable(f) ? 'Preview' : 'Download'}
            aria-label="{previewable(f) ? 'Preview' : 'Download'} {f.name}"
          >
            <span class="thumb" class:image={kind === 'image'}>
              {#if kind === 'image'}
                <img alt="" use:thumb={f.id} />
              {:else}
                {@render icon(kind)}
              {/if}
            </span>
          </button>
          <div class="info">
            {#if renaming === f.id}
              <input
                class="rename-input"
                bind:value={renameValue}
                aria-label="File name"
                onblur={commitRename}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') renaming = null
                }}
              />
            {:else}
              <button type="button" class="name" onclick={() => open(f)}>{f.name}</button>
            {/if}
            <span class="sub">
              {fmtSize(f.size)} · {fmtDate(f.createdAt)}{#if f.inline}<span class="tag">in a note</span>{/if}
            </span>
          </div>
          <div class="actions">
            <button type="button" class="icon-btn ghost" title="Download" aria-label="Download {f.name}" onclick={() => filesStore.download(f)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8 3v8M4.5 7.5L8 11l3.5-3.5M3 13h10" />
              </svg>
            </button>
            <button type="button" class="icon-btn ghost" title="Rename" aria-label="Rename {f.name}" onclick={() => startRename(f)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
              </svg>
            </button>
            <button type="button" class="icon-btn ghost danger" title="Delete" aria-label="Delete {f.name}" onclick={() => filesStore.remove([f.id])}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
              </svg>
            </button>
          </div>
        </li>
      {/each}
    </ul>
    {/each}
  {/if}
</section>

{#if dragDepth > 0}
  <div class="drop-overlay" transition:fade={{ duration: 120 }}>
    <div class="drop-card">Drop to upload</div>
  </div>
{/if}

{#if preview}
  <div class="lightbox" role="dialog" aria-modal="true" aria-label={preview.file.name} transition:fade={{ duration: 150 }}>
    <button type="button" class="scrim" aria-label="Close preview" onclick={() => (preview = null)}></button>
    <div class="lb-card" transition:scale={{ start: 0.97, duration: 180 }}>
      <header class="lb-head">
        <span class="lb-name">{preview.file.name}</span>
        <button type="button" class="btn-secondary" onclick={() => preview && filesStore.download(preview.file)}>Download</button>
        <button type="button" class="icon-btn ghost" aria-label="Close" onclick={() => (preview = null)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
        </button>
      </header>
      <div class="lb-body">
        {#if !preview.url}
          <div class="lb-loading"><span class="skeleton-line" style:width="40%"></span></div>
        {:else if kindOf(preview.file) === 'image'}
          <img src={preview.url} alt={preview.file.name} />
        {:else if kindOf(preview.file) === 'video'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={preview.url} controls autoplay></video>
        {:else if kindOf(preview.file) === 'audio'}
          <audio src={preview.url} controls autoplay></audio>
        {:else if kindOf(preview.file) === 'pdf'}
          <iframe src={preview.url} title={preview.file.name}></iframe>
        {:else}
          <pre>{preview.text ?? ''}</pre>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .files { font-family: var(--font-ui); padding-bottom: 3rem; }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--line);
  }
  .title { display: flex; align-items: baseline; gap: 0.75rem; }
  h1 { margin: 0; font-family: var(--font-content); font-size: 1.5rem; font-weight: 700; }
  .meta { font-size: 0.75rem; color: var(--muted); opacity: 0.75; font-variant-numeric: tabular-nums; }
  .head-actions { display: flex; align-items: center; gap: 0.5rem; }
  .search {
    height: var(--h-md);
    width: 11rem;
    padding: 0 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--input-bg);
    color: var(--text);
    font: inherit;
    font-size: 0.8125rem;
  }
  .search:focus { border-color: var(--accent); }

  .uploads { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .upload {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--r-md);
    background: var(--glass-dark);
    font-size: 0.8125rem;
  }
  .upload-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { width: 8rem; height: 4px; border-radius: 2px; background: var(--glass); overflow: hidden; }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transform-origin: left;
    transition: transform var(--dur-base) var(--ease-out);
  }
  .pct { width: 2.5rem; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.75rem; }
  .upload.failed { background: var(--danger-bg); }
  .upload-error { color: var(--danger); font-size: 0.75rem; }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 34px;
    margin-bottom: 0.75rem;
    padding-left: 0.5rem;
  }
  .sel-count { font-size: 0.8125rem; color: var(--text); font-variant-numeric: tabular-nums; }
  .sel-actions { display: flex; align-items: center; gap: 0.4rem; margin-left: auto; }
  .btn-secondary.danger:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
  .segmented {
    display: inline-flex;
    padding: 2px;
    border-radius: var(--r-pill);
    background: var(--glass-dark);
  }
  .segmented button {
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.75rem;
    padding: 0.3rem 0.8rem;
    border-radius: var(--r-pill);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .segmented button:hover { color: var(--text); }
  .segmented button[aria-checked='true'] { color: var(--accent); background: var(--glass); }

  .group-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 1.25rem 0 0.35rem;
    padding-left: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .group-title:first-of-type { margin-top: 0.25rem; }
  .group-meta { opacity: 0.55; font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
  /* Day checkbox: same reveal rules as the row checkboxes. */
  .group-title .check { opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); }
  .group-title:hover .check,
  .group-title .check:focus-visible,
  .group-title.has-selection .check,
  .files:has(.toolbar.selecting) .group-title .check { opacity: 1; }
  @media (hover: none) { .group-title .check { opacity: 1; } }

  .check {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--r-xs);
  }
  .check:disabled { cursor: default; opacity: 0.4; }
  .box {
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    border: 1.5px solid color-mix(in srgb, var(--muted) 55%, transparent);
    color: var(--on-accent);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .box svg { width: 12px; height: 12px; }
  .check:hover .box { border-color: var(--accent); }
  .box.on,
  .box.mixed { background: var(--accent); border-color: var(--accent); }
  /* Row checkboxes stay out of the way until hovered or in selection mode. */
  .row .check { opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); }
  .row:hover .check,
  .row:focus-within .check,
  .row.selected .check,
  .files:has(.toolbar.selecting) .row .check { opacity: 1; }
  @media (hover: none) { .row .check { opacity: 1; } }
  .row.selected { background: color-mix(in srgb, var(--accent) 10%, transparent); }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.4rem 0.4rem 0.5rem;
    border-radius: var(--r-md);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .row:hover, .row:focus-within { background: var(--glass-dark); }
  .skeleton-row { height: 3.25rem; }
  .open { padding: 0; border: 0; background: none; cursor: pointer; border-radius: var(--r-sm); }
  .thumb {
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    background: var(--glass-dark);
    color: var(--muted);
    overflow: hidden;
  }
  .thumb svg { width: 18px; height: 18px; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity var(--dur-base) var(--ease-out); }
  .thumb :global(img.loaded) { opacity: 1; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
  .name {
    align-self: flex-start;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--r-xs);
  }
  .name:hover { color: var(--accent); }
  .rename-input {
    width: 100%;
    max-width: 28rem;
    height: 1.6rem;
    padding: 0 0.4rem;
    margin-left: -0.4rem;
    border: 1px solid var(--accent);
    border-radius: var(--r-xs);
    background: var(--input-bg-strong);
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
  }
  .sub { font-size: 0.75rem; color: var(--muted); opacity: 0.8; font-variant-numeric: tabular-nums; }
  .tag {
    margin-left: 0.5rem;
    padding: 0.05rem 0.4rem;
    border-radius: var(--r-pill);
    background: var(--glass-dark);
    font-size: 0.6875rem;
  }
  .actions { display: flex; gap: 0.15rem; opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); }
  .row:hover .actions, .row:focus-within .actions { opacity: 1; }
  @media (hover: none) { .actions { opacity: 1; } }

  .dropzone {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 3.5rem 1.5rem;
    border: 1.5px dashed var(--line);
    border-radius: var(--r-lg);
    background: none;
    color: var(--muted);
    font-family: inherit;
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .dropzone svg { width: 28px; height: 28px; margin-bottom: 0.25rem; }
  .dropzone:hover { border-color: var(--accent); background: var(--glass-dark); color: var(--text); }
  .dz-head { font-size: 0.95rem; }
  .dz-sub { font-size: 0.75rem; opacity: 0.7; }
  .empty { padding: 2rem; text-align: center; color: var(--muted); font-size: 0.875rem; }

  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--scrim);
    backdrop-filter: blur(3px);
    pointer-events: none;
  }
  .drop-card {
    padding: 2.5rem 3.5rem;
    border: 2px dashed var(--accent);
    border-radius: var(--r-lg);
    background: var(--panel);
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 1rem;
    box-shadow: var(--shadow-pop);
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .scrim { position: absolute; inset: 0; border: 0; padding: 0; background: var(--scrim); backdrop-filter: blur(4px); cursor: zoom-out; }
  .lb-card {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(1100px, 100%);
    max-height: 100%;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .lb-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem 0.5rem 1rem;
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
  }
  .lb-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.875rem; }
  .lb-body { min-height: 0; overflow: auto; display: flex; justify-content: center; background: var(--bg); }
  .lb-body img, .lb-body video { display: block; max-width: 100%; max-height: calc(100dvh - 6rem); object-fit: contain; }
  .lb-body audio { margin: 2rem; width: min(480px, 100%); }
  .lb-body iframe { width: 100%; height: calc(100dvh - 6rem); border: 0; background: #fff; }
  .lb-body pre {
    width: 100%;
    margin: 0;
    padding: 1rem 1.25rem;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  .lb-loading { width: 100%; padding: 3rem; }

  @media (max-width: 600px) {
    .sel-actions .btn-secondary { padding: 0 0.6rem; }
    .segmented button { padding: 0.3rem 0.6rem; }
    .search { width: 100%; }
    .head-actions { width: 100%; }
    .bar { width: 4rem; }
  }
</style>
