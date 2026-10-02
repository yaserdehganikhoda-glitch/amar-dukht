#!/usr/bin/env python3
"""Installs the Kar home-screen widget into the generated Capacitor android/ project.
Idempotent: safe to run on every build. Run from the repo root after `npx cap add android`."""
import glob, os, re, sys

FILES = {
    'java/KarWidgetPlugin.java': r'''package com.example.karfarma;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "KarWidget")
public class KarWidgetPlugin extends Plugin {
    public static final String A_FINISH = "com.kar.widget.FINISH";

    @Override
    public void load() {
        consume(getActivity() != null ? getActivity().getIntent() : null);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        consume(intent);
    }

    /** لمس «کار تمام شد» روی ویجت: شناسه‌ی رکورد و لحظه‌ی لمس در صف می‌رود و برنامه آن را ثبت می‌کند. */
    private void consume(Intent i) {
        if (i == null || !A_FINISH.equals(i.getAction())) return;
        long id = i.getLongExtra("recId", 0);
        i.setAction(Intent.ACTION_MAIN);
        i.removeExtra("recId");
        if (id <= 0) return;
        SharedPreferences sp = getContext().getSharedPreferences("kar_widget", Context.MODE_PRIVATE);
        try {
            JSONArray a = new JSONArray(sp.getString("pending", "[]"));
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("ts", System.currentTimeMillis());
            a.put(o);
            sp.edit().putString("pending", a.toString()).apply();
        } catch (Exception ignored) { }
        notifyListeners("widgetFinish", new JSObject());
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences("kar_widget", Context.MODE_PRIVATE);
        String s = sp.getString("pending", "[]");
        sp.edit().remove("pending").apply();
        JSObject r = new JSObject();
        try { r.put("items", new JSONArray(s)); } catch (Exception e) { r.put("items", new JSONArray()); }
        call.resolve(r);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context c = getContext();
        c.getSharedPreferences("kar_widget", Context.MODE_PRIVATE).edit().putString("json", call.getString("json", "{}")).apply();
        KarWidgetProvider.refresh(c);
        call.resolve();
    }

    /** خروج کامل: بستن Activity، حذف از لیست برنامه‌های اخیر و پایان دادن به پروسه (بدون ماندن در پس‌زمینه). */
    @PluginMethod
    public void quit(PluginCall call) {
        call.resolve();
        final android.app.Activity a = getActivity();
        if (a == null) { android.os.Process.killProcess(android.os.Process.myPid()); return; }
        a.runOnUiThread(() -> {
            try { a.finishAndRemoveTask(); } catch (Exception e) { a.finish(); }
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                () -> android.os.Process.killProcess(android.os.Process.myPid()), 350);
        });
    }

    @PluginMethod
    public void pin(PluginCall call) {
        Context c = getContext();
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            ok = m != null && m.isRequestPinAppWidgetSupported();
            if (ok) m.requestPinAppWidget(new ComponentName(c, KarWidgetProvider.class), null, null);
        }
        JSObject r = new JSObject();
        r.put("supported", ok);
        call.resolve(r);
    }
}
''',
    'java/KarWidgetProvider.java': r'''package com.example.karfarma;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import com.example.karfarma.R;

/** ویجت صفحه اصلی: کپی دقیق کارت «ویجت پیشرفت کار جاری» داخل برنامه. */
public class KarWidgetProvider extends AppWidgetProvider {
    static final int[] DR = {R.id.kw_dr1, R.id.kw_dr2, R.id.kw_dr3, R.id.kw_dr4, R.id.kw_dr5};
    static final int[] DL = {R.id.kw_dl1, R.id.kw_dl2, R.id.kw_dl3, R.id.kw_dl4, R.id.kw_dl5};
    static final int[] DV = {R.id.kw_dv1, R.id.kw_dv2, R.id.kw_dv3, R.id.kw_dv4, R.id.kw_dv5};
    static final String A_TICK = "com.kar.widget.TICK";

    static final String A_PREV = "com.kar.widget.PREV", A_NEXT = "com.kar.widget.NEXT";

    static String fa(int n) {
        StringBuilder b = new StringBuilder();
        for (char ch : String.valueOf(n).toCharArray()) b.append(ch >= '0' && ch <= '9' ? (char) ('\u06F0' + (ch - '0')) : ch);
        return b.toString();
    }

    static PendingIntent navPi(Context c, String action, int code) {
        Intent i = new Intent(c, KarWidgetProvider.class).setAction(action);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        String a = i == null ? null : i.getAction();
        if (A_TICK.equals(a)) { // تیک دوره‌ای: بدون باز بودن برنامه و بدون اینترنت، زمان و درصد دوباره محاسبه می‌شود
            refresh(c);
            return;
        }
        if (A_PREV.equals(a) || A_NEXT.equals(a)) {
            SharedPreferences sp = c.getSharedPreferences("kar_widget", Context.MODE_PRIVATE);
            int n = 0;
            try {
                JSONArray arr = new JSONObject(sp.getString("json", "{}")).optJSONArray("cards");
                n = arr == null ? 0 : arr.length();
            } catch (Exception ignored) { }
            if (n > 0) {
                int idx = sp.getInt("idx", 0) + (A_NEXT.equals(a) ? 1 : -1);
                sp.edit().putInt("idx", ((idx % n) + n) % n).apply();
            }
            refresh(c);
            return;
        }
        super.onReceive(c, i);
    }

    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, KarWidgetProvider.class));
        if (ids.length == 0) return;
        for (int id : ids) m.updateAppWidget(id, build(c, m, id));
        scheduleTick(c);
    }

    static void scheduleTick(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = System.currentTimeMillis() + 5 * 60 * 1000L;
        PendingIntent pi = navPi(c, A_TICK, 3);
        try {
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC, at, pi);
            else am.set(AlarmManager.RTC, at, pi);
        } catch (Exception ignored) { }
    }

    @Override
    public void onEnabled(Context c) {
        super.onEnabled(c);
        scheduleTick(c);
    }

    @Override
    public void onDisabled(Context c) {
        super.onDisabled(c);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(navPi(c, A_TICK, 3));
    }

    /** «کار تمام شد» روی ویجت: برنامه باز می‌شود و پایان کار با زمان لحظه‌ی لمس ثبت می‌شود. */
    static PendingIntent finishPi(Context c, long recId) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (i == null) return null;
        i.setAction(KarWidgetPlugin.A_FINISH);
        i.putExtra("recId", recId);
        return PendingIntent.getActivity(c, 100 + (int) (recId % 100000), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** درصد، وضعیت و تاخیر را از جدول زمانی که برنامه از قبل محاسبه کرده می‌خواند؛ نیازی به اینترنت یا باز بودن برنامه نیست. */
    static void applyLive(JSONObject k, long now) {
        try {
            JSONArray T = k.optJSONArray("tlT"), E = k.optJSONArray("tlE");
            int target = k.optInt("target", 0), n = T == null ? 0 : T.length();
            if (E == null || n < 2 || E.length() != n || target <= 0) return;
            double el;
            long t0 = T.getLong(0), tl = T.getLong(n - 1);
            if (now <= t0) el = E.getDouble(0);
            else if (now >= tl) el = E.getDouble(n - 1) + (now - tl) / 60000.0;
            else {
                int i = 0;
                while (i < n - 2 && T.getLong(i + 1) <= now) i++;
                long a = T.getLong(i), b = T.getLong(i + 1);
                double ea = E.getDouble(i), eb = E.getDouble(i + 1);
                el = ea + (eb - ea) * (now - a) / (double) Math.max(1L, b - a);
            }
            double rem = target - el;
            int pct = Math.max(0, (int) Math.round(el * 100.0 / target));
            String key = pct >= 100 ? "late" : pct >= 90 ? "urgent" : pct >= 50 ? "warn" : "ok";
            String hex = key.equals("late") ? "#e11d48" : key.equals("urgent") ? "#f97316" : key.equals("warn") ? "#f59e0b" : "#10b981";
            boolean over = key.equals("late");
            int mins = (int) Math.round(Math.abs(rem)), h = mins / 60, mm = mins % 60;
            String txt = (h > 0 ? fa(h) + " ساعت " : "") + (mm > 0 || h == 0 ? fa(mm) + " دقیقه" : "");
            int staleMin = k.optInt("staleMin", 0);
            String p = fa(Math.min(999, pct)) + "\u066A";
            k.put("pct", Math.min(999, pct));
            k.put("ringText", p);
            k.put("badgeText", p);
            k.put("status", key);
            k.put("color", hex);
            k.put("over", over);
            k.put("remainText", txt.trim() + (over ? " تاخیر از موعد" : " تا موعد باقی مانده"));
            k.put("stale", over && staleMin > 0 && -rem > staleMin ? "این کار بیش از ۳ روز کاری معوق است؛ اگر تمام شده، «کار تمام شد» را بزنید." : "");
        } catch (Exception ignored) { }
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, m, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle o) {
        m.updateAppWidget(id, build(c, m, id));
    }

    static int clr(Context c, int res) { return ContextCompat.getColor(c, res); }

    static int parse(String s, int def) {
        try { return Color.parseColor(s); } catch (Exception e) { return def; }
    }

    /** اگر payload جدید (card) نبود، از ساختار قدیمی rows/sub/pill/stats کارت می‌سازد. */
    static JSONObject cardOf(JSONObject o, int idx) {
        JSONArray cs = o.optJSONArray("cards");
        if (cs != null && cs.length() > 0) return cs.optJSONObject(Math.max(0, Math.min(idx, cs.length() - 1)));
        JSONObject card = o.optJSONObject("card");
        if (card != null) return card;
        JSONArray a = o.optJSONArray("rows");
        if (a == null || a.length() == 0) return null;
        try {
            JSONObject r = a.getJSONObject(0), k = new JSONObject();
            k.put("headTitle", o.optString("title", "ویجت پیشرفت کار جاری"));
            k.put("headSub", o.optString("sub", ""));
            k.put("badgeText", o.optString("pill", r.optInt("pct") + "٪"));
            k.put("name", r.optString("name", ""));
            k.put("shop", "");
            k.put("status", r.optString("key", "ok"));
            k.put("jobTitle", r.optString("job", ""));
            k.put("remainText", r.optString("rem", ""));
            k.put("over", r.optBoolean("over"));
            k.put("meta", r.optString("meta", ""));
            k.put("ringText", r.optString("ptxt", r.optInt("pct") + "٪"));
            k.put("pct", r.optInt("pct"));
            k.put("color", r.optString("color", "#10b981"));
            if (o.optJSONArray("stats") != null) k.put("stats", o.optJSONArray("stats"));
            return k;
        } catch (Exception e) { return null; }
    }

    static RemoteViews build(Context c, AppWidgetManager m, int wid) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.kar_widget);
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open != null) {
            PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            v.setOnClickPendingIntent(R.id.kw_root, pi);
            v.setOnClickPendingIntent(R.id.kw_finish, pi); // «کار تمام شد» → باز شدن برنامه
        }

        float d = c.getResources().getDisplayMetrics().density;
        int wDp = 0, hDp = 0;
        try {
            Bundle op = m.getAppWidgetOptions(wid);
            wDp = op.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            hDp = op.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        } catch (Exception ignored) { }
        if (wDp < 120) wDp = 300;
        if (hDp < 80) hDp = 330;

        int track = clr(c, R.color.kw_track), txt = clr(c, R.color.kw_text);
        try {
            JSONObject o = new JSONObject(c.getSharedPreferences("kar_widget", Context.MODE_PRIVATE).getString("json", "{}"));
            JSONArray cs = o.optJSONArray("cards");
            int n = cs == null ? 0 : cs.length();
            SharedPreferences sp = c.getSharedPreferences("kar_widget", Context.MODE_PRIVATE);
            int idx = n > 0 ? Math.max(0, Math.min(sp.getInt("idx", 0), n - 1)) : 0;
            JSONObject k = cardOf(o, idx);
            if (k != null) applyLive(k, System.currentTimeMillis());
            boolean nav = n > 1;
            JSONArray dt = k == null ? null : k.optJSONArray("details");
            int nd = dt == null ? 0 : Math.min(5, dt.length());

            // ارتفاع لازم (dp): پایه + نوار پیمایش؛ هرچه ویجت کوتاه‌تر باشد ابتدا بخش‌های ثانویه حذف می‌شوند
            int need = 252 + (nav ? 42 : 0), ringDp = 78;
            if (hDp < need) { ringDp = 62; need -= 16; }
            boolean showFinish = hDp >= need + 45; if (showFinish) need += 45;
            boolean showDetails = nd > 0 && hDp >= need + 20 + nd * 21; if (showDetails) need += 20 + nd * 21;
            boolean showNote = hDp >= need + 53;

            v.setViewVisibility(R.id.kw_nav, nav ? View.VISIBLE : View.GONE);
            if (nav) {
                v.setTextViewText(R.id.kw_cnt, fa(idx + 1) + " از " + fa(n));
                v.setOnClickPendingIntent(R.id.kw_prev, navPi(c, A_PREV, 1));
                v.setOnClickPendingIntent(R.id.kw_next, navPi(c, A_NEXT, 2));
            }

            if (k == null) { // کار جاری ندارد
                String t = o.optString("title", "");
                v.setTextViewText(R.id.kw_title, "ویجت پیشرفت کار جاری");
                v.setTextViewText(R.id.kw_sub, t.isEmpty() ? "کار جاری ندارید" : t);
                v.setViewVisibility(R.id.kw_pill, View.GONE);
                v.setViewVisibility(R.id.kw_panel, View.GONE);
                v.setViewVisibility(R.id.kw_dt, View.GONE);
                v.setViewVisibility(R.id.kw_empty, View.VISIBLE);
                return v;
            }
            v.setViewVisibility(R.id.kw_panel, View.VISIBLE);
            v.setViewVisibility(R.id.kw_empty, View.GONE);

            String color = k.optString("color", "#10b981");
            int col = parse(color, 0xFF10B981), pct = k.optInt("pct");
            String key = k.optString("status", "ok");
            boolean over = k.optBoolean("over", key.equals("late"));

            v.setTextViewText(R.id.kw_title, k.optString("headTitle", "ویجت پیشرفت کار جاری"));
            v.setTextViewText(R.id.kw_sub, k.optString("headSub", ""));
            v.setViewVisibility(R.id.kw_pill, View.VISIBLE);
            v.setTextViewText(R.id.kw_pill, k.optString("badgeText", pct + "٪"));
            v.setTextColor(R.id.kw_pill, col);

            String name = k.optString("name", "");
            v.setTextViewText(R.id.kw_name, name.isEmpty() ? "وضعیت کار جاری" : name);
            String shop = k.optString("shop", "");
            v.setViewVisibility(R.id.kw_shop, shop.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.kw_shop, shop);

            int bdRes, bdFg; String bdTx;
            switch (key) {
                case "idle":   bdRes = R.drawable.kar_badge_idle;   bdFg = R.color.kw_bd_idle_fg;   bdTx = "بدون کار جاری"; break;
                case "warn":   bdRes = R.drawable.kar_badge_warn;   bdFg = R.color.kw_bd_warn_fg;   bdTx = "در حال کار"; break;
                case "urgent": bdRes = R.drawable.kar_badge_urgent; bdFg = R.color.kw_bd_urgent_fg; bdTx = "نزدیک موعد"; break;
                case "late":   bdRes = R.drawable.kar_badge_late;   bdFg = R.color.kw_bd_late_fg;   bdTx = "⚠ دارای تاخیر"; break;
                default:       bdRes = R.drawable.kar_badge_ok;     bdFg = R.color.kw_bd_ok_fg;     bdTx = "در حال کار";
            }
            v.setViewVisibility(R.id.kw_bd, View.VISIBLE);
            v.setInt(R.id.kw_bd, "setBackgroundResource", bdRes);
            v.setTextColor(R.id.kw_bd, clr(c, bdFg));
            v.setTextViewText(R.id.kw_bd, bdTx);

            int ringPx = (int) (ringDp * d), barH = Math.max(8, (int) (8 * d));
            int barW = Math.max((int) (100 * d), (int) ((wDp - 44) * d));
            v.setImageViewBitmap(R.id.kw_ring, ring(ringPx, pct, col, k.optString("ringText", pct + "٪"), track, txt));
            v.setImageViewBitmap(R.id.kw_bar, bar(barW, barH, pct, col, track));

            v.setTextViewText(R.id.kw_job, k.optString("jobTitle", ""));
            String rem = k.optString("remainText", "");
            v.setViewVisibility(R.id.kw_rem, rem.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.kw_rem, (over ? "⚠ " : "◔ ") + rem);
            v.setTextColor(R.id.kw_rem, clr(c, over ? R.color.kw_bd_late_fg : R.color.kw_text_sub));
            v.setTextViewText(R.id.kw_meta, k.optString("meta", ""));

            String note = k.optString("note", ""), stale = k.optString("stale", "");
            boolean sn = showNote && !note.isEmpty(), ss = showNote && !stale.isEmpty();
            v.setViewVisibility(R.id.kw_note, sn ? View.VISIBLE : View.GONE);
            if (sn) v.setTextViewText(R.id.kw_note, note);
            v.setViewVisibility(R.id.kw_stale, ss ? View.VISIBLE : View.GONE);
            if (ss) v.setTextViewText(R.id.kw_stale, stale);

            v.setViewVisibility(R.id.kw_finish, showFinish && !k.optBoolean("idle", false) ? View.VISIBLE : View.GONE);
            v.setTextViewText(R.id.kw_finish, "✓  " + k.optString("finishText", "کار تمام شد"));

            // دکمه‌ی «کار تمام شد» واقعاً پایان کار را ثبت می‌کند (برنامه باز می‌شود و با زمان لحظه‌ی لمس ثبت می‌کند)
            long rid = k.optLong("recId", 0);
            if (showFinish && rid > 0 && !k.optBoolean("idle", false)) {
                PendingIntent fpi = finishPi(c, rid);
                if (fpi != null) v.setOnClickPendingIntent(R.id.kw_finish, fpi);
            }

            // جزئیات رکورد مربوط به ویجت
            v.setViewVisibility(R.id.kw_dt, showDetails ? View.VISIBLE : View.GONE);
            for (int i = 0; i < 5; i++) {
                boolean on = showDetails && i < nd;
                v.setViewVisibility(DR[i], on ? View.VISIBLE : View.GONE);
                if (on) {
                    JSONObject row = dt.getJSONObject(i);
                    v.setTextViewText(DL[i], row.optString("l", ""));
                    v.setTextViewText(DV[i], row.optString("v", ""));
                }
            }
        } catch (Exception ignored) { }
        return v;
    }

    static Bitmap ring(int s, int pct, int col, String txt, int track, int tcol) {
        Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        float sw = s * 0.12f, pad = sw / 2f + s * 0.07f;
        RectF rf = new RectF(pad, pad, s - pad, s - pad);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(sw);
        p.setColor(track);
        cv.drawOval(rf, p);
        float ratio = Math.max(0f, Math.min(1f, pct / 100f));
        if (ratio > 0f) {
            p.setColor(col);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setShadowLayer(s * 0.05f, 0, 0, (col & 0x00FFFFFF) | 0x80000000);
            cv.drawArc(rf, -90f, 360f * ratio, false, p);
        }
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(tcol);
        t.setTextAlign(Paint.Align.CENTER);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(txt.length() > 4 ? s * 0.22f : s * 0.26f);
        cv.drawText(txt, s / 2f, s / 2f - (t.ascent() + t.descent()) / 2f, t);
        return b;
    }

    static Bitmap bar(int w, int h, int pct, int col, int track) {
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        float r = h / 2f;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(track);
        cv.drawRoundRect(new RectF(0, 0, w, h), r, r, p);
        if (pct > 0) {
            float fw = Math.max(h, w * Math.min(100, pct) / 100f), left = w - fw; // پر شدن از راست (RTL)
            RectF f = new RectF(left, 0, w, h);
            p.setColor(col);
            cv.drawRoundRect(f, r, r, p);
            p.setShader(new LinearGradient(left + fw * 0.1f, 0, left + fw * 0.55f, 0, new int[]{0x00FFFFFF, 0x66FFFFFF, 0x00FFFFFF}, null, Shader.TileMode.CLAMP));
            cv.drawRoundRect(f, r, r, p);
        }
        return b;
    }
}
''',
    'res/layout/kar_widget.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/kw_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/kar_widget_bg"
    android:layoutDirection="rtl"
    android:orientation="vertical">

    <!-- هدر بنفش: آیکون + عنوان/زیرعنوان + بج درصد (چپ) -->
    <LinearLayout
        android:id="@+id/kw_head"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:background="@drawable/kar_widget_head"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingStart="14dp"
        android:paddingTop="12dp"
        android:paddingEnd="14dp"
        android:paddingBottom="12dp">

        <TextView
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:background="@drawable/kar_widget_ico"
            android:gravity="center"
            android:text="⏱"
            android:textColor="#FFFFFF"
            android:textSize="19sp" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="10dp"
            android:layout_weight="1"
            android:orientation="vertical">

            <TextView
                android:id="@+id/kw_title"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:ellipsize="end"
                android:maxLines="1"
                android:text="ویجت پیشرفت کار جاری"
                android:textColor="#FFFFFF"
                android:textDirection="rtl"
                android:textSize="15sp"
                android:textStyle="bold" />

            <TextView
                android:id="@+id/kw_sub"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:ellipsize="end"
                android:maxLines="1"
                android:text="کار جاری ندارید"
                android:textColor="@color/kw_head_sub"
                android:textDirection="rtl"
                android:textSize="11sp" />
        </LinearLayout>

        <TextView
            android:id="@+id/kw_pill"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginStart="8dp"
            android:background="@drawable/kar_widget_pill"
            android:maxLines="1"
            android:paddingStart="14dp"
            android:paddingTop="7dp"
            android:paddingEnd="14dp"
            android:paddingBottom="7dp"
            android:textColor="#6D28D9"
            android:textDirection="rtl"
            android:textSize="13sp"
            android:textStyle="bold"
            android:visibility="gone" />
    </LinearLayout>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:orientation="vertical"
        android:padding="10dp">

        <!-- پنل داخلی «وضعیت کار جاری» -->
        <LinearLayout
            android:id="@+id/kw_panel"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:background="@drawable/kar_widget_card"
            android:orientation="vertical"
            android:padding="12dp">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <LinearLayout
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:orientation="vertical">

                    <TextView
                        android:id="@+id/kw_name"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:ellipsize="end"
                        android:maxLines="1"
                        android:text="وضعیت کار جاری"
                        android:textColor="@color/kw_text"
                        android:textDirection="rtl"
                        android:textSize="15sp"
                        android:textStyle="bold" />

                    <TextView
                        android:id="@+id/kw_shop"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:ellipsize="end"
                        android:maxLines="1"
                        android:textColor="@color/kw_text_sub"
                        android:textDirection="rtl"
                        android:textSize="11sp" />
                </LinearLayout>

                <TextView
                    android:id="@+id/kw_bd"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="6dp"
                    android:background="@drawable/kar_badge_ok"
                    android:maxLines="1"
                    android:paddingStart="12dp"
                    android:paddingTop="6dp"
                    android:paddingEnd="12dp"
                    android:paddingBottom="6dp"
                    android:textDirection="rtl"
                    android:textSize="11sp"
                    android:textStyle="bold"
                    android:visibility="gone" />
            </LinearLayout>

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <ImageView
                    android:id="@+id/kw_ring"
                    android:layout_width="78dp"
                    android:layout_height="78dp"
                    android:layout_marginEnd="12dp"
                    android:scaleType="fitCenter" />

                <LinearLayout
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:orientation="vertical">

                    <TextView
                        android:id="@+id/kw_job"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:ellipsize="end"
                        android:maxLines="2"
                        android:textColor="@color/kw_text"
                        android:textDirection="rtl"
                        android:textSize="14sp"
                        android:textStyle="bold" />

                    <TextView
                        android:id="@+id/kw_rem"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:layout_marginTop="2dp"
                        android:ellipsize="end"
                        android:maxLines="1"
                        android:textColor="@color/kw_text_sub"
                        android:textDirection="rtl"
                        android:textSize="13sp"
                        android:textStyle="bold" />

                    <TextView
                        android:id="@+id/kw_meta"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:layout_marginTop="2dp"
                        android:ellipsize="end"
                        android:maxLines="2"
                        android:textColor="@color/kw_text_meta"
                        android:textDirection="rtl"
                        android:textSize="10sp" />
                </LinearLayout>
            </LinearLayout>

            <ImageView
                android:id="@+id/kw_bar"
                android:layout_width="match_parent"
                android:layout_height="8dp"
                android:layout_marginTop="10dp"
                android:scaleType="fitXY" />

            <TextView
                android:id="@+id/kw_note"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:ellipsize="end"
                android:maxLines="3"
                android:textColor="@color/kw_note"
                android:textDirection="rtl"
                android:textSize="11sp"
                android:visibility="gone" />

            <TextView
                android:id="@+id/kw_stale"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:ellipsize="end"
                android:maxLines="2"
                android:textColor="@color/kw_note"
                android:textDirection="rtl"
                android:textSize="10sp"
                android:visibility="gone" />

            <TextView
                android:id="@+id/kw_finish"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_gravity="start"
                android:layout_marginTop="10dp"
                android:background="@drawable/kar_widget_finish"
                android:paddingStart="16dp"
                android:paddingTop="9dp"
                android:paddingEnd="16dp"
                android:paddingBottom="9dp"
                android:text="✓  کار تمام شد"
                android:textColor="#FFFFFF"
                android:textDirection="rtl"
                android:textSize="13sp"
                android:textStyle="bold"
                android:visibility="gone" />
        </LinearLayout>

        <!-- جزئیات رکوردِ مربوط به ویجت -->
        <LinearLayout
            android:id="@+id/kw_dt"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:background="@drawable/kar_widget_stat"
            android:orientation="vertical"
            android:paddingStart="12dp"
            android:paddingTop="6dp"
            android:paddingEnd="12dp"
            android:paddingBottom="6dp"
            android:visibility="gone">

            <LinearLayout
                android:id="@+id/kw_dr1"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal"
                android:paddingTop="3dp"
                android:paddingBottom="3dp"
                android:visibility="gone">

                <TextView
                    android:id="@+id/kw_dl1"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:textColor="@color/kw_text_sub"
                    android:textDirection="rtl"
                    android:textSize="11sp" />

                <TextView
                    android:id="@+id/kw_dv1"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="10dp"
                    android:layout_weight="1"
                    android:ellipsize="end"
                    android:gravity="end"
                    android:maxLines="1"
                    android:textColor="@color/kw_text"
                    android:textDirection="rtl"
                    android:textSize="12sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/kw_dr2"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal"
                android:paddingTop="3dp"
                android:paddingBottom="3dp"
                android:visibility="gone">

                <TextView
                    android:id="@+id/kw_dl2"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:textColor="@color/kw_text_sub"
                    android:textDirection="rtl"
                    android:textSize="11sp" />

                <TextView
                    android:id="@+id/kw_dv2"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="10dp"
                    android:layout_weight="1"
                    android:ellipsize="end"
                    android:gravity="end"
                    android:maxLines="1"
                    android:textColor="@color/kw_text"
                    android:textDirection="rtl"
                    android:textSize="12sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/kw_dr3"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal"
                android:paddingTop="3dp"
                android:paddingBottom="3dp"
                android:visibility="gone">

                <TextView
                    android:id="@+id/kw_dl3"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:textColor="@color/kw_text_sub"
                    android:textDirection="rtl"
                    android:textSize="11sp" />

                <TextView
                    android:id="@+id/kw_dv3"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="10dp"
                    android:layout_weight="1"
                    android:ellipsize="end"
                    android:gravity="end"
                    android:maxLines="1"
                    android:textColor="@color/kw_text"
                    android:textDirection="rtl"
                    android:textSize="12sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/kw_dr4"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal"
                android:paddingTop="3dp"
                android:paddingBottom="3dp"
                android:visibility="gone">

                <TextView
                    android:id="@+id/kw_dl4"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:textColor="@color/kw_text_sub"
                    android:textDirection="rtl"
                    android:textSize="11sp" />

                <TextView
                    android:id="@+id/kw_dv4"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="10dp"
                    android:layout_weight="1"
                    android:ellipsize="end"
                    android:gravity="end"
                    android:maxLines="1"
                    android:textColor="@color/kw_text"
                    android:textDirection="rtl"
                    android:textSize="12sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/kw_dr5"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal"
                android:paddingTop="3dp"
                android:paddingBottom="3dp"
                android:visibility="gone">

                <TextView
                    android:id="@+id/kw_dl5"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:textColor="@color/kw_text_sub"
                    android:textDirection="rtl"
                    android:textSize="11sp" />

                <TextView
                    android:id="@+id/kw_dv5"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="10dp"
                    android:layout_weight="1"
                    android:ellipsize="end"
                    android:gravity="end"
                    android:maxLines="1"
                    android:textColor="@color/kw_text"
                    android:textDirection="rtl"
                    android:textSize="12sp"
                    android:textStyle="bold" />
            </LinearLayout>
        </LinearLayout>

        <!-- پیمایش بین پرسنل (فقط حالت کارفرما و بیش از یک نفر) -->
        <LinearLayout
            android:id="@+id/kw_nav"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:gravity="center_vertical"
            android:orientation="horizontal"
            android:visibility="gone">

            <TextView
                android:id="@+id/kw_prev"
                android:layout_width="52dp"
                android:layout_height="34dp"
                android:background="@drawable/kar_widget_stat"
                android:gravity="center"
                android:text="›"
                android:textColor="@color/kw_text"
                android:textSize="22sp"
                android:textStyle="bold" />

            <TextView
                android:id="@+id/kw_cnt"
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:gravity="center"
                android:textColor="@color/kw_text_sub"
                android:textDirection="rtl"
                android:textSize="12sp"
                android:textStyle="bold" />

            <TextView
                android:id="@+id/kw_next"
                android:layout_width="52dp"
                android:layout_height="34dp"
                android:background="@drawable/kar_widget_stat"
                android:gravity="center"
                android:text="‹"
                android:textColor="@color/kw_text"
                android:textSize="22sp"
                android:textStyle="bold" />
        </LinearLayout>

        <TextView
            android:id="@+id/kw_empty"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center"
            android:padding="14dp"
            android:text="کار جاری ندارید"
            android:textColor="@color/kw_text_sub"
            android:textDirection="rtl"
            android:textSize="13sp"
            android:visibility="gone" />
    </LinearLayout>
</LinearLayout>
''',
    'res/values/kar_widget_colors.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="kw_bg">#FFFFFF</color>
    <color name="kw_stroke">#CBD5E1</color>
    <color name="kw_text">#1E293B</color>
    <color name="kw_text_sub">#64748B</color>
    <color name="kw_text_meta">#94A3B8</color>
    <color name="kw_track">#E2E8F0</color>
    <color name="kw_fill">#10B981</color>
    <color name="kw_card_bg">#F8FAFC</color>
    <color name="kw_card_stroke">#E2E8F0</color>
    <color name="kw_stat_bg">#F1F5F9</color>
    <color name="kw_head_sub">#E6FFFFFF</color>
    <color name="kw_bd_ok_bg">#D1FAE5</color>
    <color name="kw_bd_ok_fg">#047857</color>
    <color name="kw_bd_warn_bg">#FEF3C7</color>
    <color name="kw_bd_warn_fg">#B45309</color>
    <color name="kw_bd_urgent_bg">#FFEDD5</color>
    <color name="kw_bd_urgent_fg">#C2410C</color>
    <color name="kw_bd_late_bg">#FFE4E6</color>
    <color name="kw_bd_late_fg">#BE123C</color>
    <color name="kw_bd_idle_bg">#E2E8F0</color>
    <color name="kw_bd_idle_fg">#475569</color>
    <color name="kw_note">#B45309</color>
</resources>
''',
    'res/values-night/kar_widget_colors.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="kw_bg">#0F172A</color>
    <color name="kw_stroke">#475569</color>
    <color name="kw_text">#F1F5F9</color>
    <color name="kw_text_sub">#94A3B8</color>
    <color name="kw_text_meta">#94A3B8</color>
    <color name="kw_track">#334155</color>
    <color name="kw_fill">#10B981</color>
    <color name="kw_card_bg">#1E293B</color>
    <color name="kw_card_stroke">#334155</color>
    <color name="kw_stat_bg">#8C334155</color>
    <color name="kw_head_sub">#E6FFFFFF</color>
    <color name="kw_bd_ok_bg">#2910B981</color>
    <color name="kw_bd_ok_fg">#6EE7B7</color>
    <color name="kw_bd_warn_bg">#29F59E0B</color>
    <color name="kw_bd_warn_fg">#FCD34D</color>
    <color name="kw_bd_urgent_bg">#29F97316</color>
    <color name="kw_bd_urgent_fg">#FDBA74</color>
    <color name="kw_bd_late_bg">#2EE11D48</color>
    <color name="kw_bd_late_fg">#FDA4AF</color>
    <color name="kw_bd_idle_bg">#2994A3B8</color>
    <color name="kw_bd_idle_fg">#CBD5E1</color>
    <color name="kw_note">#FCD34D</color>
</resources>
''',
    'res/drawable/kar_widget_bg.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_bg" />
    <stroke android:width="1dp" android:color="@color/kw_stroke" />
    <corners android:radius="22dp" />
</shape>
''',
    'res/drawable/kar_widget_card.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_card_bg" />
    <stroke android:width="1dp" android:color="@color/kw_card_stroke" />
    <corners android:radius="20dp" />
</shape>
''',
    'res/drawable/kar_widget_stat.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_stat_bg" />
    <corners android:radius="16dp" />
</shape>
''',
    'res/drawable/kar_widget_pill.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFFFFF" />
    <corners android:radius="20dp" />
</shape>
''',
    'res/drawable/kar_widget_ico.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#33FFFFFF" />
    <stroke android:width="1dp" android:color="#59FFFFFF" />
    <corners android:radius="14dp" />
</shape>
''',
    'res/drawable/kar_widget_head.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:angle="315" android:startColor="#6D4AE8" android:centerColor="#8B5CF6" android:endColor="#A45BF5" />
    <corners android:topLeftRadius="21dp" android:topRightRadius="21dp" />
</shape>
''',
    'res/xml/kar_widget_info.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="320dp"
    android:minResizeWidth="200dp"
    android:minResizeHeight="150dp"
    android:targetCellWidth="4"
    android:targetCellHeight="4"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/kar_widget"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen" />
''',
    'res/drawable/kar_badge_ok.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_bd_ok_bg" />
    <corners android:radius="18dp" />
</shape>
''',
    'res/drawable/kar_badge_warn.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_bd_warn_bg" />
    <corners android:radius="18dp" />
</shape>
''',
    'res/drawable/kar_badge_urgent.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_bd_urgent_bg" />
    <corners android:radius="18dp" />
</shape>
''',
    'res/drawable/kar_badge_late.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_bd_late_bg" />
    <corners android:radius="18dp" />
</shape>
''',
    'res/drawable/kar_badge_idle.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/kw_bd_idle_bg" />
    <corners android:radius="18dp" />
</shape>
''',
    'res/drawable/kar_widget_finish.xml': r'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:angle="0" android:startColor="#059669" android:endColor="#10B981" />
    <corners android:radius="18dp" />
</shape>
''',
}

