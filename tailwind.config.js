/** تنظیمات ساخت CSS نهایی (Tailwind v3). هر بار که کلاس جدیدی در HTML/JS اضافه کردید، دوباره build بزنید. */
module.exports = {
  darkMode: 'class',
  // همه‌ی فایل‌هایی که ممکن است کلاس Tailwind داشته باشند (premium.js و … هم پوشش داده می‌شوند)
  content: ['./*.html', './*.js', '!./sw.js', '!./tailwind.config.js', '!./vendor/**', '!./node_modules/**'],
  // کلاس‌هایی که در کد به‌صورت تکه‌تکه ساخته می‌شوند و اسکنر آن‌ها را نمی‌بیند، اینجا اضافه کنید
  safelist: [],
  theme: { extend: {} },
  plugins: []
};
