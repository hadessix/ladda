// Service worker — ส่งผ่านอย่างเดียว ไม่ cache (กันผู้ใช้ค้างเวอร์ชันเก่า)
// + รับแจ้งเตือน Web Push
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// push มาแบบไม่มีเนื้อหา → แสดงข้อความมาตรฐาน
self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('🚨 แจ้งรถเสีย', {
    body: 'มีพนักงานแจ้งขอความช่วยเหลือ — แตะเพื่อดูตำแหน่ง',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'ladda-alert',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: '/?work=1' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('/?work=1');
  })());
});
