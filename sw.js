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

const CACHE_VERSION = 'v2';
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

/* ==================== Periodic Background Sync — به‌روزرسانی ویجت وضعیت زنده در پس‌زمینه ====================
 * توجه مهم: این ایونت فقط در Chrome/Edge (اندروید و دسکتاپ) و فقط وقتی برنامه با «Add to Home
 * Screen» نصب شده باشد اصلاً وجود دارد؛ در iOS/Safari و Firefox هرگز اجرا نمی‌شود. حتی جایی که
 * پشتیبانی می‌شود، فاصله‌ی واقعیِ اجرا کاملاً دست خودِ مرورگر است (بر اساس میزان و تازگیِ استفاده‌ی
 * کاربر از سایت) و می‌تواند از چند دقیقه تا چند ساعت طول بکشد — یعنی این یک بهبودِ best-effort
 * است، نه تضمینِ آپدیتِ لحظه‌ای. سرویس‌ورکر به localStorage صفحه دسترسی ندارد، پس index.html با
 * هر بار محاسبه، یک خلاصه‌ی سبک از وضعیت لازم را در IndexedDB می‌نویسد؛ این‌جا همان خلاصه خوانده
 * و اعلان دوباره ساخته می‌شود.
 */
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'live-widget-refresh') {
        event.waitUntil(refreshLiveWidgetNotification());
    }
});

const LIVE_WIDGET_DB_NAME = 'sewing_live_widget_db';
const LIVE_WIDGET_STORE = 'state';
const LIVE_WIDGET_TAG = 'sewing-live-status-widget';

function swOpenLiveWidgetDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(LIVE_WIDGET_DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(LIVE_WIDGET_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function swReadLiveWidgetSnapshot() {
    return swOpenLiveWidgetDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(LIVE_WIDGET_STORE, 'readonly');
        const req = tx.objectStore(LIVE_WIDGET_STORE).get('snapshot');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    }));
}

/* ---- زیرمجموعه‌ای از منطق تقویم شمسی و ساعات کاری، هم‌ارز با index.html؛ چون سرویس‌ورکر وقتی
   صفحه بسته است نمی‌تواند به توابع خودِ صفحه دسترسی داشته باشد، این محاسبات این‌جا هم تکرار شده‌اند ---- */
