// Service worker แบบส่งผ่านอย่างเดียว — ไม่ cache อะไรเลย
// มีไว้เพื่อให้ Chrome ยอมให้ติดตั้งลงหน้าจอหลักได้ (ต้องมี fetch handler)
// ห้าม cache index.html เด็ดขาด ไม่งั้นผู้ใช้จะค้างอยู่เวอร์ชันเก่าหลัง deploy
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
