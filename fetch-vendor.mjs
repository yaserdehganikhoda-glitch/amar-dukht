// یک‌بار اجرا شود:  node fetch-vendor.mjs www
// Font Awesome و فونت‌های فارسی را در www/vendor/ ذخیره می‌کند تا برنامه بدون CDN و آفلاین کار کند.
// (Tailwind دیگر دانلود نمی‌شود؛ style.css با «npm run build:css» ساخته می‌شود و باید کنار index.html در www باشد.)
// موارد ضروری (Font Awesome، وزیرمتن) اگر دانلود نشوند خطا می‌دهند؛ فونت‌های اختیاری فقط هشدار می‌دهند.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.argv[2] || 'www', 'vendor');
const GH = 'https://cdn.jsdelivr.net/gh/rastikerdar/';
const SETS = [ // [پوشه, ریشه‌های ممکن URL (به ترتیب امتحان می‌شوند), مسیر CSS نسبت به ریشه, ضروری؟]
  ['fontawesome', ['https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/'], 'css/all.min.css', true],
  ['vazirmatn', [GH + 'vazirmatn@v33.003/'], 'Vazirmatn-font-face.css', true],
  ['vazir', [GH + 'vazir-font@v30.1.0/'], 'dist/font-face.css', false],
  ['sahel', [GH + 'sahel-font@v3.4.0/'], 'dist/font-face.css', false],
  ['samim', [GH + 'samim-font@v3.0.0/'], 'dist/font-face.css', false],
  ['shabnam', [GH + 'shabnam-font@v5.0.1/', GH + 'shabnam-font@latest/', GH + 'shabnam-font@v4.0.1/'], 'dist/font-face.css', false]
];

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
async function save(file, buf) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  console.log('✓', file, Math.round(buf.length / 1024) + ' KB');
}

async function fetchSet(name, root, cssPath) {
  const cssUrl = root + cssPath;
  const css = await get(cssUrl);
  const refs = [...new Set([...css.toString().matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)]
    .map(m => { try { const u = new URL(m[1], cssUrl); u.hash = ''; u.search = ''; return u.protocol.startsWith('http') ? u.href : null; } catch { return null; } })
    .filter(Boolean))];
  // یک فرمت کافی است: woff2، وگرنه woff، وگرنه همه
  const pick = ['.woff2', '.woff'].map(e => refs.filter(u => u.endsWith(e))).find(a => a.length) || refs;
  const files = [];
  for (const u of pick) {
    if (!u.startsWith(root)) { console.warn('رد شد (خارج از ریشه):', u); continue; }
    files.push([path.join(OUT, name, u.slice(root.length)), await get(u)]);
  }
  await save(path.join(OUT, name, cssPath), css);
  for (const [f, b] of files) await save(f, b);
}

for (const [name, roots, cssPath, required] of SETS) {
  let done = false, lastErr;
  for (const root of roots) {
    try { await fetchSet(name, root, cssPath); done = true; break; } catch (e) { lastErr = e; }
  }
  if (!done) {
    if (required) throw lastErr;
    console.warn(`⚠ فونت «${name}» دانلود نشد و رد شد (برنامه برای آن از CDN استفاده می‌کند):`, String(lastErr && lastErr.message || lastErr));
  }
}
console.log('\nتمام شد. حالا: npm run build:css ، کپی style.css در www ، سپس npx cap sync android و ساخت دوباره‌ی APK');
