// Service Worker برای سامانه آمار دوخت لباس
// نسخه کش را با هر تغییر مهم در برنامه افزایش دهید تا کاربران نسخه جدید را دریافت کنند
const CACHE_VERSION = 'v1';
const CACHE_NAME = `stitching-app-cache-${CACHE_VERSION}`;

// فایل‌های اصلی برنامه که باید برای کارکرد آفلاین ذخیره شوند
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-512-maskable.png'
];

// نصب: ذخیره‌سازی فایل‌های اصلی برنامه در کش
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(APP_SHELL).catch((err) => {
                console.log('برخی فایل‌ها هنگام نصب کش نشدند:', err);
            });
        })
    );
    // عمداً skipWaiting فراخوانی نمی‌شود؛ به‌روزرسانی فقط با تایید صریح کاربر
    // از طریق پیام SKIP_WAITING اعمال می‌شود (نوار اطلاع‌رسانی داخل برنامه).
});

// فعال‌سازی: پاک‌سازی نسخه‌های قدیمی کش
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('stitching-app-cache-') && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// دریافت پیام از صفحه برای اعمال فوری نسخه جدید
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// استراتژی واکشی:
// - برای بارگذاری صفحه (navigation): ابتدا شبکه، در صورت قطع اتصال از کش استفاده شود.
// - برای سایر درخواست‌ها (فونت، آیکون، اسکریپت CDN و ...): ابتدا کش، سپس شبکه؛
//   پاسخ موفق جدید هم در کش به‌روزرسانی می‌شود تا دفعات بعد آفلاین هم در دسترس باشد.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', responseClone));
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            return fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                }
                return networkResponse;
            }).catch(() => {
                // در صورت قطع اتصال و نبود نسخه کش‌شده، خطا برگردانده می‌شود
                return new Response('', { status: 408, statusText: 'آفلاین و بدون نسخه ذخیره‌شده' });
            });
        })
    );
});
