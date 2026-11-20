// Where the route lives in the URL. The web app uses real paths (the Worker
// and Vite fall back to index.html); the Chrome extension has no fallback, so
// it keeps the same paths after a `#`.

const isExtension = () => location.protocol === 'chrome-extension:'

// The route part of the current URL: "/notes/abc?x=1".
export function read(): string {
  if (isExtension()) {
    const h = location.hash.replace(/^#/, '')
    return h.startsWith('/') ? h : '/'
  }
  return `${location.pathname}${location.search}`
}

function href(url: string): string {
  return isExtension() ? `${location.pathname}${location.search}#${url}` : url
}

export function push(url: string, state: unknown = null): void {
  history.pushState(state, '', href(url))
}

export function replace(url: string, state: unknown = history.state): void {
  history.replaceState(state, '', href(url))
}

export function state(): unknown {
  return history.state
}

// Back/forward, and a hash typed by hand in the extension.
export function onChange(cb: () => void): () => void {
  globalThis.addEventListener('popstate', cb)
  globalThis.addEventListener('hashchange', cb)
  return () => {
    globalThis.removeEventListener('popstate', cb)
    globalThis.removeEventListener('hashchange', cb)
  }
}
