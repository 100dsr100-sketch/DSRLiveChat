// Minimal service worker - no offline caching yet, just satisfies the
// installability requirement so Android offers a proper "Install app"
// (rather than a plain bookmark shortcut).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