STALE = ['res/drawable/kar_widget_progress.xml']

ANDROID = 'android'
MAIN = os.path.join(ANDROID, 'app', 'src', 'main')

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

# ---- 1. find MainActivity and package ----
mains = glob.glob(os.path.join(MAIN, 'java', '**', 'MainActivity.java'), recursive=True)
if not mains:
    sys.exit('ERROR: MainActivity.java not found under ' + MAIN)
main_path = mains[0]
main_src = read(main_path)
pkg = re.search(r'^package\s+([\w.]+)\s*;', main_src, re.M).group(1)

ns = pkg
for g in ('app/build.gradle', 'app/build.gradle.kts'):
    gp = os.path.join(ANDROID, g)
    if os.path.exists(gp):
        m = re.search(r'namespace\s*=?\s*["\']([\w.]+)["\']', read(gp))
        if m:
            ns = m.group(1)
            break
print('package =', pkg, '| R namespace =', ns)

# ---- 2. copy java + res ----
java_dir = os.path.dirname(main_path)
for rel, content in FILES.items():
    if rel.startswith('java/'):
        content = re.sub(r'^package\s+[\w.]+\s*;', 'package ' + pkg + ';', content, count=1, flags=re.M)
        content = re.sub(r'^import\s+[\w.]+\.R;', 'import ' + ns + '.R;', content, flags=re.M)
        write(os.path.join(java_dir, os.path.basename(rel)), content)
    else:
        write(os.path.join(MAIN, rel), content)
