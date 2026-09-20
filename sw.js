/*
 * Service Worker — سامانه آمار دوخت لباس
 * وظایف: کش کردن پوسته‌ی برنامه برای کار آفلاین، به‌روزرسانی کنترل‌شده (با تایید کاربر از طریق
 * بنر «نسخه جدید آماده است»)، و هدایت درست کاربر هنگام لمس اعلان‌های پیشرفت کار.
 *
 * برای انتشار نسخه‌ی جدید برنامه: فقط کافی‌ست CACHE_VERSION زیر را عوض کنید (مثلاً v2, v3, ...).
 * با تغییر این عدد، مرورگر نسخه‌ی جدید همین فایل را نصب می‌کند، کش قدیمی را (بعد از تایید کاربر
 * در همان بنر) پاک می‌کند و کش تازه می‌سازد؛ بدون این تغییر، مرورگر فایل قدیمی را از کش خودش
 * می‌خواند و اصلاً متوجه آپدیت نمی‌شود.
 */

const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `sewing-app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `sewing-app-runtime-${CACHE_VERSION}`;

// فایل‌های اصلی پوسته‌ی برنامه که در نصب اولیه، از قبل کش می‌شوند تا برنامه حتی بدون اینترنت هم بالا بیاید
const APP_SHELL_FILES = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-512-maskable.png'
];

/* ==================== نصب: پیش‌کش کردن پوسته‌ی برنامه ==================== */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE).then((cache) => {
            // هر فایل جدا اضافه می‌شود (به‌جای cache.addAll) تا اگر یکی از فایل‌ها (مثلاً یک آیکون
            // که هنوز روی سرور آپلود نشده) در دسترس نبود، کل نصب سرویس‌ورکر با خطا متوقف نشود.
            return Promise.all(
                APP_SHELL_FILES.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn('[SW] عدم موفقیت در پیش‌کش کردن:', url, err);
                    })
                )
            );
        })
    );
    // عمداً self.skipWaiting() اینجا صدا زده نمی‌شود؛ می‌خواهیم نسخه‌ی جدید در حالت «در انتظار»
    // بماند تا index.html بنر «نسخه جدید آماده است» را نشان دهد و کاربر خودش زمان به‌روزرسانی را تایید کند.
});

/* ==================== فعال‌سازی: پاک‌سازی کش‌های نسخه‌های قدیمی ==================== */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames
                    .filter((name) => name !== APP_SHELL_CACHE && name !== RUNTIME_CACHE)
                    .map((name) => caches.delete(name))
            )
        ).then(() => self.clients.claim()) // کنترل تب‌های باز را بلافاصله به نسخه‌ی جدید می‌دهد
    );
});

/* ==================== دریافت پیام از صفحه (دکمه «به‌روزرسانی» در بنر برنامه) ==================== */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

/* ==================== استراتژی fetch ====================
 * ناوبری‌های صفحه (بارگذاری خودِ index.html): ابتدا شبکه، در صورت آفلاین بودن از کش.
 * بقیه‌ی درخواست‌های GET (آیکون‌ها، فونت‌ها، Tailwind/FontAwesome از CDN، و غیره):
 * Stale-While-Revalidate — بلافاصله از کش پاسخ داده می‌شود (اگر موجود باشد) تا برنامه سریع
 * بالا بیاید، و هم‌زمان در پس‌زمینه نسخه‌ی تازه از شبکه گرفته و جایگزین کش می‌شود.
 */
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return; // درخواست‌های غیر GET دست‌نخورده به شبکه می‌روند

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstForNavigation(request));
        return;
    }

    event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstForNavigation(request) {
    try {
        const freshResponse = await fetch(request);
        const cache = await caches.open(APP_SHELL_CACHE);
        cache.put('./index.html', freshResponse.clone());
        return freshResponse;
    } catch (err) {
        const cache = await caches.open(APP_SHELL_CACHE);
        const cached = await cache.match('./index.html') || await cache.match('./');
        if (cached) return cached;
        return new Response(
            '<!DOCTYPE html><html lang="fa" dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:2rem;">اتصال اینترنت برقرار نیست و نسخه‌ی آفلاین هنوز در دسترس نیست. لطفاً دوباره تلاش کنید.</body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);

    const networkFetch = fetch(request)
        .then((response) => {
            // فقط پاسخ‌های معتبر (یا opaque برای منابع کراس‌اوریجین مثل CDN فونت/آیکون) کش می‌شوند
            if (response && (response.ok || response.type === 'opaque')) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    return cached || (await networkFetch) || new Response('', { status: 504 });
}

/* ==================== لمس اعلان: باز کردن/فوکوس برنامه و هدایت به بخش مرتبط ==================== */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const tag = event.notification.tag || '';
    let targetPath = 'index.html';
    if (tag.indexOf('sewing-live-status-widget') === 0 ||
        tag.indexOf('sewing-stage-') === 0 ||
        tag.indexOf('sewing-progress-') === 0) {
        targetPath = 'index.html?action=progress';
    }

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
            for (const client of clientsArr) {
                if ('focus' in client) {
                    client.focus();
                    if ('navigate' in client) {
                        try { client.navigate(targetPath); } catch (e) { /* بی‌اهمیت */ }
                    }
                    return;
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetPath);
            }
        })
    );
});
