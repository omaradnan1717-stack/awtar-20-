self.addEventListener('push', event => {
  let message = {};

  try {
    message = event.data ? event.data.json() : {};
  } catch (_) {
    message = { body: 'تم تسجيل حركة جديدة في أوتار' };
  }

  event.waitUntil(
    self.registration.showNotification(
      message.title || 'مطعم وكافيه أوتار',
      {
        body: message.body || 'تم تسجيل حركة جديدة',
        tag: message.id || 'awtar-activity',
        lang: 'ar',
        dir: 'rtl',
        data: {
          url: new URL('./', self.registration.scope).href
        }
      }
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil((async () => {
    const url = new URL('./', self.registration.scope).href;

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const window of windows) {
      if (window.url.startsWith(url)) {
        return window.focus();
      }
    }

    return self.clients.openWindow(url);
  })());
});
