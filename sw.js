/* ===================== سرویس‌ورکر سامانه آمار دوخت لباس ======================
   هدف: اجرای کامل آفلاین برنامه.
   - پوسته اصلی برنامه (index.html, manifest.json, آیکون‌ها) در نصب پیش‌بارگذاری می‌شود.
   - فایل‌های همان مبدأ (CSS/JS محلی در صورت وجود) به روش Cache First سرو می‌شوند.
   - منابع CDN خارجی (Tailwind, FontAwesome, فونت وزیرمتن) با روش
     Stale-While-Revalidate کش می‌شوند تا پس از اولین بارگذاری آنلاین، در
     حالت آفلاین هم در دسترس باشند.
   - ناوبری‌ها (باز کردن خود صفحه) با روش Network First با بازگشت به نسخه کش‌شده
     مدیریت می‌شوند تا هم به‌روزرسانی‌ها دریافت شوند و هم آفلاین کار کند.
   =============================================================================== */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `sewing-app-cache-${CACHE_VERSION}`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png'
];

// ---------------------- نصب: پیش‌بارگذاری پوسته برنامه ----------------------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // به‌جای cache.addAll (که با شکست خوردن فقط یک فایل، کل عملیات را لغو می‌کند)
            // هر فایل جدا واکشی و کش می‌شود تا نبودن یک فایل مانع کش‌شدن بقیه نشود.
            const results = await Promise.allSettled(
                APP_SHELL.map((url) =>
                    fetch(url, { cache: 'no-cache' }).then((res) => {
                        if (!res.ok) throw new Error(`HTTP ${res.status} برای ${url}`);
                        return cache.put(url, res);
                    })
                )
            );
            results.forEach((r, i) => {
                if (r.status === 'rejected') {
                    console.warn(`Service Worker: پیش‌بارگذاری «${APP_SHELL[i]}» ناموفق بود:`, r.reason);
                }
            });
        })
    );
    // عمداً از skipWaiting خودکار استفاده نمی‌شود تا کاربر با کلیک روی
    // بنر «به‌روزرسانی» در صفحه، فعال‌سازی نسخه جدید را کنترل کند.
});

// ---------------------- فعال‌سازی: پاک‌سازی کش‌های نسخه قدیمی ----------------------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// ---------------------- دریافت پیام برای فعال‌سازی فوری نسخه جدید ----------------------
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ---------------------- مدیریت درخواست‌ها ----------------------
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // ۱) ناوبری (بازکردن خود صفحه) → Network First با بازگشت به کش آفلاین
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
                    return response;
                })
                .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
        );
        return;
    }

    // ۲) فایل‌های هم‌مبدأ (برنامه، آیکون‌ها، مانیفست) → Cache First
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) return cached;
                return fetch(request).then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // ۳) منابع CDN خارجی (Tailwind, FontAwesome, فونت وزیرمتن و ...) → Stale-While-Revalidate
    event.respondWith(
        caches.match(request).then((cached) => {
            const networkFetch = fetch(request)
                .then((response) => {
                    if (response && (response.ok || response.type === 'opaque')) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
