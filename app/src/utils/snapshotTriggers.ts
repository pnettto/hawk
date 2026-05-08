// Wires the three "settle" events that should mark a version-history
// checkpoint: editor blur, tab/visibility hide, and page unload.
//
// Use from a Svelte component:
//   const teardown = bindSnapshotTriggers(rootEl, () => store.triggerSnapshot(id))
//   onDestroy(teardown)

interface Options {
  // True when the entity has unsaved or recently-saved edits worth checkpointing.
  // Skipped triggers don't fire — keeps idle blurs from generating noise.
  hasContent?: () => boolean
}

export function bindSnapshotTriggers(
  el: HTMLElement,
  fire: () => void,
  opts: Options = {},
): () => void {
  const shouldFire = () => (opts.hasContent ? opts.hasContent() : true)

  // focusout bubbles. We only fire when focus genuinely leaves `el` — i.e.,
  // the new focus target is outside the editor block. Tabbing between the
  // title input and the rich editor inside `el` shouldn't trigger.
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null
    if (next && el.contains(next)) return
    if (!shouldFire()) return
    fire()
  }

  function onVisibility() {
    if (document.visibilityState !== 'hidden') return
    if (!shouldFire()) return
    fire()
  }

  function onBeforeUnload() {
    if (!shouldFire()) return
    // sendBeacon would be more reliable, but the snapshot here piggybacks on
    // the regular save endpoint and we don't have a stable body to ship.
    // Calling fire() synchronously gives the in-flight fetch a fighting
    // chance to land before the page tears down.
    fire()
  }

  // Paste is a discrete edit event that often dumps a lot of content at once
  // — exactly the kind of moment users want a checkpoint for. Defer slightly
  // so the editor has applied the pasted content before we snapshot.
  function onPaste() {
    if (!shouldFire()) return
    setTimeout(() => fire(), 50)
  }

  el.addEventListener('focusout', onFocusOut)
  el.addEventListener('paste', onPaste, true)
  document.addEventListener('visibilitychange', onVisibility)
  globalThis.addEventListener('beforeunload', onBeforeUnload)

  return () => {
    el.removeEventListener('focusout', onFocusOut)
    el.removeEventListener('paste', onPaste, true)
    document.removeEventListener('visibilitychange', onVisibility)
    globalThis.removeEventListener('beforeunload', onBeforeUnload)
  }
}