for rel in STALE:
    sp = os.path.join(MAIN, rel)
    if os.path.exists(sp):
        os.remove(sp)
print('widget files copied')

# ---- 3. AndroidManifest: add receiver ----
mf_path = os.path.join(MAIN, 'AndroidManifest.xml')
mf = read(mf_path)
if 'KarWidgetProvider' not in mf:
    receiver = (
        '\n        <receiver android:name="' + pkg + '.KarWidgetProvider" android:exported="false">\n'
        '            <intent-filter>\n'
        '                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />\n'
        '            </intent-filter>\n'
        '            <meta-data android:name="android.appwidget.provider" android:resource="@xml/kar_widget_info" />\n'
        '        </receiver>\n'
    )
    if '</application>' not in mf:
        sys.exit('ERROR: </application> not found in AndroidManifest.xml')
    mf = mf.replace('</application>', receiver + '    </application>', 1)
    write(mf_path, mf)
    print('receiver added to manifest')
else:
    print('manifest already has receiver')

# ---- 4. MainActivity: register plugin ----
if 'registerPlugin(KarWidgetPlugin.class)' in main_src:
    print('plugin already registered')
else:
    if 'import android.os.Bundle;' not in main_src:
        main_src = re.sub(r'(^package\s+[\w.]+\s*;[ \t]*\n)', r'\1\nimport android.os.Bundle;\n', main_src, count=1, flags=re.M)
    if re.search(r'super\.onCreate\(', main_src):
        main_src = re.sub(r'([ \t]*)super\.onCreate\(', r'\1registerPlugin(KarWidgetPlugin.class);\n\1super.onCreate(', main_src, count=1)
    elif re.search(r'extends\s+BridgeActivity\s*\{\s*\}', main_src):
        main_src = re.sub(
            r'(extends\s+BridgeActivity\s*)\{\s*\}',
            r'\1{\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(KarWidgetPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}',
            main_src, count=1)
    else:
        sys.exit('ERROR: could not patch MainActivity.java automatically')
    write(main_path, main_src)
    print('plugin registered in MainActivity')
