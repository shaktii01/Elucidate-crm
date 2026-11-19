self.addEventListener('push', (event) => {
  let data = { title: 'CRM reminder', body: 'You have a follow-up due.', url: '/' }
  try { if (event.data) data = { ...data, ...event.data.json() } } catch { if (event.data) data.body = event.data.text() }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/brand-app-icon.png',
    badge: '/brand-app-icon.png',
    tag: 'crm-follow-up',
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client)
    if (existing) return existing.navigate(target).then(() => existing.focus())
    return self.clients.openWindow(target)
  }))
})
