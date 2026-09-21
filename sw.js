/*
 * Service Worker سامانه آمار دوخت
 * وظایف: ۱) کار آفلاین (کش برنامه و CDNها)  ۲) نمایش اعلان‌ها و ویجت وضعیت زنده  ۳) کلیک روی اعلان و دکمه‌های آن
 *
 * صفحه‌ی اصلی «اول شبکه» است؛ پس تغییر index.html بدون هیچ کار اضافه‌ای با اولین بازکردنِ آنلاین به کاربر می‌رسد.
 * عدد VERSION را فقط وقتی زیاد کنید که خودِ sw.js، لیست فایل‌های کش‌شده یا آیکون‌ها را عوض کرده‌اید؛
 * تغییر همین فایل باعث می‌شود بنر «نسخه جدید آماده است» در برنامه ظاهر شود.
 */
const VERSION = 'v2';
const CACHE = 'sewing-stats-' + VERSION;
const SCOPE = self.registration.scope;
const INDEX_URL = new URL('index.html', SCOPE).href;

const LOCAL_ASSETS = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']
  .map(p => new URL(p, SCOPE).href);

// منابع خارجیِ ضروری؛ در نصب دانلود می‌شوند تا اولین بار هم آفلاین کار کند.
// فونت‌های اختیاری (وزیر، ساحل، صمیم، شبنم) فقط وقتی کاربر انتخاب کند بارگذاری و خودکار کش می‌شوند.
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css'
];

// اول با CORS (تا وضعیت پاسخ قابل بررسی باشد و فضای اضافه‌ی «opaque» مصرف نشود)، در صورت رد شدن با no-cors
async function fetchCdn(url) {
  try {
    const r = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
    if (r.ok) return r;
  } catch (e) { /* ادامه با no-cors */ }
  try { return await fetch(new Request(url, { mode: 'no-cors' })); } catch (e) { return null; }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // نبودن یک فایل نباید نصب را خراب کند
    await Promise.all(LOCAL_ASSETS.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(CDN_ASSETS.map(async u => {
      const res = await fetchCdn(u);
      if (res && (res.ok || res.type === 'opaque')) { try { await cache.put(u, res); } catch (e) { /* بی‌اهمیت */ } }
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

// صفحه‌ی اصلی: اول شبکه (همیشه با اعتبارسنجی؛ کش HTTP سرور نسخه‌ی کهنه نمی‌دهد)، در صورت آفلاین بودن یا کندی، نسخه‌ی کش‌شده
async function handleNavigation(event) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }), 4000);
    if (res && res.ok) event.waitUntil(cache.put(INDEX_URL, res.clone()).catch(() => {}));
    return res;
  } catch (e) {
    const cached = await cache.match(INDEX_URL) || await cache.match(SCOPE);
    return cached || new Response('برنامه آفلاین است و هنوز کش نشده؛ یک‌بار با اینترنت باز کنید.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// بقیه‌ی درخواست‌ها: نسخه‌ی کش را فوری بده و در پس‌زمینه تازه کن.
// پاسخ «opaque» (که وضعیتش دیده نمی‌شود و ممکن است خطای CDN باشد) هرگز جای نسخه‌ی سالمِ کش‌شده را نمی‌گیرد.
async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    else if (res && res.type === 'opaque' && !cached) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

// کلیک روی اعلان یا یکی از دکمه‌هایش («کار تمام شد» / «۳۰ دقیقه بی‌صدا»).
// اگر برنامه باز است، پیام به همان صفحه فرستاده می‌شود؛ وگرنه برنامه با پارامتر action باز می‌شود
// (index.html همان پارامتر را پس از بالا آمدن اجرا می‌کند).
self.addEventListener('notificationclick', event => {
  const action = event.action; // '' | 'finish' | 'snooze'
  const known = action === 'finish' || action === 'snooze';
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list.find(c => c.url.startsWith(SCOPE));
    if (client) {
      client.postMessage({ type: 'NOTIF_ACTION', action: known ? action : 'progress' });
      if (action !== 'snooze' && 'focus' in client) { try { await client.focus(); } catch (e) { /* بی‌اهمیت */ } }
      return;
    }
    return self.clients.openWindow(new URL('index.html?action=' + (known ? action : 'progress'), SCOPE).href);
  })());
});
