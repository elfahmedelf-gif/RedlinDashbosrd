# تحميل نظام إدارة شركة الشحن والنقل

📦 **الملف**: `shipping-system.tar.gz` (345 KB مضغوط — ~205 ملف)

## ⬇️ طريقة التحميل

اضغط على الرابط التالي لتحميل الملف:
- **التحميل المباشر**: [shipping-system.tar.gz](./shipping-system.tar.gz)

## 📋 ما الذي يحتويه الملف؟

- **src/** — كل كود النظام (Next.js 16 + TypeScript + Tailwind CSS 4)
  - `app/page.tsx` — الصفحة الرئيسية + الـ routing
  - `app/api/*/` — 17+ API route (mock mode)
  - `components/dashboard/` — كل موديولات النظام (shipments, parties, accounting, inventory, reports, ...)
  - `components/ui/` — مكونات shadcn/ui
  - `lib/api.ts` — in-memory API engine (1,111 سطر)
  - `lib/export.ts` — أداة تصدير CSV/Excel
  - `lib/db.ts`, `lib/format.ts`, `lib/lookups.ts` — أدوات مساعدة
- **mock-data.json** — قاعدة البيانات الثابتة (184 شحنة، 150 طرف، 25 حساب، 160 سعر نولون)
- **prisma/schema.prisma** — مخطط قاعدة البيانات (للإنتاج لاحقًا)
- **package.json** + **bun.lock** — الاعتماديات
- **worklog.md** — سجل كل التعديلات والتحسينات
- **.zscripts/** — سكربتات التشغيل والإعداد
- **Caddyfile** — إعدادات الـ gateway

## ❌ ما الذي تم استبعاده؟

- `node_modules/` (1.5 GB) — يُعاد تركيبه بـ `bun install`
- `.next/` (422 MB) — يُعاد بناؤه تلقائيًا
- `.git/` (4.3 MB) — تاريخ الإصدارات
- `tool-results/`, `audit-*.png`, `dev.log` — ملفات مؤقتة

## 🚀 طريقة التشغيل بعد التحميل

```bash
# 1. فك الضغط
tar -xzf shipping-system.tar.gz
cd my-project

# 2. تثبيت الاعتماديات
bun install

# 3. تشغيل خادم التطوير
bun run dev

# 4. افتح المتصفح على
# http://localhost:3000
```

## ⚙️ ملاحظات تقنية

- النظام يعمل بـ **Mock Data Mode** — كل البيانات في الذاكرة (Memory)، لا يحتاج قاعدة بيانات حقيقية للعرض التجريبي.
- للتحويل للإنتاج الفعلي، فعّل Prisma + NextAuth (راجع `worklog.md` المرحلة 1 من خطة الإنتاج).
- اللغة: **العربية** بالكامل (RTL).
- التقنيات: Next.js 16 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui + Recharts.

## 📊 إحصائيات النظام

- **5,100 سطر كود** عبر 17 موديول
- **184 شحنة** بيانات حقيقية
- **150 طرف** (عميل/مقاول/مورد)
- **25 حساب محاسبي** مع قيود مزدوجة متوازنة
- **160 سعر نولون** حسب المناطق

---

للاستفسارات أو الدعم: راجع ملف `worklog.md` داخل المشروع لكل تفاصيل التعديلات والتحسينات.
