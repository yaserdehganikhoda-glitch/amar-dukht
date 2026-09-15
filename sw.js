// Service Worker برای سامانه آمار دوخت لباس
// نسخه کش را با هر تغییر مهم در برنامه افزایش دهید تا کاربران نسخه جدید را دریافت کنند
const CACHE_VERSION = 'v3';
const CACHE_NAME = `stitching-app-cache-${CACHE_VERSION}`;
const OFFLINE_FALLBACK_PAGE = './offline.html';

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
                // پاسخ‌های موفق (status 200) و پاسخ‌های opaque (فایل‌های cross-origin بدون CORS
                // مثل CDN‌ها که status آن‌ها 0 است) هر دو قابل ذخیره‌سازی هستند.
                if (response && (response.status === 200 || response.type === 'opaque')) {
                    await cache.put(url, response);
                }
            } catch (err) {
                console.log('کش نشد:', url, err);
            }
        })
    );
}

// نصب: ذخیره‌سازی فایل‌های اصلی برنامه + صفحه‌ی آفلاین + فایل‌های CDN در کش
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await cacheEachSafely(cache, APP_SHELL);
            await cacheEachSafely(cache, CDN_ASSETS);
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
// - برای بارگذاری صفحه (navigation): ابتدا شبکه، در قطعی اتصال از نسخه‌ی کش‌شده‌ی index.html
//   و در نبود آن از صفحه‌ی افتادگی آفلاین (offline.html) استفاده می‌شود.
// - برای سایر درخواست‌ها (فونت، آیکون، اسکریپت CDN و ...): ابتدا کش، سپس شبکه؛
//   پاسخ‌های موفق یا opaque جدید هم در کش به‌روزرسانی می‌شوند تا دفعات بعد آفلاین هم در دسترس باشند.
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
                .catch(async () => {
                    const cache = await caches.open(CACHE_NAME);
                    const cachedPage = await cache.match('./index.html');
                    if (cachedPage) return cachedPage;
                    return cache.match(OFFLINE_FALLBACK_PAGE);
                })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            return fetch(request).then((networkResponse) => {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
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
