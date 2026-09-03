/* E1 Move service worker — push nudges */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { /* ignore */ }
  e.waitUntil(
    self.registration.showNotification(data.title || 'E1 Move', {
      body: data.body || 'Posture check.',
      tag: 'e1-nudge',
      renotify: true,
      vibrate: [180, 90, 180],
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => 'focus' in w)
      return win ? win.focus() : self.clients.openWindow('/nudge')
    })
  )
})
