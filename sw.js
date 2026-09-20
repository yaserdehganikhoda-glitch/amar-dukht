/*
 * Service Worker سامانه آمار دوخت
 * وظایف: ۱) کار آفلاین (کش برنامه و CDNها)  ۲) نمایش اعلان‌ها و ویجت وضعیت زنده  ۳) کلیک روی اعلان
 *
 * هر بار index.html را روی هاست تغییر می‌دهید، عدد VERSION را هم یکی زیاد کنید؛
 * تغییر همین فایل باعث می‌شود بنر «نسخه جدید آماده است» در برنامه ظاهر شود.
 */
const VERSION = 'v3';
const CACHE = 'sewing-stats-' + VERSION;
const SCOPE = self.registration.scope;
const INDEX_URL = new URL('index.html', SCOPE).href;

const LOCAL_ASSETS = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'badge-96.png']
  .map(p => new URL(p, SCOPE).href);

// منابع خارجی که index.html به آن‌ها نیاز دارد؛ در نصب دانلود می‌شوند تا اولین بار آفلاین هم کار کند
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css',
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@v30.1.0/dist/font-face.css',
  'https://cdn.jsdelivr.net/gh/rastikerdar/sahel-font@v3.4.0/dist/font-face.css',
  'https://cdn.jsdelivr.net/gh/rastikerdar/samim-font@v3.0.0/dist/font-face.css',
  'https://cdn.jsdelivr.net/gh/rastikerdar/shabnam-font@v4.0.1/dist/font-face.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // نبودن یک فایل نباید نصب را خراب کند
    await Promise.all(LOCAL_ASSETS.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(CDN_ASSETS.map(async u => {
      try {
        const req = new Request(u, { mode: 'no-cors' });
        const res = await fetch(req);
        await cache.put(req, res); // پاسخ opaque با put مجاز است (با add نه)
      } catch (e) { /* آفلاین یا مسدود؛ بعداً در اجرای عادی کش می‌شود */ }
    }));
    // skipWaiting عمداً اینجا صدا زده نمی‌شود: برنامه خودش با بنر به‌روزرسانی (پیام SKIP_WAITING) تصمیم می‌گیرد
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sewing-stats-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// صفحه‌ی اصلی: اول شبکه (تا تغییرات فوراً بیاید)، در صورت آفلاین بودن یا کندی، نسخه‌ی کش‌شده
async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(request), 4000);
    if (res && res.ok) cache.put(INDEX_URL, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(INDEX_URL) || await cache.match(SCOPE);
    return cached || new Response('برنامه آفلاین است و هنوز کش نشده؛ یک‌بار با اینترنت باز کنید.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// بقیه‌ی درخواست‌ها: نسخه‌ی کش را فوری بده و در پس‌زمینه تازه کن
async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(req));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

// کلیک روی اعلان یا دکمه‌های آن («کار تمام شد» / «۳۰ دقیقه بی‌صدا»)
self.addEventListener('notificationclick', event => {
  const n = event.notification;
  const action = event.action;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appClients = list.filter(c => c.url.startsWith(SCOPE));

    if (action === 'finish' || action === 'snooze') {
      if (action === 'snooze' && n.tag === 'sewing-live-status-widget') {
        // لمس دکمه، اعلان را می‌بندد؛ ویجت باید در نوار بماند، پس همان محتوا دوباره نمایش داده می‌شود
        try {
          await self.registration.showNotification(n.title, {
            body: n.body, icon: n.icon, badge: n.badge, tag: n.tag, image: n.image || undefined,
            actions: n.actions, data: n.data, dir: n.dir, lang: n.lang,
            silent: true, renotify: false, requireInteraction: true, timestamp: n.timestamp
          });
        } catch (e) { /* بی‌اهمیت */ }
      } else {
        n.close();
      }
      if (appClients.length) {
        appClients.forEach(c => c.postMessage({ type: 'NOTIF_ACTION', action }));
        if (action === 'finish') { try { await appClients[0].focus(); } catch (e) { /* بی‌اهمیت */ } }
      } else {
        await self.clients.openWindow(new URL('index.html?action=' + action, SCOPE).href);
      }
      return;
    }

    n.close();
    for (const c of appClients) {
      if ('focus' in c) return c.focus();
    }
    return self.clients.openWindow(new URL('index.html?action=progress', SCOPE).href);
  })());
});
