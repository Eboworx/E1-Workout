/**
 * Web Push helper — registers the service worker and returns a push
 * subscription (JSON) that the send-nudges edge function can post to.
 */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function enablePush() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Notifications need a modern browser.')
  }
  if (!('Notification' in window) || !('PushManager' in window)) {
    throw new Error(
      'Push isn’t available here. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then open it from there.'
    )
  }

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidKey) throw new Error('Missing VITE_VAPID_PUBLIC_KEY — see setup notes.')

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was denied.')

  const existing = await reg.pushManager.getSubscription()
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  })
  return sub.toJSON()
}
