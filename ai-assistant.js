/* =====================================================================
   دستیار هوشمند — موتور پرسش و پاسخ پیشرفته (کاملاً آفلاین)
   این فایل بعد از اسکریپت اصلی index.html بارگذاری می‌شود و فقط از
   داده‌ها و توابع خودِ برنامه (allRecords، appSettings، …) استفاده می‌کند.
   قابلیت‌ها: درک زبان محاوره‌ای فارسی با غلط‌یابی، بازه‌های زمانی
   (امروز/هفته‌ی قبل/۳ ماه اخیر/مهر/تاریخ دقیق)، فیلتر کد/پرسنل/بخش/عنوان/رنگ،
   تجمیع و رتبه‌بندی روی هر بُعد، مقایسه، «چرا؟»، پیش‌بینی فصلی، هدف،
   ناهنجاری‌ها، روزهای بیکار، کیفیت داده، و ادامه‌ی گفتگو (زمینه).
   ===================================================================== */
(function () {
    'use strict';
    try { localStorage.removeItem('sewing_ai_cfg_v1'); } catch (e) { /* کلید قدیمی */ }

    /* ============================ ابزارهای پایه ============================ */
    const WD = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
    const $ = (id) => document.getElementById(id);
    const num = (v) => Number(v) || 0;
    const sum = (a, fn) => a.reduce((x, r) => x + fn(r), 0);
    const f = (n) => formatNumber(Math.round(n));
    const fa = (s) => (appSettings && appSettings.numFormat === 'english') ? String(s) : toPersianDigits(String(s));
    const cur = () => (appSettings && appSettings.currency) || 'تومان';
    const money = (n) => f(n) + ' ' + cur();
    const pctS = (n) => f(n) + '٪';
    const JUDGED = ['به موقع', 'تاخیر', 'زودتر از موعد'];
    const esc = (s) => escapeHTML(s);
    const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    const uniq = (a) => a.filter((v, i) => a.indexOf(v) === i);

    /* نرمال‌سازی متن فارسی: یکسان‌سازی حروف، ارقام، نیم‌فاصله و پسوندها */
    function norm(s) {
        let t = toEnglishDigits(String(s == null ? '' : s));
        t = t.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ی').replace(/ة/g, 'ه')
            .replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[\u200c\u200d\u200e\u200f]/g, ' ')
            .replace(/٫/g, '.').replace(/(\d)[,٬،](?=\d{3}(?!\d))/g, '$1').replace(/(\d)\.(?=\d)/g, '$1_D_')
            .replace(/[؟?!.:؛;,،()«»"'\[\]{}<>*+=~`^|\\]/g, ' ').replace(/_D_/g, '.')
            .replace(/\s+/g, ' ').trim().toLowerCase();
        t = t.replace(/(تر)ه(?= |$)/g, '$1').replace(/ (ها|های|ترین|تر)(?= |$)/g, '$1').replace(/(^| )(ن?می) (?=\S)/g, '$1$2');
        t = t.replace(/(^| )(یک|دو|سه|چهار|پنج) شنبه/g, '$1$2شنبه');
        return t;
    }
    function stem(w) {
        if (w.length >= 5) w = w.replace(/(های|ها)$/, ''); else if (w.length === 4) w = w.replace(/ها$/, '');
        if (w.length >= 5) w = w.replace(/(ات|ان)$/, '');
        if (w.length >= 5 && /ی$/.test(w)) w = w.slice(0, -1);
        return w;
    }
    function lev(a, b, max) {
        if (a === b) return 0;
        const la = a.length, lb = b.length;
        if (Math.abs(la - lb) > max) return max + 1;
        let prev = new Array(lb + 1), cur2 = new Array(lb + 1);
        for (let j = 0; j <= lb; j++) prev[j] = j;
        for (let i = 1; i <= la; i++) {
            cur2[0] = i; let rowMin = cur2[0];
            for (let j = 1; j <= lb; j++) {
                const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
                cur2[j] = Math.min(prev[j] + 1, cur2[j - 1] + 1, prev[j - 1] + c);
                if (cur2[j] < rowMin) rowMin = cur2[j];
            }
            if (rowMin > max) return max + 1;
            const t = prev; prev = cur2; cur2 = t;
        }
        return prev[lb];
    }
    /* تطبیق تقریبی (غلط املایی): کلمه‌های کوتاه دقیق، بلندتر با یک یا دو خطا */
    function nearL(a, b) {
        if (a === b) return true;
        if (Math.min(a.length, b.length) < 4 || Math.max(a.length, b.length) < 5) return false;
        return lev(a, b, 1) <= 1 || (Math.min(a.length, b.length) >= 8 && lev(a, b, 2) <= 2);
    }
    function near(a, b) {
        if (a === b) return true;
        const L = Math.min(a.length, b.length);
        if (L < 5) return false;
        const m = L >= 9 ? 2 : 1;
        return lev(a, b, m) <= m;
    }

    const NW = { صفر: 0, یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19, بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90 };
    const NUNIT = ['روز', 'هفته', 'ماه', 'سال', 'تا', 'عدد', 'کد', 'کارکرد', 'کار', 'نفر', 'مورد', 'رکورد', 'برتر', 'میلیون', 'هزار', 'تومان', 'ریال', 'دانه', 'قطعه'];
    const NPREV = ['کد', 'بالای', 'زیر', 'حداقل', 'حداکثر', 'تاپ', 'top', 'برتر'];
    function wordNums(q) {
        const t = q.split(' '), out = [];
        for (let i = 0; i < t.length; i++) {
            const w = t[i];
            if (Object.prototype.hasOwnProperty.call(NW, w)) {
                let v = NW[w], used = 1;
                if (v >= 20 && t[i + 1] === 'و' && Object.prototype.hasOwnProperty.call(NW, t[i + 2]) && NW[t[i + 2]] < 10) { v += NW[t[i + 2]]; used = 3; }
                const nxt = t[i + used], prv = out[out.length - 1];
                if ((nxt && NUNIT.indexOf(nxt.replace(/ها$/, '')) >= 0) || (prv && NPREV.indexOf(prv) >= 0)) { out.push(String(v)); i += used - 1; continue; }
            }
            out.push(w);
        }
        return out.join(' ');
    }

    /* ============================ واژگان ============================ */
    const LX = {
        greet: ['سلام', 'درود', 'سلام علیکم', 'صبح بخیر', 'عصر بخیر', 'شب بخیر', 'وقت بخیر', 'هلو'],
        thanks: ['ممنون', 'مرسی', 'تشکر', 'دمت گرم', 'دستت درد', 'خسته نباشی', 'احسنت', 'متشکرم', 'ایول'],
        help: ['راهنما', 'کمک', 'چه کار میتونی', 'چیکار میتونی', 'چه کاری', 'چکار میکنی', 'چی بلدی', 'قابلیت', 'امکانات', 'چی بپرسم', 'help', 'دستورات', 'چه سوالی', 'چه چیزی بپرسم'],
        why: ['چرا', 'دلیل', 'علت', 'چطور شد', 'چی شد', 'چه شد', 'عامل'],
        forecast: ['پیشبینی', 'پیش بینی', 'پایان ماه', 'اخر ماه', 'تا اخر', 'تا پایان', 'اخر هفته', 'پایان هفته', 'تخمین', 'برآورد', 'براورد', 'چقدر میشه', 'چقدر خواهد شد', 'حدود چقدر', 'تا ته ماه'],
        goal: ['هدف', 'تارگت', 'به هدف برسم', 'چقدر مونده', 'چقدر مانده', 'کمبود', 'تا هدف'],
        active: ['جاری', 'در حال انجام', 'در حال کار', 'کار فعلی', 'فعلی', 'پیشرفت', 'موعد', 'ددلاین', 'مهلت', 'تموم نشده', 'تمام نشده', 'نیمه کاره', 'باز', 'الان'],
        compare: ['مقایسه', 'نسبت به', 'در برابر', 'در مقابل', 'فرق', 'تفاوت', 'بهتر شده', 'بدتر شده', 'رشد', 'کاهش', 'افزایش', 'نسبت'],
        analysis: ['تحلیل', 'روند', 'ارزیابی', 'عملکرد', 'وضعیت کلی', 'بررسی کن', 'گزارش کامل', 'گزارش جامع', 'دید کلی', 'نقاط ضعف', 'نقاط قوت', 'چطور بودم', 'چطوره', 'اوضاع', 'وضع'],
        summary: ['خلاصه', 'گزارش', 'وضعیت', 'چه خبر', 'نمای کلی'],
        anomaly: ['غیرعادی', 'غیر عادی', 'عجیب', 'ناهنجار', 'نامعمول', 'غیرطبیعی', 'غیر طبیعی', 'پرت', 'استثنا', 'مشکوک'],
        streak: ['پشت سر هم', 'متوالی', 'پیاپی', 'استریک', 'بی وقفه', 'مداوم'],
        idle: ['بدون کار', 'بیکار', 'بیکاره', 'بیکارن', 'بیکارند', 'بی کار', 'کار نکردم', 'نیومدم', 'غایب', 'روز خالی', 'نبود', 'بدون ثبت', 'ثبت نشده', 'کار نکرد', 'روز بی کار'],
        quality: ['بررسی داده', 'سلامت داده', 'ناقص', 'خطا', 'اشتباه', 'تکراری', 'بدون قیمت', 'قیمت ندارد', 'قیمت نداره', 'قیمت نامعلوم', 'بدون مدت', 'کیفیت داده'],
        tips: ['پیشنهاد', 'توصیه', 'هشدار', 'نکته', 'مشکل', 'چه کنم', 'چکار کنم', 'چیکار کنم', 'راهکار', 'بهبود', 'چطور بهتر', 'چطور افزایش', 'چه کار کنم', 'راه حل'],
        last: ['اخرین', 'جدیدترین', 'تازه ترین', 'اخیرا ثبت'],
        first: ['اولین', 'قدیمی ترین', 'نخستین'],
        list: ['لیست', 'فهرست', 'نشان بده', 'نمایش بده', 'نشونم بده', 'نشونم', 'چه کارهایی', 'کدوم کارها', 'کدام کارها'],
        find: ['پیدا کن', 'جستجو', 'سرچ', 'دنبال', 'کجاست', 'پیدا'],
        who: ['چه کسی', 'کی', 'کیه', 'کیا', 'کدام کارگر', 'کدوم کارگر', 'کدام نفر', 'کدوم نفر', 'کدام پرسنل', 'چه کارگری', 'کدام کارمند'],
        more: ['بیشتر', 'بیشتر بگو', 'ادامه', 'جزئیات', 'بیشتر توضیح', 'بیشتر نشان بده', 'کامل تر', 'توضیح بده'],
        pron: ['همین', 'اون', 'ان', 'همان', 'اینو', 'اونو', 'همینو'],
        d_status: ['وضعیت تحویل'],
        m_perhour: ['در ساعت', 'بازده', 'بازدهی', 'بهره وری', 'راندمان', 'به صرفه', 'سودآور', 'ارزش هر ساعت', 'درامد هر ساعت', 'درامد ساعتی', 'ارزش ساعتی', 'سود ده'],
        m_hours: ['چند ساعت', 'ساعت کار', 'مجموع ساعت', 'ساعات کار'],
        m_days: ['چند روز', 'تعداد روز', 'روز کاری', 'روزهای کاری', 'چند روزه'],
        m_count: ['تعداد کارکرد', 'چند کارکرد', 'چند تا کار', 'چندتا کار', 'چند کار', 'چند رکورد', 'تعداد رکورد', 'تعداد کار', 'تعداد ثبت', 'کارکرد', 'رکورد', 'چندتا', 'چند تا', 'چند مورد'],
        m_qty: ['مجموع تعداد', 'تعداد قطعه', 'چند عدد', 'تعداد', 'قطعه', 'دانه', 'تولید', 'عدد', 'حجم'],
        m_income: ['درامد', 'ارزش', 'فروش', 'پول', 'مبلغ', 'دستمزد', 'مزد', 'کسب', 'در اوردم', 'دراوردم', 'سود', 'تومان', 'ریال'],
        m_late: ['تاخیر', 'دیرکرد', 'معوق', 'دیر', 'عقب'],
        m_ontime: ['به موقع', 'بموقع', 'سر وقت', 'زودتر', 'تحویل به موقع', 'وقت شناس', 'انضباط'],
        m_dur: ['مدت زمان', 'مدت', 'زمان انجام', 'طول کشید', 'چقدر طول', 'زمان کار', 'سرعت'],
        m_unit: ['قیمت واحد', 'نرخ واحد', 'قیمت هر', 'تعرفه'],
        rate: ['نرخ', 'درصد', 'چند درصد'],
        avg: ['میانگین', 'متوسط', 'معدل', 'به طور متوسط', 'بطور متوسط', 'سرانه', 'به ازای'],
        d_weekday: ['روز هفته', 'روزهای هفته', 'کدام روز هفته', 'کدوم روز هفته'],
        d_day: ['هر روز', 'روزانه', 'روز به روز', 'روزبه روز', 'به تفکیک روز', 'برای هر روز', 'کدام روز', 'کدوم روز', 'چه روزی', 'روز'],
        d_week: ['هر هفته', 'هفتگی', 'هفته به هفته', 'به تفکیک هفته', 'کدام هفته', 'کدوم هفته', 'هفته'],
        d_month: ['هر ماه', 'ماهانه', 'ماه به ماه', 'به تفکیک ماه', 'کدام ماه', 'کدوم ماه', 'ماه'],
        d_hour: ['ساعات', 'کدام ساعت', 'کدوم ساعت', 'چه ساعتی', 'هر ساعت', 'ساعت پرکار', 'ساعت کاری', 'ساعت'],
        d_code: ['هر کد', 'کدام کد', 'کدوم کد', 'چه کدی', 'به تفکیک کد', 'کد'],
        d_worker: ['پرسنل', 'پرسنله', 'کارگر', 'کارگره', 'کارگرا', 'کارمنده', 'نفرات', 'کارمند', 'هر نفر', 'هر کارگر', 'اپراتور', 'نیرو'],
        d_section: ['بخش', 'قسمت', 'سالن', 'هر بخش'],
        d_color: ['رنگ', 'هر رنگ', 'کدام رنگ'],
        d_title: ['هر مدل', 'کدام مدل', 'مدل', 'کدام محصول', 'هر محصول', 'محصول', 'عنوان'],
        sup_max: ['بیشترین', 'پرکارترین', 'پردرامدترین', 'بهترین', 'برترین', 'برتر', 'تاپ', 'top', 'ماکزیمم', 'حداکثر', 'پیک', 'بالاترین', 'گرانترین', 'موفق ترین', 'بیشتر', 'پرسودترین', 'پربازده ترین', 'پرکار', 'پردرامد', 'پرکارتر', 'پردرامدتر', 'بهتر', 'پرتر', 'پربازده تر'],
        sup_min: ['کمترین', 'ضعیف ترین', 'بدترین', 'کم کار', 'حداقل', 'پایین ترین', 'مینیمم', 'کمتر', 'ارزانترین', 'کم درامد', 'کم بازده ترین'],
        busy: ['پرکار', 'پرکارترین', 'پرکارتر', 'کم کار'],
        st_late: ['تاخیردار', 'تاخیر دار', 'با تاخیر', 'دیر تحویل', 'دیر تحویل شده'],
        st_early: ['زودتر از موعد', 'زود تحویل'],
        stop: ['در', 'از', 'به', 'را', 'که', 'با', 'برای', 'این', 'ان', 'و', 'یا', 'من', 'ما', 'شما', 'چه', 'چی', 'هم', 'هر', 'همه', 'تا', 'بر', 'ی', 'است', 'هست', 'بود', 'شد', 'میشه', 'کرد', 'کردم', 'کنم', 'کن', 'بده', 'بگو', 'بگین', 'لطفا', 'یه', 'رو', 'اون', 'بعد', 'قبل', 'هنوز', 'اگه', 'اگر', 'ولی', 'اما', 'پس', 'فقط', 'خیلی', 'کنید', 'کنیم', 'دارم', 'داشتم', 'دارد', 'داره', 'بوده', 'باشه', 'باید', 'میخوام', 'میخواهم', 'میتونم', 'کار', 'کارا', 'چقدر', 'چند', 'کدام', 'کدوم', 'چطور', 'چگونه', 'آیا', 'ایا', 'هستم', 'بود', 'بودم', 'شده', 'میشود', 'اینجا', 'خب', 'خوب', 'لطف', 'ببین', 'بزن', 'بزار', 'ممکنه', 'بنویس', 'می', 'نمی', 'ها', 'تر', 'بیشتر', 'کمتر', 'همین', 'ثبت', 'کارکرد', 'کدی']
    };
    const PC = {};
    function ph(p) {
        let c = PC[p];
        if (!c) { const n = norm(p); c = PC[p] = { s: ' ' + n.split(' ').map(stem).join(' ') + ' ', single: n.indexOf(' ') < 0 ? stem(n) : null }; }
        return c;
    }
    function mkQ(q) { const toks = q.split(' ').filter(Boolean); return { toks, W: ' ' + toks.map(stem).join(' ') + ' ' }; }
    const has = (Q, key) => LX[key].some(p => Q.W.indexOf(ph(p).s) >= 0);
    function take(Q, key, fuzzy) {
        let hit = false;
        for (const p of LX[key]) {
            const c = ph(p);
            if (Q.W.indexOf(c.s) >= 0) { hit = true; Q.W = Q.W.split(c.s).join(' '); }
            else if (fuzzy && c.single && c.single.length >= 5) {
                const ts = Q.W.trim().split(' ');
                for (let i = 0; i < ts.length; i++) if (ts[i].length >= 4 && nearL(ts[i], c.single)) { hit = true; ts[i] = ''; Q.W = ' ' + ts.filter(Boolean).join(' ') + ' '; break; }
            }
        }
        return hit;
    }

    /* ============================ لایه‌ی داده ============================ */
    function durMin(s) { const m = /^(\d{1,4}):(\d{2})$/.exec(toEnglishDigits(String(s || '')).trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; }
    const pad2 = (n) => String(n).padStart(2, '0');

    /* کش رکوردهای تحلیل‌شده: فقط رکوردِ تازه یا ویرایش‌شده دوباره محاسبه می‌شود (برای هزاران رکورد سریع می‌ماند) */
    const BC = new WeakMap(), NC = new Map();
    const nrm = (v) => { const k = String(v == null ? '' : v); let n = NC.get(k); if (n === undefined) { n = norm(k); if (NC.size > 4000) NC.clear(); NC.set(k, n); } return n; };
    function baseOf(r, wdOf) {
        const sig = [r.date, r.time, r.quantity, r.unitPrice, r.totalPrice, r.status, r.itemCode, r.itemTitle, r.itemColor, r.durationTime, r.monthKey, r.finishedDate, r.nextCodeStartDate, r.workDuration].join('\u0001');
        const c = BC.get(r); if (c && c.sig === sig) return c.o;
        const jdn = parseJalaliDateToJdn(r.date) || 0, tm = /^(\d{1,2})/.exec(toEnglishDigits(String(r.time || ''))), dp = toEnglishDigits(String(r.date || '')).split('/');
        const o = {
            r, jdn, wd: jdn ? wdOf(jdn) : -1, dom: jdn ? (parseInt(dp[2], 10) || 0) : 0, hour: tm ? Math.min(23, +tm[1]) : -1, mk: r.monthKey,
            inc: typeof r.totalPrice === 'number' ? r.totalPrice : null, qty: num(r.quantity), unit: num(r.unitPrice),
            code: nrm(r.itemCode), codeRaw: String(r.itemCode || ''), title: r.itemTitle || '', color: r.itemColor || '',
            wn: '', wnn: '', sec: '', secn: '', late: r.status === 'تاخیر', judged: JUDGED.indexOf(r.status) >= 0, early: r.status === 'زودتر از موعد',
            dur: durMin(r.durationTime), hay: nrm([r.itemCode, r.itemTitle, r.itemColor].join(' ')),
            open: !r.nextCodeStartDate && !r.finishedDate && !!r.workDuration
        };
        BC.set(r, { sig, o }); return o;
    }
    let BUILD = null;
    function buildSig() {
        let sg = 0, n = allRecords.length; for (let i = 0; i < n; i++) sg += (allRecords[i].updatedAt || 0) % 1e9 + i;
        let m = ''; try { m = (typeof mgrOn === 'function' && mgrOn()) ? JSON.stringify([mgr().workers.map(w => [w.id, w.name, w.active, w.sectionId]), mgr().sections.map(x => [x.id, x.name])]) : ''; } catch (e) { m = 'x'; }
        return [n, sg, m, getCurrentJalaliInfo().fullDateStr, appSettings.incomeGoalMonthly, appSettings.incomeGoalWeekly, appSettings.currency, appSettings.numFormat, new Date().getHours()].join('|');
    }
    function build() {
        const sg = buildSig(); if (BUILD && BUILD.sg === sg) return BUILD.S;
        const S = build0(); BUILD = { sg, S }; return S;
    }
    function build0() {
        const jc = getCurrentJalaliInfo(), emp = (typeof mgrOn === 'function') && mgrOn();
        const T = parseJalaliDateToJdn(jc.fullDateStr) || 0, jy = parseInt(jc.yearEn, 10), jm = jc.monthNum;
        const mStart = j2d(jy, jm, 1), mEnd = (jm === 12 ? j2d(jy + 1, 1, 1) : j2d(jy, jm + 1, 1)) - 1;
        const wdMemo = {};
        const wdOf = (j) => (wdMemo[j] !== undefined ? wdMemo[j] : (wdMemo[j] = saturdayBasedDayIndex(j)));
        const recs = allRecords.filter(r => emp || recOwnerKey(r) === '').map(r => {
            const o = baseOf(r, wdOf);
            o.wn = emp ? (mgrRecWorker(r) || '') : ''; o.wnn = norm(o.wn);
            o.sec = (emp && typeof mgrRecSection === 'function') ? (mgrRecSection(r) || '') : ''; o.secn = norm(o.sec);
            return o;
        });
        const prevKey = mkAdd(jc.monthKey, -1);
        const S = { jc, emp, T, jy, jm, mStart, mEnd, wdOf, recs, day: d2j(T).jd, curKey: jc.monthKey, prevKey, dim: mEnd - mStart + 1 };
        S.m = recs.filter(x => x.mk === S.curKey); S.p = recs.filter(x => x.mk === prevKey);
        S.ws = T - wdOf(T);
        S.act = getCurrentActiveRecord();
        S.prog = S.act ? computeRecordProgress(S.act) : null;
        S.goal = num(appSettings.incomeGoalMonthly); S.goalW = num(appSettings.incomeGoalWeekly);
        S.workers = emp && mgr() && Array.isArray(mgr().workers) ? mgr().workers : [];
        S.sections = emp && mgr() && Array.isArray(mgr().sections) ? mgr().sections : [];
        return S;
    }
    function mkAdd(key, d) { const p = key.split('-').map(Number); const i = p[0] * 12 + (p[1] - 1) + d; return Math.floor(i / 12) + '-' + (i % 12 + 1); }
    const mkLabel = (key) => { const p = key.split('-').map(Number); return (PERSIAN_MONTHS[p[1] - 1] || '') + ' ' + fa(p[0]); };
    const mkOrd = (key) => { const p = key.split('-').map(Number); return p[0] * 12 + p[1]; };
    function dateStr(j) { const d = d2j(j); return fa(d.jy + '/' + pad2(d.jm) + '/' + pad2(d.jd)); }
    function dayShort(S, j) { const d = d2j(j); return WD[S.wdOf(j)] + ' ' + fa(d.jd + '/' + d.jm); }
    function dayLong(S, j) { const d = d2j(j); return WD[S.wdOf(j)] + ' ' + fa(d.jd) + ' ' + (PERSIAN_MONTHS[d.jm - 1] || ''); }

    function agg(list) {
        const o = { n: list.length, inc: 0, qty: 0, late: 0, judged: 0, priced: 0, durSum: 0, durN: 0, unitSum: 0, unitN: 0, hInc: 0, hDur: 0, dset: {} };
        list.forEach(x => {
            if (x.inc !== null) { o.inc += x.inc; o.priced++; }
            o.qty += x.qty; if (x.judged) { o.judged++; if (x.late) o.late++; }
            if (x.dur !== null) { o.durSum += x.dur; o.durN++; if (x.inc !== null && x.dur > 0) { o.hInc += x.inc; o.hDur += x.dur; } }
            if (x.unit > 0) { o.unitSum += x.unit; o.unitN++; }
            if (x.jdn) o.dset[x.jdn] = 1;
        });
        o.days = Object.keys(o.dset).length;
        return o;
    }
    const NA = null;
    const METRIC = {
        income: { l: (S) => S.emp ? 'ارزش کار' : 'درآمد', get: a => a.inc, fmt: money, up: true },
        count: { l: () => 'تعداد کارکرد', get: a => a.n, fmt: v => f(v) + ' کارکرد', up: true },
        qty: { l: () => 'مجموع تعداد', get: a => a.qty, fmt: v => f(v) + ' عدد', up: true },
        late: { l: () => 'تعداد تاخیر', get: a => a.late, fmt: v => f(v) + ' مورد', up: false },
        latepct: { l: () => 'نرخ تاخیر', get: a => a.judged ? a.late / a.judged * 100 : NA, fmt: pctS, up: false, rate: true },
        ontimepct: { l: () => 'نرخ تحویل به‌موقع', get: a => a.judged ? (a.judged - a.late) / a.judged * 100 : NA, fmt: pctS, up: true, rate: true },
        avgval: { l: () => 'میانگین ارزش هر کارکرد', get: a => a.priced ? a.inc / a.priced : NA, fmt: money, up: true },
        avgqty: { l: () => 'میانگین تعداد هر کارکرد', get: a => a.n ? a.qty / a.n : NA, fmt: v => f(v) + ' عدد', up: true },
        avgdur: { l: () => 'میانگین مدت انجام', get: a => a.durN ? a.durSum / a.durN : NA, fmt: v => formatMinutesDuration(v), up: false },
        avgunit: { l: () => 'میانگین قیمت واحد', get: a => a.unitN ? a.unitSum / a.unitN : NA, fmt: money, up: true },
        perhour: { l: () => 'بازده ساعتی', get: a => a.hDur > 0 ? a.hInc / (a.hDur / 60) : NA, fmt: v => money(v) + ' در ساعت', up: true },
        hours: { l: () => 'مجموع ساعت کار', get: a => a.durN ? a.durSum / 60 : NA, fmt: v => f(v) + ' ساعت', up: true },
        days: { l: () => 'تعداد روزهای دارای ثبت', get: a => a.days, fmt: v => f(v) + ' روز', up: true },
        perday: { l: (S) => (S.emp ? 'میانگین ارزش کار' : 'میانگین درآمد') + ' هر روز کاری', get: a => a.days ? a.inc / a.days : NA, fmt: money, up: true },
        perdayn: { l: () => 'میانگین کارکرد هر روز کاری', get: a => a.days ? a.n / a.days : NA, fmt: v => f(v) + ' کارکرد', up: true }
    };
    const mval = (key, a) => { const v = METRIC[key].get(a); return (v === null || v === undefined || !isFinite(v)) ? null : v; };

    /* ---------- بازه‌های زمانی ---------- */
    const RG = {
        days: (a, b, label) => ({ kind: 'days', from: a, to: b, label }),
        months: (keys, label, upTo) => ({ kind: 'months', keys, label, upTo: upTo || 0 }),
        year: (y, label) => ({ kind: 'year', y: String(y), label }),
        all: () => ({ kind: 'all', label: 'کل دوره' })
    };
    function inR(x, rg) {
        if (!rg) return true;
        switch (rg.kind) {
            case 'days': return x.jdn >= rg.from && x.jdn <= rg.to;
            case 'months': return rg.keys.indexOf(x.mk) >= 0 && (!rg.upTo || x.dom <= rg.upTo);
            case 'year': return String(x.mk).split('-')[0] === rg.y;
            default: return true;
        }
    }
    function prevOf(rg, S) {
        if (!rg) return null;
        if (rg.kind === 'days') {
            const len = rg.to - rg.from + 1;
            if (len === 1) return RG.days(rg.from - 1, rg.from - 1, rg.from === S.T ? 'دیروز' : 'روز قبل');
            if (rg.from === S.ws && rg.to === S.T) return RG.days(S.ws - 7, S.ws - 7 + (S.T - S.ws), 'هفته‌ی قبل (همان تعداد روز)');
            if (len === 7 && rg.from === S.ws - 7) return RG.days(rg.from - 7, rg.to - 7, 'دو هفته قبل');
            return RG.days(rg.from - len, rg.from - 1, 'بازه‌ی قبلی (' + fa(len) + ' روز)');
        }
        if (rg.kind === 'months') {
            const n = rg.keys.length, keys = rg.keys.map(k => mkAdd(k, -n));
            const partial = n === 1 && rg.keys[0] === S.curKey && !rg.upTo;
            return RG.months(keys, n === 1 ? (partial ? mkLabel(keys[0]) + ' (' + fa(S.day) + ' روز اول)' : mkLabel(keys[0])) : fa(n) + ' ماه قبل‌تر', partial ? S.day : rg.upTo);
        }
        if (rg.kind === 'year') return RG.year(+rg.y - 1, 'سال ' + fa(+rg.y - 1));
        return null;
    }

    const MONTHS_N = PERSIAN_MONTHS.map(norm);
    function extractRanges(q, S) {
        const found = [];
        q = ' ' + q + ' ';
        const T = S.T, curY = S.jy, curM = S.jm;
        const mkNow = S.curKey;
        const D = (y, m, d) => { try { return j2d(+y, +m, +d); } catch (e) { return 0; } };
        const valid = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
        const PATS = [
            [/ (?:از )?(\d{3,4})\/(\d{1,2})\/(\d{1,2}) (?:تا|الی) (\d{3,4})\/(\d{1,2})\/(\d{1,2})(?= )/g, g => { const a = D(g[0], g[1], g[2]), b = D(g[3], g[4], g[5]); return (a && b && valid(+g[1], +g[2]) && valid(+g[4], +g[5])) ? RG.days(Math.min(a, b), Math.max(a, b), 'از ' + dateStr(Math.min(a, b)) + ' تا ' + dateStr(Math.max(a, b))) : null; }],
            [/ (\d{3,4})\/(\d{1,2})\/(\d{1,2})(?= )/g, g => { const a = D(g[0], g[1], g[2]); return (a && valid(+g[1], +g[2])) ? RG.days(a, a, dateStr(a)) : null; }],
            [/ (\d{1,2})\/(\d{1,2})(?= )/g, g => { if (!valid(+g[0], +g[1])) return null; const a = D(curY, g[0], g[1]); return a ? RG.days(a, a, dateStr(a)) : null; }],
            [/ (\d{1,3}) (روز|هفته|ماه|سال) (?:ی )?(اخیر|گذشته|اخر)(?= )/g, g => { const n = +g[0]; if (!n) return null; const u = g[1];
                if (u === 'روز') return RG.days(T - n + 1, T, fa(n) + ' روز اخیر');
                if (u === 'هفته') return RG.days(T - 7 * n + 1, T, fa(n) + ' هفته‌ی اخیر');
                const cnt = u === 'ماه' ? n : 12 * n, keys = []; for (let i = 0; i < cnt; i++) keys.push(mkAdd(mkNow, -i));
                return RG.months(keys, fa(cnt) + ' ماه اخیر'); }],
            [/ (\d{1,3}) (روز|هفته|ماه) (?:ی )?(پیش|قبل)(?= )/g, g => { const n = +g[0], u = g[1];
                if (u === 'روز') return RG.days(T - n, T - n, fa(n) + ' روز پیش (' + dateStr(T - n) + ')');
                if (u === 'هفته') return RG.days(S.ws - 7 * n, S.ws - 7 * n + 6, fa(n) + ' هفته پیش');
                const k = mkAdd(mkNow, -n); return RG.months([k], mkLabel(k)); }],
            [/ (روز|هفته|ماه) (?:ی )?اخیر(?= )/g, g => g[0] === 'روز' ? RG.days(T, T, 'امروز') : g[0] === 'هفته' ? RG.days(T - 6, T, '۷ روز اخیر') : RG.days(T - 29, T, '۳۰ روز اخیر')],
            [/ پریروز(?= )/g, () => RG.days(T - 2, T - 2, 'پریروز')],
            [/ دیروز(?= )/g, () => RG.days(T - 1, T - 1, 'دیروز')],
            [/ امروز(?= )/g, () => RG.days(T, T, 'امروز')],
            [/ (?:این|همین) هفته(?= )/g, () => RG.days(S.ws, T, 'این هفته')],
            [/ هفته (?:ی )?جاری(?= )/g, () => RG.days(S.ws, T, 'این هفته')],
            [/ هفته (?:ی )?(?:قبل|گذشته|پیش|پیشین)(?= )/g, () => RG.days(S.ws - 7, S.ws - 1, 'هفته‌ی قبل')],
            [/ (?:این|همین) ماه(?= )/g, () => RG.months([mkNow], 'این ماه (' + mkLabel(mkNow) + ')')],
            [/ ماه (?:ی )?جاری(?= )/g, () => RG.months([mkNow], 'این ماه (' + mkLabel(mkNow) + ')')],
            [/ ماه (?:ی )?(?:قبل|گذشته|پیش|پیشین)(?= )/g, () => { const k = mkAdd(mkNow, -1); return RG.months([k], 'ماه قبل (' + mkLabel(k) + ')'); }],
            [/ (?:امسال|سال جاری|این سال)(?= )/g, () => RG.year(curY, 'امسال (' + fa(curY) + ')')],
            [/ (?:پارسال|سال (?:ی )?(?:قبل|گذشته))(?= )/g, () => RG.year(curY - 1, 'سال ' + fa(curY - 1))],
            [new RegExp(' (?:ماه )?(' + MONTHS_N.join('|') + ')(?: ماه)?(?: (1[34]\\d\\d))?(?= )', 'g'), g => { const mi = MONTHS_N.indexOf(g[0]) + 1; if (!mi) return null; const y = g[1] ? +g[1] : (mi > curM ? curY - 1 : curY); const k = y + '-' + mi; return RG.months([k], mkLabel(k)); }],
            [/ (1[34]\d\d)(?= )/g, g => RG.year(+g[0], 'سال ' + fa(g[0]))],
            [/ (?:تا کنون|تاکنون|تا حالا|تا الان|از ابتدا|از اول|در کل|همیشه|کل دوره|از شروع)(?= )/g, () => RG.all()]
        ];
        PATS.forEach(([re, fn]) => {
            q = q.replace(re, function () {
                const a = [].slice.call(arguments), off = a[a.length - 2], m = a[0];
                const rg = fn(a.slice(1, a.length - 2));
                if (rg) { found.push({ off, rg }); return ' '.repeat(m.length); }
                return m;
            });
        });
        found.sort((a, b) => a.off - b.off);
        return { q: q.replace(/\s+/g, ' ').trim(), ranges: found.map(x => x.rg) };
    }

    /* ============================ تحلیل پرسش ============================ */
    function vocab(S) {
        if (S.__V) return S.__V;
        const V = S.__V = { codes: {}, tok: {}, workers: [], sections: [] };
        S.recs.forEach(x => {
            if (x.code) V.codes[x.code] = x.codeRaw;
            (x.title + ' ' + x.color).split(/[\s\u200c]+/).forEach(w => { const n = stem(norm(w)); if (n.length >= 3 && !/^\d+$/.test(n)) V.tok[n] = (V.tok[n] || 0) + 1; });
        });
        const seen = {};
        S.workers.forEach(w => { if (w && w.name) { const n = norm(w.name); if (!seen[n]) { seen[n] = 1; V.workers.push({ name: w.name, n, toks: n.split(' ').filter(t => t.length >= 2) }); } } });
        S.recs.forEach(x => { if (x.wn && !seen[x.wnn]) { seen[x.wnn] = 1; V.workers.push({ name: x.wn, n: x.wnn, toks: x.wnn.split(' ').filter(t => t.length >= 2) }); } });
        S.sections.forEach(s => { if (s && s.name) { const n = norm(s.name); V.sections.push({ name: s.name, n, toks: n.split(' ').filter(t => t.length >= 2) }); } });
        return V;
    }
    const nearN = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && near(a, b));

    function newFilters() { return { codes: [], workers: [], sections: [], status: null, wd: null, text: [], minV: null, maxV: null, minQ: null, maxQ: null }; }

    function parse(raw, S, V) {
        let q = wordNums(norm(raw));
        const P = { raw, filters: newFilters(), range: null, ranges: [], metric: null, metricExplicit: false, dim: null, sup: null, topN: null, intent: null, ambig: null, unknown: [], flags: {}, entities: 0 };
        q = q.split(' ').map(w => { if (w.length < 4 || w.length > 7) return w; for (const k of ['امروز', 'دیروز', 'پریروز', 'پارسال', 'امسال']) if (w !== k && lev(w, k, 1) <= 1 && !(V.tok[stem(w)])) return k; return w; }).join(' ');
        const ex = extractRanges(q, S); q = ex.q; P.ranges = ex.ranges; P.range = ex.ranges[0] || null;
        const F = P.filters;

        /* آستانه‌ها: «بالای ۲ میلیون»، «حداقل ۵ عدد» */
        q = (' ' + q + ' ').replace(/ (بالای|بالاتر از|بیشتر از|بیش از|حداقل|کمتر از|زیر|پایین تر از|حداکثر|تا سقف) (\d+(?:\.\d+)?) ?(میلیون|هزار|میلیارد|تومان|تومن|ریال|عدد|تا|دانه|قطعه)?(?= )/g, (m, w, n, u) => {
            let v = parseFloat(n); const mult = { میلیون: 1e6, هزار: 1e3, میلیارد: 1e9 }[u] || 1; v *= mult;
            const isQty = (u === 'عدد' || u === 'تا' || u === 'دانه' || u === 'قطعه') || (!u && v < 1000);
            const isMin = /^(بالای|بالاتر|بیشتر|بیش|حداقل)/.test(w);
            if (isQty) { if (isMin) F.minQ = v; else F.maxQ = v; } else { if (isMin) F.minV = v; else F.maxV = v; }
            return ' '.repeat(m.length);
        }).replace(/\s+/g, ' ').trim();

        /* روز هفته به‌عنوان فیلتر */
        q = (' ' + q + ' ').replace(/ (شنبه|یکشنبه|دوشنبه|سهشنبه|چهارشنبه|پنجشنبه|جمعه)(?:ها| ها|هایی)?(?= )/g, (m, w) => { F.wd = ['شنبه', 'یکشنبه', 'دوشنبه', 'سهشنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'].indexOf(w); return ' '; }).replace(/\s+/g, ' ').trim();

        /* کد: «کد ۶۴۴۹» یا خودِ شماره‌ی شناخته‌شده */
        const toks = q.split(' ').filter(Boolean), keep = [];
        const knownCode = (t) => Object.prototype.hasOwnProperty.call(V.codes, t);
        for (let i = 0; i < toks.length; i++) {
            const t = toks[i], nx = toks[i + 1];
            if ((t === 'کد' || t === 'code' || t === 'کدی') && nx && (knownCode(nx) || /^[a-z0-9][\w\-\/]*$/.test(nx))) {
                F.codes.push({ n: nx, raw: V.codes[nx] || nx, known: knownCode(nx) }); i++; continue;
            }
            if (knownCode(t) && (t.length >= 3 || /[a-z]/.test(t)) && !/^(1[34]\d\d)$/.test(t)) { F.codes.push({ n: t, raw: V.codes[t], known: true }); continue; }
            keep.push(t);
        }
        F.codes = F.codes.filter((c, i, a) => a.findIndex(z => z.n === c.n) === i);
        q = keep.join(' ');

        /* پرسنل و بخش (فقط حالت کارفرما) */
        const qt = q.split(' ').filter(Boolean);
        const used = {};
        if (S.emp && V.workers.length) {
            const sc = V.workers.map(w => {
                let s = 0, via = [];
                if (w.n.length >= 3 && (' ' + q + ' ').indexOf(' ' + w.n + ' ') >= 0 && w.toks.length > 1) { s = w.toks.length + 1; w.toks.forEach(t => { const i = qt.indexOf(t); if (i >= 0) via.push(i); }); }
                else w.toks.forEach(t => { qt.forEach((z, i) => { if (z.length >= 2 && nearN(z, t) && LX.stop.indexOf(z) < 0 && !isLexWord(z)) { s++; via.push(i); } }); });
                return { w, s, via };
            }).filter(x => x.s > 0);
            if (sc.length) {
                const mx = Math.max.apply(null, sc.map(x => x.s)), top = sc.filter(x => x.s === mx);
                if (top.length > 1 && mx === 1) { const tk = qt.find(z => top.every(x => x.w.toks.some(t => nearN(z, t)))); P.ambig = { type: 'worker', list: top.map(x => x.w.name), tok: tk || '' }; }
                else { top.forEach(x => { F.workers.push({ n: x.w.n, name: x.w.name }); x.via.forEach(i => used[i] = 1); }); }
            }
        }
        if (S.emp && V.sections.length) {
            const idx = qt.indexOf('بخش');
            V.sections.forEach(s => {
                const hit = s.toks.some(t => qt.some((z, i) => !used[i] && z.length >= 3 && nearN(z, t) && i !== idx));
                if (hit && (' ' + q + ' ').indexOf(' ' + s.n.split(' ')[0]) >= 0) { F.sections.push({ n: s.n, name: s.name }); s.toks.forEach(t => qt.forEach((z, i) => { if (nearN(z, t)) used[i] = 1; })); }
            });
        }
        P.entities = F.codes.length + F.workers.length + F.sections.length;
        P.qualSection = F.sections.length > 0; P.qualWorker = F.workers.length > 0;
        q = qt.filter((z, i) => !used[i]).join(' ');

        /* عدد باقی‌مانده = تعداد نتایج (۵ کد برتر) */
        q = (' ' + q + ' ').replace(/ (\d{1,2}) (?!\d)/, (m, n) => { if (+n >= 1 && +n <= 50) { P.topN = +n; return ' '; } return m; }).replace(/\s+/g, ' ').trim();

        /* واژگان */
        const Q = mkQ(q), P0count = q.split(' ').filter(Boolean).length;
        const fl = P.flags;
        fl.greet = take(Q, 'greet'); fl.thanks = take(Q, 'thanks'); fl.help = take(Q, 'help', true);
        take(Q, 'd_status');
        fl.why = take(Q, 'why'); fl.forecast = take(Q, 'forecast', true); fl.goal = take(Q, 'goal');
        fl.compare = take(Q, 'compare', true); fl.anomaly = take(Q, 'anomaly', true); fl.streak = take(Q, 'streak');
        fl.idle = take(Q, 'idle'); fl.quality = take(Q, 'quality'); fl.tips = take(Q, 'tips', true);
        fl.analysis = take(Q, 'analysis', true); fl.summary = take(Q, 'summary', true);
        fl.last = take(Q, 'last'); fl.first = take(Q, 'first'); fl.list = take(Q, 'list'); fl.find = take(Q, 'find');
        fl.more = P0count <= 3 ? take(Q, 'more') : false; fl.pron = take(Q, 'pron');
        fl.stLate = take(Q, 'st_late'); fl.stEarly = take(Q, 'st_early');
        fl.who = take(Q, 'who');
        fl.active = take(Q, 'active', true);
        const mh = take(Q, 'm_perhour'), mhrs = take(Q, 'm_hours'), mdays = take(Q, 'm_days');
        const mcount = take(Q, 'm_count'), mqty = take(Q, 'm_qty'), minc = take(Q, 'm_income', true);
        const mlate = take(Q, 'm_late', true), mon = take(Q, 'm_ontime', true), mdur = take(Q, 'm_dur'), munit = take(Q, 'm_unit');
        fl.rate = take(Q, 'rate'); fl.avg = take(Q, 'avg', true);
        const dW = take(Q, 'd_weekday'), dHr = take(Q, 'd_hour'), dD = take(Q, 'd_day'), dWk = take(Q, 'd_week'), dMo = take(Q, 'd_month');
        const dC = take(Q, 'd_code'), dWo = take(Q, 'd_worker'), dSe = take(Q, 'd_section'), dCo = take(Q, 'd_color'), dTi = take(Q, 'd_title');
        const smax = take(Q, 'sup_max'), smin = take(Q, 'sup_min');
        fl.busy = has({ W: ' ' + norm(raw).split(' ').map(stem).join(' ') + ' ' }, 'busy');
        fl.late = mlate; fl.ontime = mon;

        if (smin) P.sup = 'min'; else if (smax) P.sup = 'max';
        if (fl.stLate) F.status = 'late'; if (fl.stEarly) F.status = 'early';

        /* بُعد گروه‌بندی */
        P.dim = dW ? 'weekday' : dHr ? 'hour' : dC ? 'code' : dSe ? 'section' : dCo ? 'color' : dTi ? 'title' : dWo ? 'worker' : dWk ? 'week' : dMo ? 'month' : dD ? 'day' : null;
        if (P.dim === 'section' && P.qualSection) P.dim = null;
        if (P.dim === 'worker' && P.qualWorker && !fl.who) P.dim = null;
        if (fl.who && !P.dim) P.dim = S.emp ? 'worker' : 'day';
        /* «ساعت» تنها بدون پرسش/برترین، بُعد نیست */
        if (P.dim === 'hour' && !P.sup && !/(کدام|کدوم|چه ساعتی|ساعات|هر ساعت|پرکار)/.test(norm(raw))) P.dim = null;
        if ((P.dim === 'day' || P.dim === 'week' || P.dim === 'month') && P.range && P.range.kind === 'days' && P.range.from === P.range.to) P.dim = null;

        /* سنجه */
        let m = null;
        if (mh) m = 'perhour'; else if (mhrs) m = 'hours'; else if (mdays) m = 'days';
        else if (mlate) m = fl.rate ? 'latepct' : 'late';
        else if (mon) m = 'ontimepct';
        else if (mdur) m = 'avgdur'; else if (munit) m = 'avgunit';
        else if (mcount) m = 'count'; else if (mqty) m = 'qty'; else if (minc) m = 'income';
        if (fl.avg && m) {
            if (m === 'income') m = (P.dim === 'day') ? 'perday' : 'avgval';
            else if (m === 'count' && P.dim === 'day') m = 'perdayn';
            else if (m === 'qty') m = 'avgqty';
            if ((m === 'perday' || m === 'perdayn') && P.dim === 'day') P.dim = null;
        }
        if (m === 'late' && fl.rate) m = 'latepct';
        P.metric = m; P.metricExplicit = !!m;
        if (m === 'hours' || m === 'days') { /* مستقل از بُعد */ }

        /* واژه‌های باقی‌مانده: عنوان/رنگ */
        const left = Q.W.trim().split(' ').filter(w => w && LX.stop.indexOf(w) < 0 && !/^\d+$/.test(w) && w.length >= 3);
        left.forEach(w => {
            if (V.tok[w]) { F.text.push({ n: w, raw: w }); return; }
            let best = null; Object.keys(V.tok).forEach(k => { if (nearN(w, k) && (!best || V.tok[k] > V.tok[best])) best = k; });
            if (best) F.text.push({ n: best, raw: best }); else P.unknown.push(w);
        });
        F.text = F.text.filter((t, i, a) => a.findIndex(z => z.n === t.n) === i);
        P.tokenCount = norm(raw).split(' ').filter(Boolean).length;
        return P;
    }
    function isLexWord(z) {
        const s = stem(z);
        for (const k in LX) { if (k === 'stop') continue; for (const p of LX[k]) { const c = ph(p); if (c.single && c.single === s) return true; } }
        return false;
    }

    /* ============================ فیلتر و گروه‌بندی ============================ */
    function matchRec(x, F) {
        if (F.codes.length && !F.codes.some(c => c.n === x.code)) return false;
        if (F.workers.length && !F.workers.some(w => w.n === x.wnn)) return false;
        if (F.sections.length && !F.sections.some(s => s.n === x.secn)) return false;
        if (F.status === 'late' && !x.late) return false;
        if (F.status === 'early' && !x.early) return false;
        if (F.status === 'ontime' && !(x.judged && !x.late)) return false;
        if (F.wd !== null && x.wd !== F.wd) return false;
        if (F.text.length && !F.text.every(t => x.hay.indexOf(t.n) >= 0)) return false;
        if (F.minV !== null && !(x.inc !== null && x.inc >= F.minV)) return false;
        if (F.maxV !== null && !(x.inc !== null && x.inc <= F.maxV)) return false;
        if (F.minQ !== null && !(x.qty >= F.minQ)) return false;
        if (F.maxQ !== null && !(x.qty <= F.maxQ)) return false;
        return true;
    }
    const gather = (S, P, rg) => S.recs.filter(x => inR(x, rg) && matchRec(x, P.filters));
    function fLabel(P) {
        const F = P.filters, a = [];
        F.codes.forEach(c => a.push('کد ' + fa(c.raw))); F.workers.forEach(w => a.push(w.name)); F.sections.forEach(s => a.push('بخش ' + s.name));
        if (F.status) a.push({ late: 'تاخیردار', early: 'زودتر از موعد', ontime: 'به‌موقع' }[F.status]);
        if (F.wd !== null) a.push('روزهای ' + WD[F.wd]); if (F.text.length) a.push('«' + F.text.map(t => t.raw).join(' ') + '»');
        if (F.minV !== null) a.push('ارزش ≥ ' + f(F.minV)); if (F.maxV !== null) a.push('ارزش ≤ ' + f(F.maxV));
        if (F.minQ !== null) a.push('تعداد ≥ ' + f(F.minQ)); if (F.maxQ !== null) a.push('تعداد ≤ ' + f(F.maxQ));
        return a.join(' · ');
    }
    const hasFilter = (P) => !!fLabel(P);

    function dimDef(d, S) {
        const D = {
            day: { key: x => x.jdn || null, name: k => dayShort(S, k), chrono: true, order: (a, b) => a - b },
            weekday: { key: x => x.wd >= 0 ? x.wd : null, name: k => WD[k], chrono: true, order: (a, b) => a - b },
            hour: { key: x => x.hour >= 0 ? x.hour : null, name: k => fa(k) + ':۰۰ تا ' + fa(k + 1) + ':۰۰', chrono: true, order: (a, b) => a - b },
            week: { key: x => x.jdn ? x.jdn - S.wdOf(x.jdn) : null, name: k => 'هفته‌ی ' + dateStr(k).split('/').slice(1).join('/'), chrono: true, order: (a, b) => a - b },
            month: { key: x => x.mk, name: k => mkLabel(k), chrono: true, order: (a, b) => mkOrd(a) - mkOrd(b) },
            code: { key: x => x.code || null, name: (k, l) => 'کد ' + fa(l[0].codeRaw) + (l[0].title ? ' — ' + l[0].title : '') },
            worker: { key: x => x.wnn || null, name: (k, l) => l[0].wn },
            section: { key: x => x.secn || null, name: (k, l) => l[0].sec },
            color: { key: x => norm(x.color) || null, name: (k, l) => l[0].color },
            title: { key: x => norm(x.title) || null, name: (k, l) => l[0].title }
        };
        return D[d];
    }
    function groupBy(list, d, S) {
        const D = dimDef(d, S), g = new Map();
        list.forEach(x => { const k = D.key(x); if (k === null || k === undefined) return; if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
        const rows = []; g.forEach((l, k) => rows.push({ k, name: D.name(k, l), list: l, a: agg(l) }));
        return { rows, D };
    }
    const DIM_LABEL = { day: 'روز', weekday: 'روز هفته', hour: 'ساعت', week: 'هفته', month: 'ماه', code: 'کد', worker: 'پرسنل', section: 'بخش', color: 'رنگ', title: 'مدل' };

    /* ============================ بلوک‌های پاسخ ============================ */
    const B = {
        h: (t) => ({ k: 'h', t }), p: (t) => ({ k: 'p', t }), note: (t, tone) => ({ k: 'note', t, tone }),
        big: (label, value, sub, tone) => ({ k: 'big', label, value, sub, tone }),
        kv: (rows) => ({ k: 'kv', rows }), bars: (rows) => ({ k: 'bars', rows }),
        table: (head, rows) => ({ k: 'table', head, rows }), list: (items) => ({ k: 'list', items }),
        spark: (vals, labels, hi) => ({ k: 'spark', vals, labels, hi }), prog: (label, pct, right, tone) => ({ k: 'prog', label, pct, right, tone }),
        finds: (items) => ({ k: 'finds', items })
    };
    function delta(c, p, up) {
        if (c === null || p === null || p === undefined) return null;
        if (p === 0) return { t: c === 0 ? 'بدون تغییر نسبت به دوره‌ی قبل' : 'دوره‌ی قبل صفر بوده است', tone: 'info', d: null };
        const d = (c - p) / Math.abs(p) * 100, upD = d >= 0, tone = Math.abs(d) < 1 ? 'info' : (upD === (up !== false) ? 'good' : 'warn');
        return { t: (upD ? '▲ ' : '▼ ') + f(Math.abs(d)) + '٪ ' + (upD ? 'بیشتر' : 'کمتر') + ' از دوره‌ی قبل', tone, d };
    }
    const dlt = (key, a, b) => delta(mval(key, a), b ? mval(key, b) : null, METRIC[key].up);
    function barsFor(rows, key, S, max) {
        const vals = rows.map(r => mval(key, r.a)).filter(v => v !== null), mx = Math.max.apply(null, vals.concat([1]));
        return B.bars(rows.slice(0, max || 12).map(r => { const v = mval(key, r.a); return { l: r.name, t: v === null ? '—' : METRIC[key].fmt(v), w: v === null ? 0 : Math.max(2, v / mx * 100), hi: r.hi }; }));
    }
    function toPlain(blocks) {
        return blocks.map(b => {
            switch (b.k) {
                case 'h': case 'p': case 'note': return b.t.replace(/\*\*/g, '');
                case 'big': return b.label + ': ' + b.value + (b.sub ? ' (' + b.sub + ')' : '');
                case 'kv': return b.rows.map(r => r[0] + ': ' + r[1]).join('\n');
                case 'bars': return b.rows.map(r => '• ' + r.l + ': ' + r.t).join('\n');
                case 'table': return [b.head.join(' | ')].concat(b.rows.map(r => r.map(c => (c && c.t !== undefined) ? c.t : c).join(' | '))).join('\n');
                case 'list': return b.items.map(i => '• ' + i).join('\n');
                case 'finds': return b.items.map(i => '• ' + i.x).join('\n');
                case 'prog': return b.label + ': ' + (b.right || f(b.pct) + '٪');
                default: return '';
            }
        }).filter(Boolean).join('\n').replace(/\*\*/g, '');
    }

    /* ============================ پیش‌بینی و آمار ============================ */
    function dailyIncome(S, fromJ, toJ, list) {
        const m = new Map();
        (list || S.recs).forEach(x => { if (x.jdn >= fromJ && x.jdn <= toJ) { const a = m.get(x.jdn) || { inc: 0, n: 0 }; a.inc += x.inc || 0; a.n++; m.set(x.jdn, a); } });
        return m;
    }
    function expectation(S, list) {
        const src = list || S.recs; let first = 0;
        src.forEach(x => { if (x.jdn && (!first || x.jdn < first)) first = x.jdn; });
        const from = Math.max(S.T - 56, first || S.T), to = S.T - 1;
        const dm = dailyIncome(S, from, to, src), by = [[], [], [], [], [], [], []], all = [];
        for (let j = from; j <= to; j++) { const v = dm.get(j) ? dm.get(j).inc : 0; by[S.wdOf(j)].push(v); all.push(v); }
        const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
        const mAll = mean(all), sd = all.length > 1 ? Math.sqrt(mean(all.map(v => (v - mAll) * (v - mAll)))) : 0;
        const E = by.map(a => a.length >= 2 ? mean(a) : mAll);
        return { E, sd, mAll, nDays: all.length, workMean: mean(all.filter(v => v > 0)) };
    }
    function project(S, endJ, soFar, list) {
        const ex = expectation(S, list), todayInc = sum((list || S.recs).filter(x => x.jdn === S.T), x => x.inc || 0);
        let rem = Math.max(0, ex.E[S.wdOf(S.T)] - todayInc), cnt = 0;
        for (let j = S.T + 1; j <= endJ; j++) { rem += ex.E[S.wdOf(j)]; if (ex.E[S.wdOf(j)] > 0) cnt++; }
        const proj = soFar + rem, spread = ex.sd * Math.sqrt(Math.max(1, cnt)) * 0.7;
        return { proj, low: Math.max(soFar, proj - spread), high: proj + spread, ex, workLeft: cnt + (ex.E[S.wdOf(S.T)] > 0 ? 1 : 0), conf: ex.nDays >= 21 ? 'خوب' : ex.nDays >= 10 ? 'متوسط' : 'کم' };
    }
    function streaks(S) {
        const days = {}; S.recs.forEach(x => { if (x.jdn) days[x.jdn] = 1; });
        const keys = Object.keys(days).map(Number).sort((a, b) => a - b);
        if (!keys.length) return { cur: 0, best: 0, bestEnd: 0 };
        let best = 0, bestEnd = 0, run = 0, prev = 0;
        keys.forEach(j => {
            const gap = prev ? j - prev : 1, fri = prev && gap === 2 && S.wdOf(prev + 1) === 6;
            run = (!prev || gap === 1 || fri) ? run + 1 : 1; if (run > best) { best = run; bestEnd = j; } prev = j;
        });
        let cur2 = 0, j = S.T; if (!days[j]) j--;
        if (S.wdOf(j) === 6 && !days[j]) j--;
        while (true) { if (days[j]) { cur2++; j--; } else if (S.wdOf(j) === 6 && days[j - 1]) { j--; } else break; }
        return { cur: cur2, best, bestEnd };
    }
    function idleDays(S, from, to) {
        const has2 = {}; S.recs.forEach(x => { if (x.jdn) has2[x.jdn] = 1; });
        const out = []; for (let j = from; j <= to; j++) if (!has2[j] && S.wdOf(j) !== 6) out.push(j);
        return out;
    }
    function anomalies(S) {
        const out = [], from = S.T - 45, dm = dailyIncome(S, from, S.T), vals = [];
        dm.forEach((v, j) => { if (j < S.T) vals.push(v.inc); });
        if (vals.length >= 7) {
            const mu = vals.reduce((a, b) => a + b, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) * (b - mu), 0) / vals.length);
            if (sd > 0) dm.forEach((v, j) => { if (j >= S.T) return; const z = (v.inc - mu) / sd; if (Math.abs(z) >= 1.8) out.push({ t: z > 0 ? 'good' : 'warn', x: `${dayLong(S, j)}: ${money(v.inc)} — ${z > 0 ? 'خیلی بالاتر' : 'خیلی پایین‌تر'} از روز معمولی (میانگین ${money(mu)})`, j }); });
        }
        /* قیمت واحد یا تعداد پرت در هر کد */
        const byCode = new Map(); S.recs.forEach(x => { if (x.code) { if (!byCode.has(x.code)) byCode.set(x.code, []); byCode.get(x.code).push(x); } });
        const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
        byCode.forEach(l => {
            if (l.length < 4) return;
            const mu = med(l.filter(x => x.unit > 0).map(x => x.unit)), mq = med(l.map(x => x.qty));
            l.forEach(x => {
                if (mu && x.unit > 0 && Math.abs(x.unit - mu) / mu > 0.3 && x.jdn >= S.T - 45) out.push({ t: 'warn', x: `قیمت واحد کد ${fa(x.codeRaw)} در ${x.r.date} برابر ${money(x.unit)} است؛ معمولاً حدود ${money(mu)}`, j: x.jdn });
                if (mq > 0 && x.qty > mq * 3 && x.qty - mq > 20 && x.jdn >= S.T - 45) out.push({ t: 'warn', x: `تعداد کد ${fa(x.codeRaw)} در ${x.r.date} برابر ${f(x.qty)} عدد ثبت شده؛ معمولاً حدود ${f(mq)} (شاید اشتباه تایپی)`, j: x.jdn });
            });
        });
        return out.sort((a, b) => b.j - a.j);
    }

    /* ============================ یافته‌های تحلیلی ============================ */
    function findings(S) {
        const out = [], c = cur(), lab = S.emp ? 'ارزش کار' : 'درآمد';
        const m = agg(S.m), prevSame = agg(S.p.filter(x => x.dom <= S.day));
        if (!S.m.length) { out.push({ i: 'fa-circle-info', t: 'info', x: `در ${S.jc.monthName} هنوز کارکردی ثبت نشده است. بعد از ثبت اولین رکورد، تحلیل اینجا ظاهر می‌شود.` }); return out; }
        if (S.act && S.prog) {
            const rm = S.prog.remainingMinutes, name = S.act.itemTitle || S.act.itemCode || 'کار جاری';
            out.push(rm < 0 ? { i: 'fa-triangle-exclamation', t: 'warn', x: `«${name}» از موعد گذشته و هنوز تمام نشده است.` }
                : { i: 'fa-stopwatch', t: S.prog.percent >= 85 ? 'warn' : 'info', x: `«${name}» ${f(Math.min(S.prog.percent, 999))}٪ پیش رفته و حدود ${f(rm / 60)} ساعت تا موعد مانده است.` });
        }
        const today = agg(S.recs.filter(x => x.jdn === S.T));
        out.push({ i: 'fa-sun', t: today.n ? 'good' : 'info', x: today.n ? `امروز ${f(today.n)} کارکرد (${f(today.inc)} ${c}) ثبت شده است.` : 'امروز هنوز کارکردی ثبت نشده است.' });
        out.push({ i: 'fa-coins', t: 'info', x: `تا امروز ${f(m.inc)} ${c} از ${f(m.n)} کارکرد (${f(m.qty)} عدد) ثبت شده است.` });
        if (S.day >= 3 && m.inc > 0) {
            const pr = project(S, S.mEnd, m.inc, S.recs);
            let cmp = ''; const pm = agg(S.p).inc;
            if (pm > 0) { const d = Math.round((pr.proj - pm) / pm * 100); cmp = d >= 0 ? `؛ حدود ${f(d)}٪ بیشتر از ماه قبل` : `؛ حدود ${f(-d)}٪ کمتر از ماه قبل`; }
            out.push({ i: 'fa-chart-line', t: 'info', x: `با الگوی روزهای هفته، پایان ماه حدود ${f(pr.proj)} ${c} می‌شود${cmp}.` });
        }
        if (S.goal > 0) {
            const left = S.goal - m.inc, dl = Math.max(1, S.dim - S.day + 1);
            out.push(left <= 0 ? { i: 'fa-trophy', t: 'good', x: 'هدف درآمد ماهانه محقق شد. آفرین!' } : { i: 'fa-bullseye', t: 'info', x: `برای هدف ماهانه، روزی حدود ${f(left / dl)} ${c} لازم است (${f(left)} ${c} باقی مانده).` });
        }
        if (S.m.length >= 3) out.push(m.late ? { i: 'fa-clock', t: 'warn', x: `${f(m.late)} از ${f(m.judged || m.n)} کارکرد (${f(m.late / (m.judged || m.n) * 100)}٪) با تاخیر تحویل شده است.` } : { i: 'fa-circle-check', t: 'good', x: 'همه‌ی کارهای این ماه به موقع تحویل شده‌اند.' });
        /* روند ۷ روز اخیر در برابر ۷ روز قبل از آن */
        const w1 = sum(S.recs.filter(x => x.jdn > S.T - 7 && x.jdn <= S.T), x => x.inc || 0), w0 = sum(S.recs.filter(x => x.jdn > S.T - 14 && x.jdn <= S.T - 7), x => x.inc || 0);
        if (w0 > 0 && w1 > 0) { const d = Math.round((w1 - w0) / w0 * 100); if (Math.abs(d) >= 10) out.push({ i: d > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', t: d > 0 ? 'good' : 'warn', x: `${lab} ۷ روز اخیر ${f(Math.abs(d))}٪ ${d > 0 ? 'بیشتر' : 'کمتر'} از هفته‌ی قبل از آن بوده است.` }); }
        const st = streaks(S); if (st.cur >= 5) out.push({ i: 'fa-fire', t: 'good', x: `${f(st.cur)} روز کاری پشت سر هم کارکرد ثبت کرده‌اید.` });
        /* تمرکز روی یک کد */
        const g = groupBy(S.m, 'code', S);
        if (g.rows.length >= 3 && m.inc > 0) { const top = g.rows.slice().sort((a, b) => b.a.inc - a.a.inc)[0], sh = top.a.inc / m.inc * 100; if (sh >= 55) out.push({ i: 'fa-chart-pie', t: 'info', x: `${f(sh)}٪ ${lab} این ماه فقط از کد ${fa(top.list[0].codeRaw)} آمده است.` }); }
        if (S.emp === false && S.m.length >= 8) { const wd = [0, 0, 0, 0, 0, 0, 0]; S.recs.forEach(x => { if (x.wd >= 0) wd[x.wd]++; }); if (Math.max.apply(null, wd) > 0) out.push({ i: 'fa-calendar-week', t: 'info', x: `پرکارترین روز هفته‌ی شما «${WD[wd.indexOf(Math.max.apply(null, wd))]}» است.` }); }
        const unk = S.m.filter(x => x.inc === null).length; if (unk) out.push({ i: 'fa-circle-question', t: 'warn', x: `${f(unk)} کارکرد قیمت ندارد؛ ${lab} واقعی بیشتر از عدد بالاست.` });
        return out;
    }
    const insights = (S) => findings(S).slice(0, 7);


    /* ============================ پاسخ‌دهنده‌ها ============================ */
    const R = (blocks, chips) => ({ blocks, chips: (chips || []).filter(Boolean).slice(0, 4) });
    const rangeLbl = (rg, dflt) => rg ? rg.label : dflt;
    const lab = (S) => S.emp ? 'ارزش کار' : 'درآمد';
    const recLine = (x) => `• کد ${fa(x.codeRaw || '-')} — ${x.title || ''}${x.color ? ' ' + x.color : ''} (${x.r.date || ''}${x.r.time ? ' ' + x.r.time : ''})`;
    const recLine2 = (S, x) => `${recLine(x)}${x.wn ? ' · ' + x.wn : ''} · ${f(x.qty)} عدد${x.inc !== null ? ' · ' + money(x.inc) : ''}${x.late ? ' · تاخیر' : ''}`;
    const defaultRange = (S, P, kind) => {
        if (P.range) return P.range;
        if (kind === 'all') return RG.all();
        return RG.months([S.curKey], 'این ماه (' + mkLabel(S.curKey) + ')');
    };
    const emptyAns = (S, P, rg) => R([B.p('در «' + rg.label + '»' + (hasFilter(P) ? ' برای (' + fLabel(P) + ')' : '') + ' کارکردی پیدا نشد.'),
        B.note(lastDataHint(S, P), 'info')], hasFilter(P) ? ['همین را برای کل دوره'] : ['این هفته', 'ماه قبل', 'راهنما']);
    function lastDataHint(S, P) {
        const l = S.recs.filter(x => matchRec(x, P.filters)).sort((a, b) => b.jdn - a.jdn)[0];
        return l ? 'آخرین ثبت مرتبط: ' + l.r.date + ' (' + (l.title || 'کد ' + fa(l.codeRaw)) + ').' : 'هنوز هیچ ثبتی با این مشخصات وجود ندارد.';
    }
    function flagNeedEmployer(S, what) { return R([B.p(what + ' فقط در حالت کارفرما در دسترس است. در حالت پرسنل فقط کارکردهای خودتان تحلیل می‌شود.')], ['خلاصه‌ی این ماه', 'راهنما']); }

    /* ---------- نمای کلی / پروفایل (کد، پرسنل، بخش، عنوان، بازه) ---------- */
    function aOverview(S, P) {
        const F = P.filters, entityOnly = !!(F.codes.length || F.workers.length || F.sections.length || F.text.length);
        const rg = P.range || (entityOnly && !F.workers.length && !F.sections.length ? RG.all() : defaultRange(S, P));
        const list = gather(S, P, rg), a = agg(list), L = fLabel(P);
        if (F.codes.length === 1 && !F.codes[0].known) {
            const sim = Object.keys(vocab(S).codes).filter(k => near(k, F.codes[0].n) || k.indexOf(F.codes[0].n) === 0).slice(0, 3);
            return R([B.p(`کدی با شماره‌ی «${fa(F.codes[0].raw)}» پیدا نشد.`), sim.length ? B.note('شاید منظورتان یکی از این کدها بود:', 'info') : B.note('شماره را دوباره بررسی کنید.', 'info')], sim.map(k => 'کد ' + k));
        }
        if (!list.length) return emptyAns(S, P, rg);
        const title = (L || 'همه‌ی کارکردها') + ' — ' + rg.label;
        const blocks = [B.big(title, METRIC.income.fmt(a.inc), `${f(a.n)} کارکرد · ${f(a.qty)} عدد`, 'info')];
        const rows = [];
        if (a.n && a.priced) rows.push(['میانگین ارزش هر کارکرد', money(a.inc / a.priced)]);
        if (a.n) rows.push(['میانگین تعداد هر کارکرد', f(a.qty / a.n) + ' عدد']);
        if (a.unitN) { const us = list.filter(x => x.unit > 0).map(x => x.unit), mn = Math.min.apply(null, us), mx = Math.max.apply(null, us); rows.push(['قیمت واحد', mn === mx ? money(mn) : `${money(mn)} تا ${money(mx)} (میانگین ${money(a.unitSum / a.unitN)})`]); }
        if (a.durN) rows.push(['میانگین مدت انجام', formatMinutesDuration(a.durSum / a.durN)]);
        if (a.hDur > 0) rows.push(['بازده ساعتی', money(a.hInc / (a.hDur / 60)) + ' در ساعت']);
        if (a.judged) rows.push(['نرخ تحویل به‌موقع', pctS((a.judged - a.late) / a.judged * 100) + (a.late ? ` (${f(a.late)} تاخیر)` : ' — بدون تاخیر')]);
        if (a.days > 1) rows.push(['روزهای دارای ثبت', f(a.days)]);
        blocks.push(B.kv(rows));
        /* مقایسه با دوره‌ی قبل */
        const pr = prevOf(rg, S);
        if (pr) { const pa = agg(gather(S, P, pr)); const d = dlt('income', a, pa); if (d && pa.n) blocks.push(B.note(`${d.t} (${pr.label}: ${money(pa.inc)})`, d.tone)); }
        /* سهم از کل و رتبه */
        if (F.codes.length === 1 || F.workers.length === 1 || F.sections.length === 1 || F.text.length) {
            const tot = agg(S.recs.filter(x => inR(x, rg))); if (tot.inc > 0 && a.inc > 0) blocks.push(B.note(`سهم از کل ${lab(S)} در این بازه: ${pctS(a.inc / tot.inc * 100)}`, 'info'));
        }
        if (F.codes.length === 1) {
            const g = groupBy(S.recs.filter(x => inR(x, rg)), 'code', S).rows.sort((x, y) => y.a.inc - x.a.inc), rk = g.findIndex(r => r.k === F.codes[0].n) + 1;
            if (rk) blocks.push(B.note(`رتبه‌ی ${f(rk)} از ${f(g.length)} کد از نظر ${lab(S)}.`, 'info'));
            if (S.emp) { const w = groupBy(list, 'worker', S).rows.sort((x, y) => y.a.n - x.a.n).slice(0, 3); if (w.length) blocks.push(B.note('بیشتر انجام‌دهنده‌ها: ' + w.map(r => `${r.name} (${f(r.a.n)})`).join('، '), 'info')); }
        }
        if (F.workers.length === 1 && typeof mgrWorkerState === 'function') {
            const w = S.workers.find(z => norm(z.name) === F.workers[0].n);
            if (w) { try { const st = mgrWorkerState(w); if (st.rec) blocks.push(B.note(`کار جاری: ${st.rec.itemTitle || 'کد ' + fa(st.rec.itemCode)} — ${f(Math.min(st.pct, 999))}٪ پیش رفته${st.p && st.p.remainingMinutes < 0 ? ' (از موعد گذشته)' : ''}`, st.key === 'late' ? 'warn' : 'info')); else blocks.push(B.note('الان کار جاری‌ای ندارد.', 'info')); } catch (e) { /* ندارد */ } }
            const team = agg(S.recs.filter(x => inR(x, rg) && x.wnn)), nW = groupBy(S.recs.filter(x => inR(x, rg) && x.wnn), 'worker', S).rows.length;
            if (nW > 1 && team.inc > 0) { const avgTeam = team.inc / nW, d = Math.round((a.inc - avgTeam) / avgTeam * 100); blocks.push(B.note(`${lab(S)} او ${f(Math.abs(d))}٪ ${d >= 0 ? 'بیشتر' : 'کمتر'} از میانگین پرسنل است.`, d >= 0 ? 'good' : 'warn')); }
        }
        if (F.sections.length === 1) { const w = groupBy(list, 'worker', S).rows.sort((x, y) => y.a.inc - x.a.inc).slice(0, 4); if (w.length) blocks.push(barsFor(w, 'income', S)); }
        if (rg.kind !== 'days' || rg.to > rg.from) {
            const dd = groupBy(list, 'day', S).rows.sort((x, y) => x.k - y.k);
            if (dd.length >= 4) blocks.push(B.spark(dd.map(r => r.a.inc), dd.map(r => r.name), dd.reduce((i, r, j, z) => r.a.inc > z[i].a.inc ? j : i, 0)));
        }
        const ex = list.slice().sort((x, y) => (y.jdn * 1440 + (parseTimeToMinutes(y.r.time) || 0)) - (x.jdn * 1440 + (parseTimeToMinutes(x.r.time) || 0))).slice(0, 4);
        blocks.push(B.h('آخرین ثبت‌ها'), B.list(ex.map(x => recLine2(S, x).slice(2))));
        const chips = [];
        if (!P.dim) { if (F.codes.length || F.text.length) chips.push('چه کسی بیشتر انجام داده؟'); chips.push('به تفکیک روز'); }
        chips.push('مقایسه با دوره‌ی قبل'); if (F.codes.length || F.workers.length) chips.push('چرا؟');
        return R(blocks, chips);
    }

    /* ---------- تجمیع، رتبه‌بندی و سنجه‌ها ---------- */
    function aAgg(S, P) {
        const dflt = (P.dim === 'hour' || P.dim === 'weekday' || P.flags.busy) ? 'count' : 'income';
        if ((P.dim === 'worker' || P.dim === 'section') && !S.emp) return flagNeedEmployer(S, 'گزارش بر اساس پرسنل/بخش');
        let key = P.metric || dflt;
        const kindAll = (P.dim === 'hour' || P.dim === 'weekday') && !P.range;
        let rg = P.range || (kindAll ? RG.all() : defaultRange(S, P));
        if (P.dim === 'month' && !P.range) rg = RG.months(Array.from({ length: 6 }, (_, i) => mkAdd(S.curKey, -5 + i)), '۶ ماه اخیر');
        if (P.dim === 'day' && rg.kind === 'days' && rg.to - rg.from > 45) { P.dim = 'week'; }
        const list = gather(S, P, rg), L = fLabel(P);
        if (!list.length) return emptyAns(S, P, rg);
        const M = METRIC[key], mlabel = M.l(S), head = mlabel + (L ? ' — ' + L : '') + ' — ' + rg.label;
        /* بدون بُعد: پاسخ یک‌عددی */
        if (!P.dim) {
            const a = agg(list), v = mval(key, a);
            if (v === null) return R([B.p(`برای محاسبه‌ی «${mlabel}» داده‌ی کافی وجود ندارد` + (key === 'avgdur' || key === 'perhour' || key === 'hours' ? ' (مدت انجام کارها ثبت نشده است).' : '.'))], ['خلاصه‌ی این ماه', 'راهنما']);
            const pr = prevOf(rg, S), pa = pr ? agg(gather(S, P, pr)) : null, d = pa && pa.n ? dlt(key, a, pa) : null;
            const blocks = [B.big(head, M.fmt(v), key === 'income' ? `${f(a.n)} کارکرد · ${f(a.qty)} عدد` : (key === 'count' ? `ارزش: ${money(a.inc)}` : ''), d ? d.tone : 'info')];
            if (d) blocks.push(B.note(`${d.t} (${pr.label}: ${M.fmt(mval(key, pa))})`, d.tone));
            if (key === 'income' && a.priced < a.n) blocks.push(B.note(`${f(a.n - a.priced)} کارکرد قیمت ندارد و در این عدد نیامده است.`, 'warn'));
            if (key === 'income' && rg.kind === 'months' && rg.keys.length === 1 && rg.keys[0] === S.curKey && !hasFilter(P) && S.day >= 3) { const pj = project(S, S.mEnd, a.inc, S.recs); blocks.push(B.note(`پیش‌بینی پایان ماه: حدود ${money(pj.proj)}`, 'info')); }
            if (key === 'latepct' || key === 'late' || key === 'ontimepct') { const lt = list.filter(x => x.late).sort((x, y) => y.jdn - x.jdn).slice(0, 4); if (lt.length) blocks.push(B.h('نمونه‌های تاخیر'), B.list(lt.map(x => recLine2(S, x).slice(2)))); }
            if ((key === 'count' || key === 'qty') && a.n <= 8) blocks.push(B.list(list.slice().sort((x, y) => y.jdn - x.jdn).map(x => recLine2(S, x).slice(2))));
            const chips = ['به تفکیک روز', 'مقایسه با دوره‌ی قبل'];
            if (d && d.d !== null && Math.abs(d.d) >= 5) chips.push('چرا؟');
            if (!hasFilter(P)) chips.push('برترین کدها');
            return R(blocks, chips.filter(c => !(P.dim && c.indexOf('تفکیک') >= 0)));
        }
        /* با بُعد: جدول/نمودار میله‌ای */
        const { rows, D } = groupBy(list, P.dim, S);
        if (!rows.length) return emptyAns(S, P, rg);
        const rateMetric = !!M.rate; let use = rows;
        if (rateMetric) { const ok = rows.filter(r => r.a.judged >= 2); use = ok.length ? ok : rows; }
        use = use.filter(r => mval(key, r.a) !== null);
        if (!use.length) return R([B.p(`برای «${mlabel}» به تفکیک ${DIM_LABEL[P.dim]} داده‌ی کافی نیست.`)], ['خلاصه‌ی این ماه']);
        const asc = P.sup === 'min';
        const byMetric = (x, y) => asc ? mval(key, x.a) - mval(key, y.a) : mval(key, y.a) - mval(key, x.a);
        const chrono = D.chrono && !P.sup;
        const sorted = chrono ? use.slice().sort((x, y) => D.order(x.k, y.k)) : use.slice().sort(byMetric);
        const top = use.slice().sort(byMetric)[0];
        const limit = P.topN || (chrono ? (P.dim === 'day' ? 31 : 14) : 8);
        const shown = sorted.slice(0, limit);
        if (chrono && shown.length) { const mx = shown.reduce((m, r) => Math.max(m, mval(key, r.a)), -Infinity); shown.forEach(r => { if (mval(key, r.a) === mx) r.hi = true; }); }
        const blocks = [B.h(head)];
        const superWord = P.sup ? (asc ? 'کمترین' : 'بیشترین') : 'بالاترین';
        if (P.sup || P.flags.who || use.length > 1) {
            const tot = M.rate || key === 'avgval' || key === 'avgqty' || key === 'avgdur' || key === 'avgunit' || key === 'perhour' || key === 'perday' || key === 'perdayn' ? null : sum(use, r => mval(key, r.a));
            blocks.push(B.p(`**${superWord} ${mlabel}:** ${top.name} با ${M.fmt(mval(key, top.a))}${tot && tot > 0 && use.length > 1 ? ` (${pctS(mval(key, top.a) / tot * 100)} از کل)` : ''}`));
        }
        if (chrono && shown.length >= 5 && key !== 'avgdur') blocks.push(B.spark(shown.map(r => mval(key, r.a)), shown.map(r => r.name), shown.findIndex(r => r.hi)));
        if (shown.length > 1 || !chrono) blocks.push(barsFor(shown, key, S, limit));
        if (rateMetric && rows.length > use.length) blocks.push(B.note('فقط گروه‌هایی با حداقل ۲ نمونه‌ی قابل‌قضاوت نمایش داده شد.', 'info'));
        if (!chrono && sorted.length > limit) blocks.push(B.note(`${f(sorted.length - limit)} مورد دیگر هم هست؛ «بیشتر» را بزنید.`, 'info'));
        const chips = [];
        if (chrono) chips.push(P.dim === 'day' ? 'کدام روز بهترین بود؟' : null);
        if (!hasFilter(P) && P.dim !== 'code') chips.push('به تفکیک کد');
        if (P.dim !== 'worker' && S.emp) chips.push('به تفکیک پرسنل');
        chips.push('مقایسه با دوره‌ی قبل'); if (!chrono) chips.push('بیشتر');
        return R(blocks, chips);
    }

    /* جدول چندستونه برای «پرسنل»، «کدها» و … (بدون سنجه‌ی مشخص) */
    function aTable(S, P) {
        if ((P.dim === 'worker' || P.dim === 'section') && !S.emp) return flagNeedEmployer(S, 'گزارش پرسنل و بخش‌ها');
        const rg = P.range || defaultRange(S, P), list = gather(S, P, rg);
        if (!list.length) return emptyAns(S, P, rg);
        const { rows } = groupBy(list, P.dim, S), asc = P.sup === 'min';
        const key = P.flags.busy ? 'count' : 'income';
        const sorted = rows.slice().sort((x, y) => asc ? mval(key, x.a) - mval(key, y.a) : mval(key, y.a) - mval(key, x.a));
        const limit = P.topN || 8, shown = sorted.slice(0, limit), L = fLabel(P);
        const head = DIM_LABEL[P.dim] + ' — ' + rg.label + (L ? ' — ' + L : '');
        const rowsT = shown.map(r => { const ot = r.a.judged ? (r.a.judged - r.a.late) / r.a.judged * 100 : null; return [r.name, f(r.a.n), f(r.a.qty), money(r.a.inc), r.a.late ? { t: f(r.a.late), tone: 'warn' } : '—', ot === null ? '—' : pctS(ot)]; });
        const blocks = [B.h(head), B.table([DIM_LABEL[P.dim], 'کارکرد', 'تعداد', lab(S), 'تاخیر', 'به‌موقع'], rowsT)];
        if (sorted.length > limit) blocks.push(B.note(`${f(sorted.length - limit)} مورد دیگر هم هست.`, 'info'));
        if (P.dim === 'code' && S.recs.some(x => x.dur !== null)) { const ph2 = sorted.filter(r => r.a.hDur > 0 && r.a.n >= 2).sort((x, y) => mval('perhour', y.a) - mval('perhour', x.a)); if (ph2.length >= 2) blocks.push(B.note(`از نظر بازده ساعتی، کد ${fa(ph2[0].list[0].codeRaw)} با ${money(mval('perhour', ph2[0].a))} در ساعت پیشتاز است.`, 'good')); }
        const chips = ['مقایسه با دوره‌ی قبل']; if (P.dim === 'code') chips.push('کدام کد بازده ساعتی بهتری دارد؟', 'کدام کد بیشترین تاخیر را دارد؟'); else chips.push('بیشترین تاخیر', 'چرا؟');
        return R(blocks, chips);
    }

    /* ---------- مقایسه ---------- */
    function aCompare(S, P, ctxP) {
        const F = P.filters; let A, Bg, la, lb, PA = P, PB = P, tp = 'range';
        if (F.workers.length >= 2 || F.codes.length >= 2) {
            tp = 'entity'; const ents = F.workers.length >= 2 ? F.workers : F.codes, isW = F.workers.length >= 2;
            const mk = (e) => { const p2 = { filters: newFilters() }; if (isW) p2.filters.workers = [e]; else p2.filters.codes = [e]; return p2; };
            PA = mk(ents[0]); PB = mk(ents[1]); la = isW ? ents[0].name : 'کد ' + fa(ents[0].raw); lb = isW ? ents[1].name : 'کد ' + fa(ents[1].raw);
            const rg = P.range || defaultRange(S, P, 'month'); A = agg(gather(S, PA, rg)); Bg = agg(gather(S, PB, rg)); P.range = rg;
        } else {
            let r1 = P.ranges[0], r2 = P.ranges[1];
            /* «مقایسه با ماه قبل» یعنی بازه‌ی جاری در برابر آن بازه */
            if (r1 && !r2 && /(^| )(با|نسبت به|در برابر|در مقابل) /.test(norm(P.raw))) {
                r2 = r1;
                r1 = (r2.kind === 'days' && r2.to - r2.from === 6) ? RG.days(S.ws, S.T, 'این هفته') : (r2.kind === 'days' && r2.from === r2.to) ? RG.days(S.T, S.T, 'امروز') : (r2.kind === 'year' ? RG.year(S.jy, 'امسال') : RG.months([S.curKey], 'این ماه (' + mkLabel(S.curKey) + ')'));
            }
            if (!r1 && ctxP && ctxP.range) r1 = ctxP.range;
            if (!r1) r1 = RG.months([S.curKey], 'این ماه');
            if (!r2) r2 = prevOf(r1, S);
            if (!r2) return R([B.p('برای مقایسه یک بازه‌ی دیگر هم بگویید؛ مثلاً «مقایسه مهر با شهریور».')], ['این هفته با هفته قبل', 'این ماه با ماه قبل']);
            /* مقایسه‌ی منصفانه: بازه‌ی ناقصِ جاری با همان تعداد روزِ بازه‌ی کامل قبلی سنجیده می‌شود */
            const clamp = (cu, fu) => {
                if (cu.kind === 'months' && cu.keys.length === 1 && cu.keys[0] === S.curKey && !cu.upTo && fu.kind === 'months' && fu.keys.length === 1 && fu.keys[0] !== S.curKey && !fu.upTo) { clampNote = true; return RG.months(fu.keys, fu.label.replace(/\s*\(.*\)\s*$/, '') + ' (' + fa(S.day) + ' روز اول)', S.day); }
                if (cu.kind === 'days' && cu.from === S.ws && cu.to === S.T && fu.kind === 'days' && fu.to - fu.from === 6 && fu.to < S.ws) { clampNote = true; return RG.days(fu.from, fu.from + (S.T - S.ws), fu.label + ' (' + fa(S.T - S.ws + 1) + ' روز اول)'); }
                return fu;
            };
            let clampNote = false;
            r2 = clamp(r1, r2);
            if (!clampNote) r1 = clamp(r2.kind === 'months' || r2.kind === 'days' ? r2 : r1, r1) === r1 ? r1 : r1;
            la = r1.label; lb = r2.label; A = agg(gather(S, P, r1)); Bg = agg(gather(S, P, r2));
            P.clampNote = clampNote;
        }
        if (!A.n && !Bg.n) return R([B.p('در هیچ‌کدام از این دو داده‌ای ثبت نشده است.')], ['راهنما']);
        const keys = ['income', 'count', 'qty', 'avgval', 'latepct', 'perhour'].filter(k => mval(k, A) !== null || mval(k, Bg) !== null);
        const rows = keys.map(k => { const a = mval(k, A), b = mval(k, Bg), d = (a !== null && b !== null) ? delta(a, b, METRIC[k].up) : null; return [METRIC[k].l(S).replace(' هر روز کاری', ''), a === null ? '—' : METRIC[k].fmt(a), b === null ? '—' : METRIC[k].fmt(b), d && d.d !== null ? { t: (d.d >= 0 ? '▲' : '▼') + f(Math.abs(d.d)) + '٪', tone: d.tone } : '—']; });
        const blocks = [B.h((tp === 'entity' ? 'مقایسه: ' : 'مقایسه‌ی بازه‌ها: ') + la + ' و ' + lb), B.table(['', la, lb, 'تغییر'], rows)];
        const dI = delta(mval('income', A), mval('income', Bg), true);
        if (dI && dI.d !== null) {
            const parts = []; const nd = Bg.n ? (A.n - Bg.n) / Bg.n * 100 : null, vd = (mval('avgval', Bg) && mval('avgval', A) !== null) ? (mval('avgval', A) - mval('avgval', Bg)) / mval('avgval', Bg) * 100 : null;
            if (nd !== null && Math.abs(nd) >= 5) parts.push(`تعداد کارکرد ${f(Math.abs(nd))}٪ ${nd >= 0 ? 'بیشتر' : 'کمتر'}`);
            if (vd !== null && Math.abs(vd) >= 5) parts.push(`میانگین ارزش هر کارکرد ${f(Math.abs(vd))}٪ ${vd >= 0 ? 'بیشتر' : 'کمتر'}`);
            blocks.push(B.note(`${lab(S)} در ${la} ${dI.d >= 0 ? 'بالاتر' : 'پایین‌تر'} از ${lb} است${parts.length ? ' — چون ' + parts.join(' و ') : ''}.`, dI.tone));
        }
        if (tp === 'range' && P.clampNote) blocks.push(B.note('برای منصفانه بودن، بازه‌ی کامل قبلی فقط به اندازه‌ی همان تعداد روزِ بازه‌ی جاری سنجیده شد.', 'info'));
        return R(blocks, ['چرا؟', 'به تفکیک کد', tp === 'range' ? 'پیش‌بینی پایان ماه' : 'بیشترین تاخیر']);
    }

    /* ---------- «چرا؟»: ریشه‌یابی تغییر ---------- */
    function aWhy(S, P, ctxP) {
        const base = (ctxP && ctxP.range && !P.range) ? ctxP : P;
        let rg = P.range || (ctxP && ctxP.range) || RG.months([S.curKey], 'این ماه');
        const key = P.metric || (ctxP && ctxP.metric) || 'income';
        const Pf = { filters: (hasFilter(P) ? P.filters : (ctxP ? ctxP.filters : P.filters)) || newFilters() };
        const pr = P.ranges[1] || prevOf(rg, S);
        if (!pr) return R([B.p('برای بررسی علت تغییر، یک بازه‌ی قابل‌مقایسه (مثل ماه یا هفته) لازم است.')], ['این هفته چرا کم شد؟']);
        const A = gather(S, Pf, rg), Bl = gather(S, Pf, pr), a = agg(A), b = agg(Bl), M = METRIC[key];
        if (!a.n && !b.n) return R([B.p('داده‌ای برای بررسی نیست.')], ['راهنما']);
        const va = mval(key, a), vb = mval(key, b);
        if (va === null || vb === null) return R([B.p('برای این سنجه در یکی از دو بازه داده‌ای نیست.')], ['راهنما']);
        const d = delta(va, vb, M.up), blocks = [B.h(`چرا ${M.l(S)} ${va >= vb ? 'بالاتر' : 'پایین‌تر'} شد؟ (${rg.label} در برابر ${pr.label})`), B.p(`${M.fmt(va)} در برابر ${M.fmt(vb)} — ${d ? d.t.replace(' از دوره‌ی قبل', '') : ''}`)];
        const reasons = [];
        if (key === 'income' || key === 'count' || key === 'qty') {
            const nd = b.n ? (a.n - b.n) / b.n * 100 : null;
            if (nd !== null && Math.abs(nd) >= 5) reasons.push({ t: nd >= 0 ? 'good' : 'warn', x: `تعداد کارکرد ${f(Math.abs(nd))}٪ ${nd >= 0 ? 'بیشتر' : 'کمتر'} بوده (${f(a.n)} در برابر ${f(b.n)}).` });
            const avA = mval('avgval', a), avB = mval('avgval', b);
            if (avA !== null && avB) { const vd = (avA - avB) / avB * 100; if (Math.abs(vd) >= 5) reasons.push({ t: vd >= 0 ? 'good' : 'warn', x: `میانگین ارزش هر کارکرد ${f(Math.abs(vd))}٪ ${vd >= 0 ? 'بیشتر' : 'کمتر'} شده (${money(avA)} در برابر ${money(avB)}).` }); }
            if (a.days !== b.days && b.days) reasons.push({ t: a.days >= b.days ? 'good' : 'warn', x: `روزهای دارای ثبت: ${f(a.days)} در برابر ${f(b.days)}.` });
            const up = mval('avgunit', a), ub = mval('avgunit', b); if (up && ub && Math.abs(up - ub) / ub > 0.08) reasons.push({ t: 'info', x: `میانگین قیمت واحد ${up > ub ? 'افزایش' : 'کاهش'} یافته (${money(up)} در برابر ${money(ub)}).` });
            /* سهم کدها و پرسنل در تغییر */
            [['code', 'کد'], ['worker', 'پرسنل']].forEach(([dm, nm]) => {
                if (dm === 'worker' && !S.emp) return;
                const m1 = new Map(), m2 = new Map(), val = (x) => key === 'count' ? 1 : key === 'qty' ? x.qty : (x.inc || 0);
                const keyOf = dimDef(dm, S).key; A.forEach(x => { const k = keyOf(x); if (k) m1.set(k, (m1.get(k) || 0) + val(x)); }); Bl.forEach(x => { const k = keyOf(x); if (k) m2.set(k, (m2.get(k) || 0) + val(x)); });
                const all = uniq(Array.from(m1.keys()).concat(Array.from(m2.keys()))), nameOf = (k) => { const x = A.concat(Bl).find(z => keyOf(z) === k); return dm === 'code' ? 'کد ' + fa(x.codeRaw) : x.wn; };
                const ds = all.map(k => ({ k, d: (m1.get(k) || 0) - (m2.get(k) || 0) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 2).filter(z => Math.abs(z.d) > 0);
                const tot = va - vb;
                ds.forEach(z => { if (Math.abs(z.d) >= Math.abs(tot) * 0.2 && all.length > 1) reasons.push({ t: z.d >= 0 ? 'good' : 'warn', x: `${nameOf(z.k)}: ${z.d >= 0 ? '+' : '−'}${f(Math.abs(z.d))}${key === 'income' ? ' ' + cur() : ''} نسبت به دوره‌ی قبل.` }); });
            });
        } else if (key === 'latepct' || key === 'late' || key === 'ontimepct') {
            const gc = groupBy(A.filter(x => x.late), 'code', S).rows.sort((x, y) => y.a.late - x.a.late)[0];
            if (gc) reasons.push({ t: 'warn', x: `بیشترین تاخیر در بازه‌ی جدید مربوط به کد ${fa(gc.list[0].codeRaw)} است (${f(gc.a.late)} مورد).` });
            if (S.emp) { const gw = groupBy(A.filter(x => x.late), 'worker', S).rows.sort((x, y) => y.a.late - x.a.late)[0]; if (gw) reasons.push({ t: 'warn', x: `بیشترین تاخیر پرسنلی: ${gw.name} (${f(gw.a.late)} مورد).` }); }
            const dA = mval('avgdur', a), dB = mval('avgdur', b); if (dA && dB && Math.abs(dA - dB) / dB > 0.1) reasons.push({ t: 'info', x: `میانگین مدت انجام ${dA > dB ? 'بیشتر' : 'کمتر'} شده است (${formatMinutesDuration(dA)} در برابر ${formatMinutesDuration(dB)}).` });
        } else {
            const mA = new Map(), mB = new Map();
            gather(S, Pf, rg).forEach(x => { if (x.code) { const o = mA.get(x.code) || { l: [], n: x.codeRaw }; o.l.push(x); mA.set(x.code, o); } });
            gather(S, Pf, pr).forEach(x => { if (x.code) { const o = mB.get(x.code) || { l: [], n: x.codeRaw }; o.l.push(x); mB.set(x.code, o); } });
            const ch = []; mA.forEach((o, k) => { const o2 = mB.get(k); if (!o2) return; const v1 = mval(key, agg(o.l)), v2 = mval(key, agg(o2.l)); if (v1 !== null && v2) ch.push({ n: o.n, d: (v1 - v2) / Math.abs(v2) * 100, v1, v2 }); });
            ch.sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 3).forEach(z => { if (Math.abs(z.d) >= 5) reasons.push({ t: (z.d >= 0) === (M.up !== false) ? 'good' : 'warn', x: `کد ${fa(z.n)}: ${M.fmt(z.v1)} در برابر ${M.fmt(z.v2)} (${z.d >= 0 ? '+' : '−'}${f(Math.abs(z.d))}٪).` }); });
        }
        if (!reasons.length) reasons.push({ t: 'info', x: 'تغییر ناچیز است یا به یک عامل مشخص برنمی‌گردد.' });
        blocks.push(B.finds(reasons.slice(0, 5).map(r => ({ i: r.t === 'good' ? 'fa-arrow-up' : r.t === 'warn' ? 'fa-arrow-down' : 'fa-circle-info', t: r.t, x: r.x }))));
        return R(blocks, ['مقایسه کامل', 'به تفکیک کد', 'پیشنهادها']);
    }

    /* ---------- پیش‌بینی ---------- */
    function aForecast(S, P) {
        const weekly = /هفته/.test(norm(P.raw)) && !/ماه/.test(norm(P.raw));
        const hasF = hasFilter(P);
        const base = hasF ? S.recs.filter(x => matchRec(x, P.filters)) : S.recs;
        const mrecs = base.filter(x => x.mk === S.curKey), start = weekly ? S.ws : S.mStart, end = weekly ? S.ws + 6 : S.mEnd;
        const soFar = weekly ? sum(base.filter(x => x.jdn >= S.ws && x.jdn <= S.T), x => x.inc || 0) : sum(mrecs, x => x.inc || 0);
        if (!base.length) return R([B.p('هنوز داده‌ای برای پیش‌بینی نیست.')], ['راهنما']);
        const pj = project(S, end, soFar, base), goal = weekly ? S.goalW : S.goal, per = weekly ? 'این هفته' : 'این ماه';
        const blocks = [B.big(`پیش‌بینی ${lab(S)} تا پایان ${weekly ? 'هفته' : 'ماه'}${hasF ? ' — ' + fLabel(P) : ''}`, money(pj.proj), `بازه‌ی محتمل: ${f(pj.low)} تا ${f(pj.high)} ${cur()}`, 'info')];
        const rows = [[`تا الان (${per})`, money(soFar)], ['روزهای کاری باقی‌مانده (تخمینی)', f(pj.workLeft)], ['میانگین یک روز کاری', money(pj.ex.workMean)], ['اطمینان پیش‌بینی', pj.conf + (pj.conf === 'کم' ? ' (داده‌ی کم)' : '')]];
        blocks.push(B.kv(rows));
        const ref = weekly ? sum(base.filter(x => x.jdn >= S.ws - 7 && x.jdn <= S.ws - 1), x => x.inc || 0) : sum(base.filter(x => x.mk === S.prevKey), x => x.inc || 0);
        if (ref > 0) { const d = delta(pj.proj, ref, true); blocks.push(B.note(`${d.t.replace('دوره‌ی قبل', weekly ? 'هفته‌ی قبل' : 'ماه قبل')} (${money(ref)})`, d.tone)); }
        if (goal > 0) { const gap = goal - pj.proj; blocks.push(B.prog('هدف ' + (weekly ? 'هفتگی' : 'ماهانه'), Math.min(100, soFar / goal * 100), `${pctS(soFar / goal * 100)} از ${money(goal)}`, gap <= 0 ? 'good' : 'warn')); blocks.push(B.note(gap <= 0 ? 'با این روند به هدف می‌رسید.' : `با این روند ${money(gap)} به هدف کم می‌آید.`, gap <= 0 ? 'good' : 'warn')); }
        blocks.push(B.note('این پیش‌بینی از الگوی ۸ هفته‌ی اخیر و میانگین هر روز هفته ساخته شده، نه فقط میانگین ساده‌ی ماه.', 'info'));
        return R(blocks, [goal > 0 ? 'برای رسیدن به هدف چه کنم؟' : 'هدف', 'تحلیل هوشمند', 'مقایسه با ماه قبل']);
    }
    function aGoal(S, P) {
        const weekly = /هفته/.test(norm(P.raw)) && S.goalW > 0, goal = weekly ? S.goalW : (S.goal || S.goalW), isW = weekly || (!S.goal && S.goalW > 0);
        if (!(goal > 0)) return R([B.p('هدف درآمد هنوز تنظیم نشده است؛ از «تنظیمات ← هدف درآمد» وارد کنید تا پیش‌بینی و راهکار روزانه فعال شود.')], ['پیش‌بینی پایان ماه', 'راهنما']);
        const soFar = isW ? sum(S.recs.filter(x => x.jdn >= S.ws && x.jdn <= S.T), x => x.inc || 0) : sum(S.m, x => x.inc || 0), end = isW ? S.ws + 6 : S.mEnd;
        const left = goal - soFar, pj = project(S, end, soFar, S.recs);
        if (left <= 0) return R([B.big('هدف ' + (isW ? 'هفتگی' : 'ماهانه'), 'محقق شد 🎉', `${money(soFar)} از ${money(goal)}`, 'good')], ['پیش‌بینی پایان ماه', 'تحلیل هوشمند']);
        const dl = Math.max(1, pj.workLeft), need = left / dl;
        const blocks = [B.prog('هدف ' + (isW ? 'هفتگی' : 'ماهانه'), Math.min(100, soFar / goal * 100), `${pctS(soFar / goal * 100)} — ${money(soFar)} از ${money(goal)}`, 'info')];
        blocks.push(B.kv([['باقی‌مانده تا هدف', money(left)], ['روزهای کاری باقی‌مانده (تخمینی)', f(dl)], ['لازم است روزانه', money(need)], ['میانگین یک روز کاری شما', money(pj.ex.workMean)]]));
        if (pj.ex.workMean > 0) { const r = need / pj.ex.workMean; blocks.push(B.note(r <= 1 ? 'با همین سرعت فعلی به هدف می‌رسید.' : `باید روزانه حدود ${f((r - 1) * 100)}٪ بیشتر از معمول کار کنید.`, r <= 1 ? 'good' : 'warn')); }
        blocks.push(B.note(`پیش‌بینی با روند فعلی: ${money(pj.proj)} (${pj.proj >= goal ? 'بالاتر از' : 'پایین‌تر از'} هدف)`, pj.proj >= goal ? 'good' : 'warn'));
        return R(blocks, ['پیش‌بینی پایان ماه', 'برترین کدها', 'کدام کد بازده ساعتی بهتری دارد؟']);
    }

    /* ---------- کار جاری و وضعیت پرسنل ---------- */
    function aActive(S, P) {
        if (S.emp && typeof mgrWorkerState === 'function') {
            const act = S.workers.filter(w => w.active), F = P.filters;
            let sts = act.map(w => { try { return mgrWorkerState(w); } catch (e) { return null; } }).filter(Boolean);
            if (F.workers.length) sts = sts.filter(s => F.workers.some(w => w.n === norm(s.w.name)));
            if (sts.length) {
                const ord = { late: 0, urgent: 1, warn: 2, ok: 3, idle: 4 }; sts.sort((a, b) => ord[a.key] - ord[b.key] || b.pct - a.pct);
                const idleOnly = P.flags.idle, shown = idleOnly ? sts.filter(s => s.key === 'idle') : sts;
                const nIdle = sts.filter(s => s.key === 'idle').length, nLate = sts.filter(s => s.key === 'late').length, nWork = sts.length - nIdle - nLate;
                const blocks = [B.big(idleOnly ? 'پرسنل بیکار' : 'وضعیت زنده‌ی پرسنل', idleOnly ? f(nIdle) + ' نفر' : `${f(nWork)} در حال کار · ${f(nLate)} دیرکرد · ${f(nIdle)} بیکار`, '', nLate ? 'warn' : 'info')];
                if (!shown.length) blocks.push(B.p(idleOnly ? 'الان همه‌ی پرسنل کار دارند.' : 'پرسنلی پیدا نشد.'));
                else blocks.push(B.table(['نام', 'کار جاری', 'پیشرفت', 'وضعیت'], shown.slice(0, 12).map(s => [s.w.name, s.rec ? (s.rec.itemTitle || 'کد ' + fa(s.rec.itemCode)) : '—', s.rec ? pctS(Math.min(s.pct, 999)) : '—', { t: { late: 'دیرکرد', urgent: 'نزدیک موعد', warn: 'در حال کار', ok: 'در حال کار', idle: 'بیکار' }[s.key], tone: s.key === 'late' ? 'warn' : s.key === 'idle' ? 'info' : 'good' }])));
                return R(blocks, nLate ? ['کدام پرسنل بیشترین تاخیر را دارد؟', 'پرسنل'] : ['پرسنل', 'تحلیل هوشمند']);
            }
        }
        if (!S.act || !S.prog) return R([B.p('الان کار جاری‌ای در حال انجام نیست.')], ['امروز', 'خلاصه‌ی این ماه']);
        const r = S.act, p = S.prog, over = p.remainingMinutes < 0;
        const blocks = [B.big(r.itemTitle || r.itemCode || 'کار جاری', f(Math.min(p.percent, 999)) + '٪ پیش رفته', `کد ${fa(r.itemCode || '-')}${r.quantity ? ' · ' + f(num(r.quantity)) + ' عدد' : ''}`, over ? 'warn' : (p.percent >= 85 ? 'warn' : 'info')),
            B.prog('پیشرفت تا موعد', Math.min(100, p.percent), over ? formatMinutesDuration(p.remainingMinutes) + ' از موعد گذشته' : formatMinutesDuration(p.remainingMinutes) + ' تا موعد مانده', over ? 'warn' : 'info')];
        const kv = [['شروع', `${r.date} - ${r.time}`], ['مهلت هدف', r.workDuration || '—']];
        const hist = S.recs.filter(x => x.code === norm(r.itemCode) && x.dur !== null && x !== null && x.r !== r && x.dur > 0);
        if (hist.length >= 2) { const avg = sum(hist, x => x.dur) / hist.length, tgt = p.targetMinutes; kv.push(['میانگین مدت این کد در دفعات قبل', formatMinutesDuration(avg)]); blocks.push(B.kv(kv)); blocks.push(B.note(avg > tgt ? `معمولاً این کد بیشتر از مهلت هدف (${formatMinutesDuration(tgt)}) طول می‌کشد؛ احتمال تاخیر هست.` : `معمولاً این کد زودتر از مهلت هدف تمام می‌شود.`, avg > tgt ? 'warn' : 'good')); }
        else blocks.push(B.kv(kv));
        if (over) blocks.push(B.note('اگر کار تمام شده، «کار تمام شد» را بزنید تا آمار تاخیر دقیق شود.', 'warn'));
        return R(blocks, ['کارهای با تاخیر', 'امروز']);
    }

    /* ---------- فهرست رکوردها ---------- */
    function aList(S, P, mode) {
        const rg = P.range || (mode === 'first' ? RG.all() : (hasFilter(P) ? RG.all() : defaultRange(S, P)));
        if (P.flags.late && !P.filters.status) P.filters.status = 'late';
        const list = gather(S, P, rg);
        if (!list.length) return emptyAns(S, P, rg);
        const t = (x) => x.jdn * 1440 + (parseTimeToMinutes(x.r.time) || 0);
        const sorted = list.slice().sort(mode === 'first' ? (a, b) => t(a) - t(b) : P.sup ? (P.sup === 'min' ? (a, b) => (a.inc || 0) - (b.inc || 0) : (a, b) => (b.inc || 0) - (a.inc || 0)) : (a, b) => t(b) - t(a));
        const n = P.topN || (mode === 'last' || mode === 'first' ? 5 : 8), a = agg(list), L = fLabel(P);
        const blocks = [B.h(`${mode === 'first' ? 'قدیمی‌ترین' : mode === 'last' ? 'آخرین' : 'فهرست'} کارکردها${L ? ' — ' + L : ''} — ${rg.label}`), B.list(sorted.slice(0, n).map(x => recLine2(S, x).slice(2))),
            B.note(`${f(list.length)} کارکرد · ${f(a.qty)} عدد · ${money(a.inc)}${list.length > n ? ' — ' + f(list.length - n) + ' مورد دیگر هم هست' : ''}`, 'info')];
        return R(blocks, ['به تفکیک کد', 'مقایسه با دوره‌ی قبل', list.length > n ? 'بیشتر' : null]);
    }

    /* ---------- میانگین‌ها ---------- */
    function aAvgs(S, P) {
        const rg = P.range || defaultRange(S, P), list = gather(S, P, rg);
        if (!list.length) return emptyAns(S, P, rg);
        const a = agg(list), L = fLabel(P), rows = [];
        const add = (k, ttl) => { const v = mval(k, a); if (v !== null) rows.push([ttl || METRIC[k].l(S), METRIC[k].fmt(v)]); };
        add('avgval'); add('avgqty'); add('avgunit'); add('perday'); add('perdayn'); add('avgdur'); add('perhour'); add('ontimepct');
        return R([B.h('میانگین‌ها — ' + rg.label + (L ? ' — ' + L : '')), B.kv(rows)], ['مقایسه با دوره‌ی قبل', 'تحلیل هوشمند']);
    }

    /* ---------- تحلیل هوشمند ---------- */
    function aAnalysis(S, P) {
        const F = findings(S), blocks = [B.h('گزارش هوشمند ' + S.jc.monthName)];
        blocks.push(B.finds(F.slice(0, 9).map(o => ({ i: o.i, t: o.t, x: o.x }))));
        /* الگوی روزهای هفته و بازده کدها */
        const wd = groupBy(S.recs, 'weekday', S).rows.filter(r => r.k !== 6 || r.a.n >= 3).sort((x, y) => y.a.inc - x.a.inc);
        if (wd.length >= 3 && S.recs.length >= 12) blocks.push(B.note(`الگوی هفته: پردرآمدترین روز «${wd[0].name}» و ضعیف‌ترین «${wd[wd.length - 1].name}» است.`, 'info'));
        const ph2 = groupBy(S.recs, 'code', S).rows.filter(r => r.a.hDur > 0 && r.a.n >= 3).sort((x, y) => mval('perhour', y.a) - mval('perhour', x.a));
        if (ph2.length >= 2) blocks.push(B.note(`بازده ساعتی: کد ${fa(ph2[0].list[0].codeRaw)} (${money(mval('perhour', ph2[0].a))}) بهتر از کد ${fa(ph2[ph2.length - 1].list[0].codeRaw)} (${money(mval('perhour', ph2[ph2.length - 1].a))}) است.`, 'info'));
        const dd = groupBy(S.m, 'day', S).rows.sort((x, y) => x.k - y.k);
        if (dd.length >= 4) blocks.push(B.spark(dd.map(r => r.a.inc), dd.map(r => r.name), dd.reduce((i, r, j, z) => r.a.inc > z[i].a.inc ? j : i, 0)));
        const an = anomalies(S).slice(0, 2); if (an.length) blocks.push(B.note('نکته‌ی غیرعادی: ' + an[0].x, 'warn'));
        return R(blocks, ['پیشنهادها', 'روزهای غیرعادی', 'پیش‌بینی پایان ماه', 'مقایسه با ماه قبل']);
    }
    function aAnomaly(S) {
        const an = anomalies(S);
        if (!an.length) return R([B.p('در ۴۵ روز اخیر مورد غیرعادی (روز پرت، قیمت یا تعداد مشکوک) پیدا نشد. 👌')], ['تحلیل هوشمند', 'بررسی سلامت داده‌ها']);
        return R([B.h('موارد غیرعادی (۴۵ روز اخیر)'), B.finds(an.slice(0, 7).map(o => ({ i: o.t === 'good' ? 'fa-arrow-up' : 'fa-triangle-exclamation', t: o.t, x: o.x })))], ['بررسی سلامت داده‌ها', 'روزهای بدون کار']);
    }
    function aStreak(S) {
        const st = streaks(S);
        if (!st.best) return R([B.p('هنوز داده‌ای برای محاسبه‌ی پیوستگی کار نیست.')], ['راهنما']);
        let passed = 0; for (let j = S.mStart; j <= S.T; j++) if (S.wdOf(j) !== 6) passed++; const act = new Set(S.m.filter(x => S.wdOf(x.jdn) !== 6).map(x => x.jdn)).size; passed = Math.max(passed, act);
        return R([B.big('کار پشت سر هم (بدون احتساب جمعه‌ها)', f(st.cur) + ' روز', `بهترین رکورد شما: ${f(st.best)} روز`, st.cur >= 5 ? 'good' : 'info'), B.kv([['روزهای دارای ثبت این ماه', f(act) + ' از ' + f(passed) + ' روز کاری گذشته']])], ['روزهای بدون کار', 'تحلیل هوشمند']);
    }
    function aIdle(S, P) {
        if (!S.recs.length) return R([B.p('هنوز هیچ کارکردی ثبت نشده است.')], ['راهنما']);
        const rg = P.range && P.range.kind === 'days' ? P.range : RG.days(S.mStart, S.T, 'این ماه تا امروز');
        const days = idleDays(S, rg.from, Math.min(rg.to, S.T));
        if (!days.length) return R([B.p(`در «${rg.label}» هر روز کاری، کارکرد ثبت شده است. 👏`)], ['کار پشت سر هم', 'تحلیل هوشمند']);
        const runs = []; days.forEach(j => { const l = runs[runs.length - 1]; if (l && j - l.to <= 2 && (j - l.to === 1 || S.wdOf(l.to + 1) === 6)) l.to = j; else runs.push({ from: j, to: j }); });
        return R([B.big('روزهای بدون ثبت (جمعه‌ها حساب نشد)', f(days.length) + ' روز', rg.label, 'warn'), B.list(runs.slice(-6).reverse().map(r => r.from === r.to ? dayLong(S, r.from) : dayLong(S, r.from) + ' تا ' + dayLong(S, r.to)))], ['کار پشت سر هم', 'پیشنهادها']);
    }
    function aQuality(S) {
        const out = [], m = S.recs;
        const noP = m.filter(x => x.inc === null); if (noP.length) out.push({ i: 'fa-circle-question', t: 'warn', x: `${f(noP.length)} کارکرد قیمت ندارد (مثلاً کد ${fa(noP[noP.length - 1].codeRaw)} در ${noP[noP.length - 1].r.date}).` });
        const noDur = m.filter(x => x.dur === null && !x.open && x.judged); if (noDur.length > 3) out.push({ i: 'fa-hourglass', t: 'info', x: `${f(noDur.length)} کارکرد مدت انجام ثبت‌شده ندارد؛ تحلیل بازده ساعتی دقیق نمی‌شود.` });
        const stale = m.filter(x => x.open && x.jdn && S.T - x.jdn > 7); if (stale.length) out.push({ i: 'fa-folder-open', t: 'warn', x: `${f(stale.length)} کار بیش از ۷ روز باز مانده است؛ اگر تمام شده‌اند، پایان‌شان را ثبت کنید.` });
        const seen = new Map(); let dup = 0; m.forEach(x => { const k = [x.code, x.r.date, x.r.time, x.qty, x.wnn].join('|'); if (seen.has(k)) dup++; else seen.set(k, 1); }); if (dup) out.push({ i: 'fa-clone', t: 'warn', x: `${f(dup)} کارکرد تکراری (کد، زمان و تعداد یکسان) به نظر می‌رسد.` });
        const zero = m.filter(x => x.qty <= 0); if (zero.length) out.push({ i: 'fa-ban', t: 'warn', x: `${f(zero.length)} کارکرد تعداد صفر دارد.` });
        const an = anomalies(S).filter(z => z.t === 'warn' && /قیمت|تعداد/.test(z.x)).slice(0, 2); an.forEach(z => out.push({ i: 'fa-triangle-exclamation', t: 'warn', x: z.x }));
        if (!out.length) return R([B.p('داده‌ها سالم به نظر می‌رسند؛ مورد ناقص یا مشکوکی پیدا نشد. ✅')], ['تحلیل هوشمند']);
        return R([B.h('بررسی سلامت داده‌ها'), B.finds(out)], ['کارهای بدون قیمت', 'روزهای غیرعادی']);
    }
    function aTips(S, P) {
        const t = [], m = agg(S.m), lb = lab(S);
        if (S.act && S.prog && S.prog.remainingMinutes < 0) t.push({ i: 'fa-triangle-exclamation', t: 'warn', x: 'کار جاری از موعد گذشته؛ در صورت اتمام، پایان کار را ثبت کنید تا آمار تاخیر دقیق شود.' });
        else if (S.act && S.prog && S.prog.percent >= 85) t.push({ i: 'fa-stopwatch', t: 'warn', x: 'کار جاری به موعد نزدیک است؛ اولویت را به آن بدهید.' });
        if (m.judged >= 4 && m.late / m.judged > 0.3) {
            const gc = groupBy(S.m.filter(x => x.late), 'code', S).rows.sort((x, y) => y.a.late - x.a.late)[0];
            t.push({ i: 'fa-clock', t: 'warn', x: `${f(m.late / m.judged * 100)}٪ کارها با تاخیر تحویل شده${gc ? '؛ بیشترین تاخیر مربوط به کد ' + fa(gc.list[0].codeRaw) + ' است' : ''}. مهلت هدف را واقع‌بینانه‌تر بگذارید یا کار هم‌زمان را کم کنید.` });
        }
        const ph2 = groupBy(S.recs, 'code', S).rows.filter(r => r.a.hDur > 0 && r.a.n >= 3).sort((x, y) => mval('perhour', y.a) - mval('perhour', x.a));
        if (ph2.length >= 3 && mval('perhour', ph2[0].a) > mval('perhour', ph2[ph2.length - 1].a) * 1.3) t.push({ i: 'fa-ranking-star', t: 'good', x: `کد ${fa(ph2[0].list[0].codeRaw)} بازده ساعتی ${f(mval('perhour', ph2[0].a) / mval('perhour', ph2[ph2.length - 1].a))} برابری نسبت به کد ${fa(ph2[ph2.length - 1].list[0].codeRaw)} دارد؛ در صورت امکان آن را بیشتر بگیرید.` });
        if (S.goal > 0 && m.inc > 0 && S.day >= 3) { const pj = project(S, S.mEnd, m.inc, S.recs); if (pj.proj < S.goal) t.push({ i: 'fa-bullseye', t: 'warn', x: `با روند فعلی ${money(S.goal - pj.proj)} تا هدف کم می‌آید؛ روزی حدود ${money((S.goal - m.inc) / Math.max(1, pj.workLeft))} لازم است.` }); }
        if (!S.goal && !S.goalW) t.push({ i: 'fa-bullseye', t: 'info', x: 'هدف درآمد را تنظیم کنید تا پیش‌بینی و هشدار هدف فعال شود.' });
        const idle = S.recs.length ? idleDays(S, S.mStart, S.T - 1) : []; if (idle.length >= 3) t.push({ i: 'fa-calendar-xmark', t: 'info', x: `${f(idle.length)} روز کاری این ماه بدون ثبت مانده؛ اگر کار کرده‌اید ثبت کنید.` });
        { const unk = S.m.filter(x => x.inc === null).length; if (unk) t.push({ i: 'fa-circle-question', t: 'warn', x: `${f(unk)} کارکرد قیمت ندارد؛ با ثبت قیمت، ${lb} دقیق‌تر می‌شود.` }); }
        const gw = groupBy(S.recs, 'weekday', S).rows.filter(r => r.k !== 6).sort((x, y) => y.a.inc - x.a.inc); if (gw.length >= 4 && S.recs.length >= 15) t.push({ i: 'fa-calendar-week', t: 'info', x: `«${gw[0].name}» معمولاً پربازده‌ترین روز شماست؛ کارهای مهم‌تر را برای آن بگذارید.` });
        return R([B.h('پیشنهادهای داده‌محور'), t.length ? B.finds(t.slice(0, 7)) : B.p('مورد خاصی برای هشدار نیست؛ وضعیت خوب است. 👌')], ['تحلیل هوشمند', 'روزهای غیرعادی']);
    }

    /* ---------- جستجو و پیشنهاد ---------- */
    function aFind(S, P, V) {
        const toks = P.unknown.concat(P.filters.text.map(t => t.n));
        if (!toks.length) return aFallback(S, P);
        const hit = S.recs.filter(x => toks.every(t => x.hay.indexOf(t) >= 0));
        if (!hit.length) {
            const all = Object.keys(V.tok).filter(k => toks.some(t => lev(t, k, 2) <= 2)).slice(0, 3);
            return R([B.p(`چیزی برای «${toks.join(' ')}» پیدا نشد.`)], all.length ? all.map(k => 'کارهای ' + k) : ['راهنما']);
        }
        const a = agg(hit);
        return R([B.h(`${f(hit.length)} کارکرد مطابق «${toks.join(' ')}»`), B.note(`جمع: ${f(a.qty)} عدد — ${money(a.inc)}`, 'info'), B.list(hit.slice(-5).reverse().map(x => recLine2(S, x).slice(2)))], ['به تفکیک کد', 'مقایسه با دوره‌ی قبل']);
    }
    const CATALOG = [
        ['درآمد', 'درآمد امروز'], ['درآمد', 'درآمد این هفته'], ['درآمد', 'درآمد هر روز این ماه'], ['درآمد', 'بیشترین درآمد روزانه'], ['درآمد', 'میانگین درآمد روزانه'], ['درآمد', 'درآمد ماه قبل'],
        ['مقایسه', 'مقایسه این هفته با هفته قبل'], ['مقایسه', 'مقایسه این ماه با ماه قبل'], ['مقایسه', 'چرا درآمدم کم شد؟'],
        ['پیش‌بینی', 'پیش‌بینی پایان ماه'], ['پیش‌بینی', 'برای رسیدن به هدف روزی چقدر باید کار کنم؟'],
        ['کدها', 'برترین کدها'], ['کدها', 'کدام کد بازده ساعتی بهتری دارد؟'], ['کدها', '۵ کد برتر ۳ ماه اخیر'], ['کدها', 'کدام کد بیشترین تاخیر را دارد؟'],
        ['تاخیر', 'کارهای با تاخیر'], ['تاخیر', 'نرخ تاخیر این ماه'], ['تاخیر', 'تاخیرهای هفته‌ی قبل'],
        ['زمان', 'کدام روز هفته پرکارتر است؟'], ['زمان', 'ساعت‌های پرکار'], ['زمان', 'چند ساعت کار کردم؟'],
        ['تحلیل', 'تحلیل هوشمند وضعیت من'], ['تحلیل', 'روزهای غیرعادی'], ['تحلیل', 'روزهای بدون کار'], ['تحلیل', 'چند روز پشت سر هم کار کردم؟'], ['تحلیل', 'بررسی سلامت داده‌ها'], ['تحلیل', 'پیشنهادها'],
        ['فهرست', 'آخرین کارهای ثبت‌شده'], ['فهرست', 'کارهای بالای ۱ میلیون'], ['فهرست', 'میانگین‌ها'],
        ['پرسنل', 'عملکرد پرسنل این ماه', 1], ['پرسنل', 'کی بیکاره؟', 1], ['پرسنل', 'کدام کارگر بیشترین تاخیر را دارد؟', 1], ['پرسنل', 'درآمد بخش‌ها', 1]
    ];
    function aHelp(S) {
        const cats = {}; CATALOG.forEach(c => { if (c[2] && !S.emp) return; (cats[c[0]] = cats[c[0]] || []).push(c[1]); });
        const blocks = [B.p('**می‌توانید محاوره‌ای و با غلط املایی هم بپرسید.** سوال را با زمان، کد، نام پرسنل، رنگ یا مدل ترکیب کنید و بعد با «و ماه قبل؟»، «چرا؟» یا «به تفکیک روز» ادامه دهید.'),
            B.table(['نمونه', 'مثال'], [['زمان', 'امروز · دیروز · ۳ روز اخیر · هفته‌ی قبل · مهر · ۱۴۰۵/۰۷/۱۰'], ['فیلتر', 'کد ۶۴۴۹ · علی · بخش برش · کارهای بالای ۲ میلیون'], ['بُعد', 'هر روز · هر کد · روز هفته · ساعت · هر هفته'], ['سنجه', 'درآمد · تعداد · تاخیر · میانگین · بازده ساعتی · مدت'], ['تحلیل', 'مقایسه · چرا؟ · پیش‌بینی · هدف · غیرعادی']])];
        return R(blocks, ['درآمد هر روز این هفته', 'مقایسه با ماه قبل', 'تحلیل هوشمند', S.emp ? 'کی بیکاره؟' : 'روزهای بدون کار']);
    }
    function aFallback(S, P) {
        const q = norm(P.raw).split(' ').filter(w => w.length >= 2 && LX.stop.indexOf(w) < 0).map(stem);
        const sc = CATALOG.filter(c => !c[2] || S.emp).map(c => { const t = norm(c[1]).split(' ').map(stem); let s = 0; q.forEach(w => t.forEach(z => { if (z === w) s += 2; else if (near(z, w)) s += 1; })); return { c: c[1], s }; }).filter(z => z.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
        return R([B.p('دقیق متوجه نشدم. 🤔 می‌توانید زمان یا کد را هم اضافه کنید.'), sc.length ? B.note('شاید منظورتان یکی از این‌ها بود:', 'info') : B.note('یک نمونه از راهنما را امتحان کنید.', 'info')], sc.length ? sc.map(z => z.c) : ['راهنما', 'تحلیل هوشمند', 'درآمد امروز']);
    }
    function aGreet(S, P) {
        const h = new Date().getHours(), g = h < 4 ? 'شب' : h < 12 ? 'صبح' : h < 17 ? 'ظهر' : h < 20 ? 'عصر' : 'شب';
        if (P.flags.thanks) return R([B.p('خواهش می‌کنم! 🌟 هر وقت خواستید بپرسید.')], ['تحلیل هوشمند', 'راهنما']);
        const m = agg(S.m), t = agg(S.recs.filter(x => x.jdn === S.T));
        return R([B.p(`${g} بخیر! 👋 ${t.n ? `امروز ${f(t.n)} کارکرد (${money(t.inc)}) ثبت شده.` : 'امروز هنوز کارکردی ثبت نشده.'}${m.n ? ` از ابتدای ماه ${money(m.inc)} داشته‌اید.` : ''}`)], ['تحلیل هوشمند', 'امروز', 'پیش‌بینی پایان ماه', 'راهنما']);
    }
    function aDisambig(S, P) {
        const nq = norm(P.raw), tk = P.ambig.tok;
        return R([B.p(`چند نفر با نام «${tk}» داریم. منظورتان کدام‌یک است؟`)], P.ambig.list.slice(0, 4).map(n => tk ? nq.split(' ').map(w => w === tk ? n : w).join(' ') : n));
    }

    /* ============================ مسیریاب و زمینه ============================ */
    const ctx = { plan: null };
    function inherit(P, c) {
        if (!c) return P;
        const F = P.filters, cf = c.filters;
        if (!P.metric && c.metric) { P.metric = c.metric; P.metricExplicit = c.metricExplicit; }
        if (!P.range && c.range) P.range = c.range;
        if (!P.dim && c.dim && !(F.workers.length && c.dim === 'worker') && !(F.codes.length && c.dim === 'code') && !(F.sections.length && c.dim === 'section')) P.dim = c.dim;
        if (!P.sup && c.sup) P.sup = c.sup;
        if (!P.topN && c.topN) P.topN = c.topN;
        ['codes', 'workers', 'sections', 'text'].forEach(k => { if (!F[k].length && cf[k].length) F[k] = cf[k].slice(); });
        ['status', 'wd', 'minV', 'maxV', 'minQ', 'maxQ'].forEach(k => { if ((F[k] === null) && cf[k] !== null) F[k] = cf[k]; });
        return P;
    }
    function route(raw) {
        const S = build(), V = vocab(S), P = parse(raw, S, V), fl = P.flags, F = P.filters, c = ctx.plan;
        const anyIntent = fl.help || fl.why || fl.forecast || fl.goal || fl.compare || fl.analysis || fl.summary || fl.anomaly || fl.streak || fl.idle || fl.quality || fl.tips || fl.active || fl.last || fl.first || fl.list || fl.find;
        const anySlot = !!(P.metric || P.dim || P.sup);
        const hasEntity = P.entities > 0 || F.text.length > 0 || F.status || F.wd !== null || F.minV !== null || F.maxV !== null || F.minQ !== null || F.maxQ !== null;
        if (P.ambig) return aDisambig(S, P);
        if ((fl.greet || fl.thanks) && !anyIntent && !anySlot && P.tokenCount <= 5) return aGreet(S, P);
        if (fl.help && P.tokenCount <= 6) return aHelp(S);
        let res;
        /* ادامه‌ی گفتگو (سوال ناقص) */
        if (fl.more && c && !anyIntent) { const P2 = inherit(P, c); P2.topN = (c.topN || 8) * 2; P2.intent = c.intent; return finish(P2, runIntent(S, V, P2, c.intent || 'agg', c), S); }
        const conj = /^(و|پس|یا) /.test(norm(raw)), elliptic = !anyIntent && !anySlot && c && (conj || fl.pron || (P.range && P.tokenCount <= 4));
        if (elliptic) { const P2 = inherit(P, c); return finish(P2, runIntent(S, V, P2, c.intent || 'overview', c), S); }
        if (fl.why) { return finish(P, aWhy(S, P, c), S); }
        if (fl.compare) { if (c && !P.range && !P.ranges.length && !F.workers.length && !F.codes.length) { inherit(P, c); } return finish(P, aCompare(S, P, c), S, 'compare'); }
        if (fl.forecast) return finish(P, aForecast(S, P), S, 'forecast');
        if (fl.goal) return finish(P, aGoal(S, P), S, 'goal');
        if (fl.anomaly) return finish(P, aAnomaly(S), S);
        if (fl.streak) return finish(P, aStreak(S), S);
        if (fl.idle && !(S.emp && (fl.who || /پرسنل|کارگر|نفر/.test(norm(raw))))) return finish(P, aIdle(S, P), S);
        if (fl.quality && !P.metric) return finish(P, aQuality(S), S);
        if (fl.tips) return finish(P, aTips(S, P), S);
        if (fl.active || (fl.idle && S.emp)) { if (fl.idle) fl.idle = true; return finish(P, aActive(S, P), S); }
        if ((fl.analysis || fl.summary) && !hasEntity && !P.range && !anySlot) return finish(P, aAnalysis(S, P), S);
        if (fl.last || fl.first) return finish(P, aList(S, P, fl.last ? 'last' : 'first'), S, 'list');
        if (fl.list || ((fl.late || P.filters.status) && !anySlot && !fl.rate && !P.metric) || ((F.minV !== null || F.maxV !== null || F.minQ !== null || F.maxQ !== null) && !anySlot)) return finish(P, aList(S, P, 'list'), S, 'list');
        if (fl.late && !P.metric) { P.metric = 'late'; }
        /* بدون سنجه و بُعد اما با کلمه‌ی «میانگین» */
        if (fl.avg && !P.metric && !P.dim) return finish(P, aAvgs(S, P), S, 'avgs');
        if (P.dim && !P.metric && !P.sup && !P.flags.busy && ['code', 'worker', 'section', 'title', 'color'].indexOf(P.dim) >= 0) return finish(P, aTable(S, P), S, 'table');
        if (P.metric || P.dim || P.sup) return finish(P, aAgg(S, P), S, 'agg');
        if (hasEntity || P.range) return finish(P, aOverview(S, P), S, 'overview');
        if (fl.analysis || fl.summary) return finish(P, aAnalysis(S, P), S);
        if (P.unknown.length || fl.find) return finish(P, aFind(S, P, V), S);
        return aFallback(S, P);
    }
    function runIntent(S, V, P, intent, c) {
        switch (intent) {
            case 'agg': if (P.dim && !P.metric && !P.sup && ['code', 'worker', 'section', 'title', 'color'].indexOf(P.dim) >= 0) return aTable(S, P); return aAgg(S, P);
            case 'table': return aTable(S, P);
            case 'list': return aList(S, P, 'list');
            case 'compare': return aCompare(S, P, c);
            case 'avgs': return aAvgs(S, P);
            case 'forecast': return aForecast(S, P);
            case 'goal': return aGoal(S, P);
            default: return aOverview(S, P);
        }
    }
    function finish(P, res, S, intent) {
        if (intent && !P.intent) P.intent = intent;
        if (!P.intent) P.intent = (P.metric || P.dim || P.sup) ? 'agg' : 'overview';
        if (['agg', 'table', 'list', 'overview', 'compare', 'avgs'].indexOf(P.intent) >= 0) ctx.plan = { intent: P.intent, metric: P.metric, metricExplicit: P.metricExplicit, dim: P.dim, range: P.range, filters: JSON.parse(JSON.stringify(P.filters)), sup: P.sup, topN: P.topN };
        return res;
    }
    function answer(raw) {
        try { return route(raw); }
        catch (e) { try { console.warn('[AI]', e); } catch (z) { /* بی‌اهمیت */ } return R([B.p('در پردازش این سوال مشکلی پیش آمد. لطفاً آن را کمی ساده‌تر یا به شکل دیگری بپرسید.')], ['راهنما', 'تحلیل هوشمند']); }
    }

    /* ============================ رابط کاربری ============================ */
    const TONE = {
        info: 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700',
        good: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900',
        warn: 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-900'
    };
    const TXT = { info: 'text-slate-500 dark:text-slate-400', good: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400' };
    const FILL = { info: '#6366f1', good: '#10b981', warn: '#f59e0b' };
    function spark(vals, labels, hi) {
        const n = vals.length, W = 300, H = 56, bw = W / n, mx = Math.max.apply(null, vals.concat([1])), mn = Math.min.apply(null, vals.concat([0]));
        let s = `<svg viewBox="0 0 ${W} ${H}" class="w-full h-14 my-1" preserveAspectRatio="none" role="img" aria-label="نمودار">`;
        vals.forEach((v, i) => { const h = Math.max(2, (v - mn) / ((mx - mn) || 1) * (H - 6)), x = W - (i + 1) * bw; s += `<rect x="${(x + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" style="fill:${i === hi ? '#4f46e5' : '#a5b4fc'}"><title>${esc((labels[i] || '') + ': ' + f(v))}</title></rect>`; });
        return s + '</svg>';
    }
    function renderBlock(b) {
        switch (b.k) {
            case 'h': return `<div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100 mb-1.5">${md(b.t)}</div>`;
            case 'p': return `<div class="text-[12px] leading-relaxed mb-1.5">${md(b.t)}</div>`;
            case 'note': return `<div class="text-[11px] leading-relaxed mb-1.5 ${TXT[b.tone || 'info']}">${md(b.t)}</div>`;
            case 'big': return `<div class="rounded-xl border px-3 py-2 mb-2 ${TONE[b.tone || 'info']}"><div class="text-[10.5px] opacity-80">${md(b.label)}</div><div class="text-[17px] font-extrabold leading-snug">${md(b.value)}</div>${b.sub ? `<div class="text-[10.5px] opacity-80 mt-0.5">${md(b.sub)}</div>` : ''}</div>`;
            case 'kv': return `<div class="mb-2 divide-y divide-slate-200/70 dark:divide-slate-700/70">${b.rows.map(r => `<div class="flex items-start justify-between gap-3 py-1 text-[11.5px]"><span class="text-slate-500 dark:text-slate-400">${md(r[0])}</span><b class="text-left">${md(r[1])}</b></div>`).join('')}</div>`;
            case 'bars': return `<div class="mb-2">${b.rows.map(r => `<div class="mb-1.5"><div class="flex items-center justify-between gap-2 text-[11px]"><span class="truncate${r.hi ? ' font-extrabold' : ''}">${esc(r.l)}</span><b class="shrink-0">${esc(r.t)}</b></div><div class="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mt-0.5"><div class="h-full rounded-full" style="width:${r.w.toFixed(1)}%;background:${r.hi ? '#4f46e5' : '#818cf8'}"></div></div></div>`).join('')}</div>`;
            case 'table': return `<div class="overflow-x-auto mb-2 rounded-lg border border-slate-200 dark:border-slate-700"><table class="w-full text-[11px] text-right"><thead class="bg-slate-100 dark:bg-slate-800"><tr>${b.head.map(h => `<th class="px-2 py-1 font-bold whitespace-nowrap">${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr class="border-t border-slate-200 dark:border-slate-700">${r.map((c, i) => { const o = (c && typeof c === 'object') ? c : { t: c }; return `<td class="px-2 py-1 ${i === 0 ? 'font-semibold' : 'whitespace-nowrap'} ${o.tone ? TXT[o.tone] + ' font-bold' : ''}">${esc(o.t)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
            case 'list': return `<ul class="mb-2 space-y-0.5 text-[11.5px]">${b.items.map(i => `<li class="flex gap-1.5"><span class="text-indigo-400">•</span><span>${md(i)}</span></li>`).join('')}</ul>`;
            case 'spark': return `<div class="mb-1.5 rounded-lg bg-white/60 dark:bg-slate-900/40 px-1">${spark(b.vals, b.labels, b.hi)}<div class="flex justify-between text-[9.5px] text-slate-400 px-1"><span>${esc(b.labels[b.labels.length - 1] || '')}</span><span>${esc(b.labels[0] || '')}</span></div></div>`;
            case 'prog': return `<div class="mb-2"><div class="flex justify-between text-[11px] mb-0.5"><span>${esc(b.label)}</span><span class="${TXT[b.tone || 'info']} font-bold">${esc(b.right || '')}</span></div><div class="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div class="h-full rounded-full" style="width:${Math.max(1, Math.min(100, b.pct)).toFixed(1)}%;background:${FILL[b.tone || 'info']}"></div></div></div>`;
            case 'finds': return `<div class="space-y-1.5 mb-2">${b.items.map(o => `<div class="flex items-start gap-2 rounded-xl border px-2.5 py-1.5 text-[11.5px] leading-relaxed ${TONE[o.t] || TONE.info}"><i class="fa-solid ${esc(o.i || 'fa-circle-info')} mt-0.5 text-[10px] opacity-80"></i><span>${esc(o.x)}</span></div>`).join('')}</div>`;
        }
        return '';
    }
    const CHIP = 'tactile-btn shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/30';
    const history = [];
    function renderChat() {
        const a = $('aiAnswer'); if (!a) return;
        if (!history.length) { a.classList.add('hidden'); a.innerHTML = ''; return; }
        a.classList.remove('hidden');
        const lastIdx = history.length - 1;
        a.innerHTML = '<div class="flex justify-end mb-1"><button type="button" onclick="aiClear()" class="text-[10px] text-slate-400 hover:text-rose-500"><i class="fa-solid fa-trash-can ml-1"></i>پاک کردن گفتگو</button></div>'
            + history.map((h, i) => (h.q ? `<div class="flex justify-start mb-1.5"><div class="max-w-[90%] rounded-2xl rounded-tr-sm bg-indigo-600 text-white px-3 py-1.5 text-[12px]">${esc(h.q)}</div></div>` : '')
                + (h.pending ? '<div class="mb-2.5 rounded-2xl rounded-tl-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-400 text-[12px]"><i class="fa-solid fa-ellipsis fa-fade"></i> در حال تحلیل…</div>'
                    : `<div class="mb-2.5 rounded-2xl rounded-tl-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 relative">${h.blocks.map(renderBlock).join('')}<button type="button" onclick="aiCopy(${i})" title="کپی پاسخ" aria-label="کپی پاسخ" class="absolute top-1.5 left-1.5 w-6 h-6 rounded-md text-slate-300 hover:text-indigo-500 flex items-center justify-center"><i class="fa-regular fa-copy text-[10px]"></i></button>${(i === lastIdx && h.chips && h.chips.length) ? `<div class="flex flex-wrap gap-1.5 mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800">${h.chips.map(c => `<button type="button" data-q="${esc(c)}" onclick="aiAskText(this.dataset.q)" class="${CHIP}">${esc(c)}</button>`).join('')}</div>` : ''}</div>`)).join('');
        if (a.lastElementChild && a.lastElementChild.scrollIntoView) a.lastElementChild.scrollIntoView({ block: 'nearest' });
    }
    function submit(q) {
        q = String(q || '').trim(); if (!q) return;
        const e = { q, pending: true, blocks: [], chips: [] }; history.push(e); while (history.length > 8) history.shift(); renderChat();
        setTimeout(() => { const r = answer(q); e.blocks = r.blocks; e.chips = r.chips; e.pending = false; renderChat(); }, 160);
    }
    window.aiAsk = function () { const inp = $('aiInput'); if (!inp) return; const q = inp.value.trim(); if (!q) return; inp.value = ''; hideSuggest(); submit(q); };
    window.aiAskText = function (t) { const inp = $('aiInput'); if (inp) inp.value = ''; hideSuggest(); submit(t); };
    window.aiClear = function () { history.length = 0; ctx.plan = null; renderChat(); };
    window.aiCopy = function (i) { const h = history[i]; if (!h) return; const t = toPlain(h.blocks); try { navigator.clipboard.writeText(t); } catch (e) { /* در دسترس نیست */ } };
    const KIND = { summary: 'خلاصه‌ی این ماه', today: 'امروز', week: 'این هفته', compare: 'مقایسه با ماه قبل', forecast: 'پیش‌بینی پایان ماه', late: 'کارهای با تاخیر', active: 'کار جاری', top: 'برترین کدها', avg: 'میانگین‌ها', hours: 'ساعت‌های پرکار', tips: 'پیشنهادها', workers: 'پرسنل', help: 'راهنما' };
    window.aiChip = function (kind) { const t = KIND[kind]; if (t) submit(t); };
    window.aiRenderInsights = function (manual) { render(); buildChips(); if (manual) window.aiClear(); };

    function render() {
        const el = $('aiInsights'); if (!el) return;
        let list = [];
        try { list = insights(build()); } catch (e) { list = [{ i: 'fa-circle-info', t: 'info', x: 'تحلیل در دسترس نیست.' }]; }
        el.innerHTML = list.map(o => `<div class="flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] leading-relaxed ${TONE[o.t]}"><i class="fa-solid ${o.i} mt-0.5 text-[11px] opacity-80"></i><span>${esc(o.x)}</span></div>`).join('');
        const sub = $('aiSub'); if (sub) sub.textContent = 'تحلیل آفلاین روی همین دستگاه';
    }
    function buildChips() {
        const el = $('aiChips'); if (!el) return;
        let S = null; try { S = build(); } catch (e) { /* بدون هوشمندسازی */ }
        const c = [];
        if (S) {
            if (S.act && S.prog && S.prog.remainingMinutes < 0) c.push('کار جاری');
            if (S.goal > 0 && S.m.length) c.push('برای رسیدن به هدف چه کنم؟');
            if (S.p.length && S.day <= 10) c.push('مقایسه با ماه قبل');
        }
        ['تحلیل هوشمند', 'امروز', 'این هفته', 'درآمد هر روز این ماه', 'پیش‌بینی پایان ماه', 'برترین کدها', 'کدام کد بازده ساعتی بهتری دارد؟', 'کارهای با تاخیر', 'کدام روز هفته پرکارتر است؟', 'روزهای غیرعادی', 'روزهای بدون کار'].forEach(x => c.push(x));
        if (S && S.emp) c.push('کی بیکاره؟', 'عملکرد پرسنل');
        c.push('راهنما');
        el.innerHTML = uniq(c).slice(0, 14).map(x => `<button type="button" data-q="${esc(x)}" onclick="aiAskText(this.dataset.q)" class="${CHIP}">${esc(x)}</button>`).join('');
    }

    /* پیشنهاد هنگام تایپ */
    function hideSuggest() { const s = $('aiSuggest'); if (s) { s.classList.add('hidden'); s.innerHTML = ''; } }
    let typeTm = null;
    function onTypeSoon() { clearTimeout(typeTm); typeTm = setTimeout(onType, 180); }
    function onType() {
        const inp = $('aiInput'), box = $('aiSuggest'); if (!inp || !box) return;
        const t = norm(inp.value); if (t.length < 2) { hideSuggest(); return; }
        let S = null; try { S = build(); } catch (e) { return; }
        const pool = CATALOG.filter(c => !c[2] || S.emp).map(c => c[1]);
        const codes = (S.__codes || (S.__codes = uniq(S.recs.map(x => x.codeRaw)).filter(Boolean).slice(0, 400))); codes.forEach(c => pool.push('کد ' + c));
        S.workers.forEach(w => { if (w && w.name) { pool.push('عملکرد ' + w.name + ' این ماه'); pool.push('درآمد ' + w.name + ' هفته قبل'); } });
        const tk = t.split(' ').map(stem).filter(Boolean);
        const sc = pool.map(p => { const pn = ' ' + norm(p).split(' ').map(stem).join(' '); let s = 0; tk.forEach(w => { if (pn.indexOf(' ' + w) >= 0) s += 2; else if (pn.indexOf(w) >= 0) s += 1; else s -= 3; }); return { p, s }; }).filter(z => z.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
        if (!sc.length) { hideSuggest(); return; }
        box.innerHTML = sc.map(z => `<button type="button" data-q="${esc(z.p)}" onclick="aiAskText(this.dataset.q)" class="block w-full text-right px-3 py-1.5 text-[11.5px] hover:bg-indigo-50 dark:hover:bg-slate-800">${esc(z.p)}</button>`).join('');
        box.classList.remove('hidden');
    }

    let tmr = null; const idle = (fn) => { try { (window.requestIdleCallback || setTimeout)(fn, window.requestIdleCallback ? { timeout: 2500 } : 300); } catch (e) { setTimeout(fn, 300); } };
    const later = () => { clearTimeout(tmr); tmr = setTimeout(() => idle(render), 900); };
    window.addEventListener('load', function () {
        ['renderDashboard'].forEach(n => { const o = window[n]; if (typeof o === 'function') window[n] = function () { const r = o.apply(this, arguments); later(); return r; }; });
        const inp = $('aiInput'); if (inp) { inp.addEventListener('input', onTypeSoon); inp.addEventListener('blur', () => setTimeout(hideSuggest, 200)); }
        /* تحلیل اولیه بعد از بالا آمدن برنامه و در زمان بیکاری انجام می‌شود تا باز شدن برنامه کند نشود */
        setTimeout(() => idle(() => { render(); buildChips(); }), 1500);
    });
})();
