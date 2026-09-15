// Service Worker برای سامانه آمار دوخت لباس
// نسخه کش را با هر تغییر مهم در برنامه افزایش دهید تا کاربران نسخه جدید را دریافت کنند
const CACHE_VERSION = 'v5';
const CACHE_NAME = `stitching-app-cache-${CACHE_VERSION}`;

// فایل‌های اصلی خود برنامه
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './offline.html',
    './icon-192.png',
    './icon-512.png',
    './icon-512-maskable.png'
];

// فایل‌های خارجی (CDN) که برنامه برای نمایش صحیح به آن‌ها نیاز دارد؛
// بدون این‌ها، حالت آفلاین کار می‌کند ولی ظاهر برنامه (استایل/آیکون/فونت) خراب می‌شود.
const CDN_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css'
];

// کش کردن یک‌به‌یک هر فایل به‌صورت مجزا، به‌جای cache.addAll که اتمیک است
// (اگر فقط یکی از فایل‌ها ناموفق باشد، cache.addAll همه را لغو می‌کند و هیچ‌چیز کش نمی‌شود).
async function cacheEachSafely(cache, urls) {
    await Promise.allSettled(
        urls.map(async (url) => {
            try {
                const response = await fetch(url, { cache: 'reload' });
                if (response && (response.status === 200 || response.type === 'opaque')) {
                    await cache.put(url, response);
                }
            } catch (err) {
                console.log('کش نشد:', url, err);
            }
        })
    );
}

// نصب: ذخیره‌سازی صفحه‌ی آفلاین (الگوی استاندارد Offline page) + بقیه‌ی فایل‌های اصلی برنامه و CDN
self.addEventListener('install', function (event) {
    event.waitUntil(
        (async () => {
            // ذخیره‌ی مستقیم صفحه‌ی آفلاین برای Offline Support
            var offlinePage = new Request('offline.html');
            try {
                const response = await fetch(offlinePage);
                const cache = await caches.open(CACHE_NAME);
                console.log('[PWA Builder] Cached offline page during Install ' + response.url);
                await cache.put(offlinePage, response);
            } catch (err) {
                console.log('[PWA Builder] Could not cache offline page during Install', err);
            }

            // کش کردن بقیه‌ی فایل‌های اصلی برنامه و منابع CDN
            const cache = await caches.open(CACHE_NAME);
            await cacheEachSafely(cache, APP_SHELL);
            await cacheEachSafely(cache, CDN_ASSETS);
        })()
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

// واکشی: ابتدا کش بررسی می‌شود؛ در نبود آن از شبکه گرفته و در کش ذخیره می‌شود؛
// و اگر شبکه هم قطع بود (آفلاین)، صفحه‌ی اصلی کش‌شده و در نهایت offline.html نمایش داده می‌شود.
self.addEventListener('fetch', function (event) {
    const request = event.request;
    if (request.method !== 'GET') return;

    // بارگذاری خود صفحه (index.html): همیشه ابتدا شبکه بررسی می‌شود تا تغییرات جدید
    // بلافاصله دیده شوند؛ فقط در صورت قطع اتصال از نسخه‌ی کش‌شده استفاده می‌شود.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).then(function (networkResponse) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put('index.html', responseClone);
                });
                return networkResponse;
            }).catch(function (error) {
                console.log('[PWA Builder] Network request Failed. Serving offline page ' + error);
                return caches.open(CACHE_NAME).then(function (cache) {
                    return cache.match('index.html').then(function (indexMatch) {
                        if (indexMatch) return indexMatch;
                        return cache.match('offline.html');
                    });
                });
            })
        );
        return;
    }

    // سایر فایل‌ها (آیکون، فونت، CDN و ...): ابتدا کش، سپس شبکه؛ چون این‌ها به‌ندرت تغییر می‌کنند.
    event.respondWith(
        caches.match(request).then(function (cachedResponse) {
            if (cachedResponse) return cachedResponse;

            return fetch(request).then(function (networkResponse) {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(function (error) {
                console.log('[PWA Builder] Network request Failed. Serving offline page ' + error);
                return caches.open(CACHE_NAME).then(function (cache) {
                    return cache.match('index.html').then(function (indexMatch) {
                        if (indexMatch) return indexMatch;
                        return cache.match('offline.html');
                    });
                });
            });
        })
    );
});

// -------------------- اعلان‌های Push --------------------
// توجه: این برنامه سرور ندارد، پس فعلاً چیزی برای ارسال Push واقعی وجود ندارد؛
// این بخش فقط زیرساخت را آماده می‌کند تا در آینده در صورت افزودن سرور قابل استفاده باشد.
self.addEventListener('push', (event) => {
    const message = event.data ? event.data.text() : 'رویداد جدیدی در سامانه آمار دوخت ثبت شد.';
    event.waitUntil(
        self.registration.showNotification('سامانه آمار دوخت لباس', {
            body: message,
            icon: './icon-192.png',
            badge: './icon-192.png',
            dir: 'rtl',
            lang: 'fa'
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clientList) => {
            if (clientList.length > 0) return clientList[0].focus();
            return self.clients.openWindow('./index.html');
        })
    );
});

// -------------------- Background Sync --------------------
// اگر مرورگر اجازه بدهد، پس از وصل‌شدن دوباره‌ی اینترنت، کش برنامه را تازه می‌کند.
self.addEventListener('sync', (event) => {
    if (event.tag === 'refresh-app-cache') {
        event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cacheEachSafely(cache, APP_SHELL.concat(CDN_ASSETS)))
        );
    }
});

// -------------------- Periodic Background Sync --------------------
// در مرورگرهایی که پشتیبانی می‌کنند (عمدتاً Chrome روی اندروید، بعد از نصب برنامه)،
// به‌صورت دوره‌ای کش را تازه نگه می‌دارد.
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'refresh-app-cache') {
        event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cacheEachSafely(cache, APP_SHELL.concat(CDN_ASSETS)))
        );
    }
});