function swToEnglishDigits(str) {
    return String(str).replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (d) => {
        const c = d.charCodeAt(0);
        return c >= 0x06F0 ? c - 0x06F0 : c - 0x0660;
    });
}
function swJdiv(a, b) { return Math.trunc(a / b); }
function swJmod(a, b) { return a - Math.trunc(a / b) * b; }
function swJalCal(jy) {
    const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    const bl = breaks.length;
    const gy = jy + 621;
    let leapJ = -14;
    let jp = breaks[0];
    if (jy < jp || jy >= breaks[bl - 1]) throw new Error('سال شمسی نامعتبر');
    let jump = 0, jm;
    for (let i = 1; i < bl; i++) {
        jm = breaks[i]; jump = jm - jp;
        if (jy < jm) break;
        leapJ += swJdiv(jump, 33) * 8 + swJdiv(swJmod(jump, 33), 4);
        jp = jm;
    }
    let n = jy - jp;
    leapJ += swJdiv(n, 33) * 8 + swJdiv(swJmod(n, 33) + 3, 4);
    if (swJmod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = swJdiv(gy, 4) - swJdiv((swJdiv(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + swJdiv(jump + 4, 33) * 33;
    let leap = swJmod(swJmod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap, gy, march };
}
function swG2d(gy, gm, gd) {
    let d = swJdiv((gy + swJdiv(gm - 8, 6) + 100100) * 1461, 4) + swJdiv(153 * swJmod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - swJdiv(swJdiv(gy + 100100 + swJdiv(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
}
function swJ2d(jy, jm, jd) {
    const r = swJalCal(jy);
    return swG2d(r.gy, 3, r.march) + (jm - 1) * 31 - swJdiv(jm, 7) * (jm - 7) + jd - 1;
}
function swD2g(jdn) {
    let j = 4 * jdn + 139361631;
    j = j + swJdiv(swJdiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = swJdiv(swJmod(j, 1461), 4) * 5 + 308;
    const gd = swJdiv(swJmod(i, 153), 5) + 1;
    const gm = swJmod(swJdiv(i, 153), 12) + 1;
    const gy = swJdiv(j, 1461) - 100100 + swJdiv(8 - gm, 6);
    return { gy, gm, gd };
}
function swIsFridayJdn(jdn) {
    try {
        const g = swD2g(jdn);
        return new Date(g.gy, g.gm - 1, g.gd).getDay() === 5;
    } catch (e) { return false; }
}
function swParseJalaliDateToJdn(dateStr) {
    if (!dateStr) return 0;
    const parts = swToEnglishDigits(dateStr).trim().split('/').map((p) => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(isNaN)) return 0;
    try { return swJ2d(parts[0], parts[1], parts[2]); } catch (e) { return 0; }
}
function swParseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = swToEnglishDigits(timeStr).trim().split(':').map((p) => parseInt(p, 10));
    if (parts.length < 2 || parts.some(isNaN)) return 0;
    return parts[0] * 60 + parts[1];
}
function swGetCurrentJalaliDateTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' });
    let year = '', month = '', day = '';
    formatter.formatToParts(now).forEach((p) => {
        if (p.type === 'year') year = p.value;
        if (p.type === 'month') month = p.value;
        if (p.type === 'day') day = p.value;
    });
    const yearEn = swToEnglishDigits(year), monthEn = swToEnglishDigits(month), dayEn = swToEnglishDigits(day);
    return {
        jdn: swJ2d(parseInt(yearEn, 10), parseInt(monthEn, 10), parseInt(dayEn, 10)),
        minute: now.getHours() * 60 + now.getMinutes()
    };
}

const SW_SHIFT_MINUTES = 495;
const SW_SHIFT_START = 8 * 60;
const SW_SHIFT_END = 18 * 60;
const SW_SHIFT_BREAKS = [
    { start: 540, end: 570 }, { start: 705, end: 720 }, { start: 825, end: 870 }, { start: 975, end: 990 }
];
function swWorkingMinutesInDayInterval(aMin, bMin) {
    const start = Math.max(aMin, SW_SHIFT_START);
    const end = Math.min(bMin, SW_SHIFT_END);
    if (end <= start) return 0;
    let total = end - start;
    SW_SHIFT_BREAKS.forEach((b) => {
        const os = Math.max(start, b.start), oe = Math.min(end, b.end);
        if (oe > os) total -= (oe - os);
    });
    return Math.max(0, total);
}
function swCalcActualWorkingMinutesElapsed(startJdn, startMinute, endJdn, endMinute) {
    if (!startJdn || !endJdn) return 0;
    if (endJdn < startJdn || (endJdn === startJdn && endMinute <= startMinute)) return 0;
    let total = 0;
    if (startJdn === endJdn) {
        if (!swIsFridayJdn(startJdn)) total += swWorkingMinutesInDayInterval(startMinute, endMinute);
        return total;
    }
    if (!swIsFridayJdn(startJdn)) total += swWorkingMinutesInDayInterval(startMinute, 1440);
    for (let d = startJdn + 1; d < endJdn; d++) { if (!swIsFridayJdn(d)) total += SW_SHIFT_MINUTES; }
    if (!swIsFridayJdn(endJdn)) total += swWorkingMinutesInDayInterval(0, endMinute);
    return total;
}
function swParseDurationStrToMinutes(durationStr) {
    if (!durationStr) return null;
    const parts = swToEnglishDigits(durationStr).trim().split(':');
    if (parts.length !== 2) return null;
    const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}
function swFormatPersianDigits(str) {
    const d = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(str).replace(/\d/g, (ch) => d[ch]);
}
function swFormatNumber(num, numFormat) {
    const s = Number(num).toLocaleString('en-US');
    return numFormat === 'english' ? s : swFormatPersianDigits(s);
}
function swFormatMinutesDuration(mins, numFormat) {
    const absMins = Math.abs(Math.round(mins));
    const h = Math.floor(absMins / 60), m = absMins % 60;
    let text = '';
    if (h > 0) text += `${swFormatNumber(h, numFormat)} ساعت `;
    if (m > 0 || h === 0) text += `${swFormatNumber(m, numFormat)} دقیقه`;
    return text.trim();
}

async function refreshLiveWidgetNotification() {
    let snapshot;
    try { snapshot = await swReadLiveWidgetSnapshot(); } catch (e) { return; }

    if (!snapshot || !snapshot.liveWidgetEnabled || !snapshot.activeRecord) {
        try {
            const list = await self.registration.getNotifications({ tag: LIVE_WIDGET_TAG });
            list.forEach((n) => n.close());
        } catch (e) { /* بی‌اهمیت */ }
        return;
    }

    const rec = snapshot.activeRecord;
    const targetMinutes = swParseDurationStrToMinutes(rec.workDuration);
    if (targetMinutes === null || targetMinutes <= 0) return;
    const startJdn = swParseJalaliDateToJdn(rec.date);
    const startMinute = swParseTimeToMinutes(rec.time);
    if (!startJdn) return;

    const nowInfo = swGetCurrentJalaliDateTime();
    const elapsed = swCalcActualWorkingMinutesElapsed(startJdn, startMinute, nowInfo.jdn, nowInfo.minute);
    const percent = Math.round((elapsed / targetMinutes) * 100);
    const remainingMinutes = targetMinutes - elapsed;
    const numFormat = snapshot.numFormat || 'persian';
    const isOverdue = percent >= 100;
    const statusText = isOverdue
        ? `${swFormatMinutesDuration(remainingMinutes, numFormat)} تاخیر از موعد`
        : `${swFormatMinutesDuration(remainingMinutes, numFormat)} تا موعد باقی مانده`;

    const options = {
        body: `کد ${rec.itemCode || '-'} — ${rec.itemTitle || '-'} • ${swFormatNumber(Math.min(999, percent), numFormat)}٪ • ${statusText}`,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: LIVE_WIDGET_TAG,
        renotify: false,
        requireInteraction: true,
        silent: true,
        dir: 'rtl',
        lang: 'fa',
        timestamp: Date.now()
        // توجه: تصویرِ نوار پیشرفت (canvas) این‌جا عمداً ساخته نمی‌شود؛ رسم فونت فارسی داخل
        // سرویس‌ورکر (بدون دسترسی مطمئن به فونت‌های بارگذاری‌شده‌ی صفحه) قابل‌اتکا نیست، پس
        // آپدیتِ پس‌زمینه فقط متنی است. وقتی خودِ برنامه باز است، تصویر کامل مثل قبل نمایش داده می‌شود.
    };
    try {
        await self.registration.showNotification(`📊 وضعیت زنده — ${snapshot.shopName || 'آمار دوخت'}`, options);
    } catch (e) { /* بی‌اهمیت */ }
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
