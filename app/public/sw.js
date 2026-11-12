// Service worker for Pomodoro notifications. It does no caching: the app talks
// to it only through `registration.showNotification()` so notification action
// buttons work (and so mobile browsers, which can't construct a Notification,
// still get them).

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Clicking the body opens the app. The "start" action tells the open tab to
// resume the parked timer without bringing it forward, so the notification
// works as a remote control. "Dismiss" just closes it.
self.addEventListener('notificationclick', (event) => {
  const action = event.action || 'open'
  event.notification.close()
  if (action === 'dismiss') return

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = windows.find((c) => c.url.startsWith(self.location.origin))

      if (client) {
        if (action === 'resume') {
          client.postMessage({ type: 'hawk-pomodoro', action })
          return
        }
        const focused = await client.focus()
        focused?.postMessage({ type: 'hawk-pomodoro', action })
        return
      }

      // No tab yet: open one. The query string tells the app to resume as it
      // boots, since a message to a freshly opened window can be missed.
      await self.clients.openWindow(action === 'open' ? '/' : '/?pomodoro=resume')
    })(),
  )
})
