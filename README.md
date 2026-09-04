# نظام إدارة محل السبائك والمشغولات الفضية

نظام متكامل لإدارة محل الذهب والفضة وفق PRD «السبائك والمشغولات»: مخزون مركزي، تسعير يومي سجلّي، فروع متعددة، نقاط بيع، صلاحيات، تدقيق، وتقارير.

## المكدس

| الطبقة | التقنية |
|---|---|
| الواجهة | React 19 + TypeScript + Vite + Tailwind CSS v4 + TanStack Query + Zustand |
| الخادم | Express + TypeScript (TSX) |
| قاعدة البيانات | PostgreSQL 16 |
| المصادقة | JWT + رمز PIN مكوّن من 4 خانات |

## التشغيل

```bash
# 1) إعداد قاعدة البيانات (مرة واحدة — يتطلب صلاحيات sudo لإنشاء المستخدم)
npm run setup          # = sudo bash scripts/setup_db.sh

# 2) تشغيل الخادم + الواجهة في نافذتين
npm run api            # الخادم على :4001
npm run web            # الواجهة على :5174

# إعادة ضبط قاعدة البيانات لحالة نظيفة (حذف وزرع بيانات البداية)
npm run db:reset

# اختبار شامل لنقاط النهاية (بيع، إرجاع، نقل، حجز، جرد، تصفية كاشير)
npm run smoke
```

افتح `http://localhost:5174/` وسجّل الدخول.

## النشر على خادم نظيف (إنتاج)

المشروع يُنشر كعملية Node واحدة تخدم الواجهة المبنية وواجهة API والملفات على منفذ واحد
(Express يقدم `client/dist` + `/api` + `/uploads`).

```bash
# على سيرفر Ubuntu/Debian نظيف، انسخ المشروع ثم:
sudo bash scripts/deploy_vps.sh
```

السكربت يقوم تلقائيًا بـ:
1. تثبيت Node.js 22 LTS و PostgreSQL.
2. نسخ المشروع إلى `/opt/jewelry` وتركيب الاعتماديات.
3. توليد `server/.env` (بما فيه `JWT_SECRET` عشوائي).
4. إنشاء قاعدة البيانات وتحميل `schema.sql` + `seed.sql` + تطبيق `db/migrations/*.sql` بالترتيب.
5. بناء الخادم (`tsc`) والواجهة (`vite build`).
6. إنشاء خدمة systemd (`jewelry.service`) تعمل تلقائيًا عند الإقلاع مع إعادة تشغيل عند الفشل.

### متغيرات قابلة للتخصيص (تُصدَّر قبل التشغيل)

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `APP_PORT` | `4001` | منفذ التطبيق |
| `INSTALL_DIR` | `/opt/jewelry` | مسار التثبيت |
| `GIT_URL` | — | بدل النسخ المحلي، يستنسخ من رابط Git |
| `DB_DUMP_FILE` | — | مسار نسخة `pg_dump` لاستعادة بيانات حقيقية بدل seed |
| `UPLOADS_SRC` | — | مجلد `uploads/` حالي لنقل صور القطع |
| `DB_PASS` | عشوائي | كلمة مرور قاعدة البيانات |

> لنشر بيانات المتجر الحالية: صدّر قاعدة البيانات الحالية (`pg_dump`) وضع المسار في
> `DB_DUMP_FILE`، وانسخ مجلد الصور في `UPLOADS_SRC` (صور القطع محفوظة في `server/uploads/`).

### التحديث لاحقًا

```bash
cd /opt/jewelry      # أو انسخ المشروع الجديد فوقه
sudo bash scripts/deploy_vps.sh   # يعيد البناء ويطبق أي migrations جديدة
sudo systemctl restart jewelry
```

السجلات: `journalctl -u jewelry -f`. للـ HTTPS استخدم وكيل عكسي (Caddy/nginx) يوجّه إلى `127.0.0.1:4001`.

### حسابات البداية (رمز PIN: `1234` للجميع)

| اسم المستخدم | الدور |
|---|---|
| `manager` | مدير المحل — كل الصلاحيات |
| `cashier` | كاشير — نقطة بيع + أذونات محدودة |
| `social` | سوشيال — بيع/حجز من المخزون المركزي |

## ملاحظات بيئة التطوير

- الخادم يعمل على **المنفذ 4001** (4000 مشغول بتطبيق آخر على الجهاز).
- الواجهة تعمل على **المنفذ 5174** (5173 مشغول).
- PostgreSQL على **المنفذ 5433**، المستخدم `jewelry` / `jewelry123`، قاعدة `jewelry`.

## المبادئ الأساسية

- **عدم الحذف المادي**: كل البيانات مرتبطة بمعرّفات ثابتة (رقم الموظف / رقم القطعة / رقم الفرع) — الحذف المنطقي فقط.
- **تسعير يومي سجلّي**: `price_history` يحفظ كل سعر + تغييره حسب المعدن والعيار، و`item_status_history` يوثّق تغييرات حالة كل قطعة.
- **نقطة بيع تعمل بدون إنترنت**: طلبات خارجية تُخزَّن في `sync_outbox` وتُزامن تلقائيًا عند عودة الاتصال.
- **سقف الخصم**: فوق النسبة المسموحة يتطلب الرمز الشخصي للمدير (حقل `discount.requires_manager`).
- **الجرد (stock count)**: عدّ فعلي مع حسم إجباري للفروقات + تقرير انحراف، وأعلى/أدنى حد مخزون مع تنبيهات.

## البنية

```
db/                 schema.sql + seed.sql + migrations/
server/             Express API (routes/*, middleware, db, utils) — يبنى إلى dist/
client/             React app (pages/, components/, stores/, hooks/, lib/) — يبنى إلى dist/
scripts/            setup_db.sh، reset_db.sh، smoke_test.sh، deploy_vps.sh (نشر إنتاج)
```

## فحص النوع

```bash
npm run typecheck   # tsc للخادم + بناء الواجهة
```

## البناء والإنتاج

```bash
npm run build       # tsc للخادم (server/dist) + vite build للواجهة (client/dist)
npm start           # تشغيل الخادم المبني (node server/dist/index.js)
```

## Docker و Coolify

أضيفت ملفات Docker للإنتاج:

```bash
docker compose up --build
```

في Coolify اختر Docker Compose deployment واجعل `docker-compose.yaml` هو مصدر الإعداد. الملف يعرّف ثلاث خدمات:

- `app`: نظام الـ POS الأساسي، يبني الواجهة والخادم في صورة واحدة، ويستمع داخل الحاوية على المنفذ `4001`.
- `b2b`: متجر الجملة المستقل، يبني واجهته وخادمه في صورة واحدة، ويستمع داخل الحاوية على المنفذ `4100`.
- `postgres`: PostgreSQL 16 داخلي، غير مكشوف للعالم الخارجي.

يعتمد الملف على توجيه Coolify عبر المتغيرات السحرية `SERVICE_URL_APP_4001` و `SERVICE_URL_B2B_4100`، لذلك لا توجد `ports` مفتوحة مباشرة على الخادم. اربط دومين الـ POS بخدمة `app`، ودومين متجر الجملة بخدمة `b2b`.

يحفظ Compose بيانات PostgreSQL في `postgres-data`، وصور الرفع الخاصة بالـ POS في `uploads-data`، وبيانات SQLite الخاصة بمتجر الجملة في `b2b-shop-data`. متجر الجملة يتصل بالـ POS داخلياً عبر `API_BASE_URL=http://app:4001`.

عند أول تشغيل فقط، تهيّئ قاعدة البيانات تلقائياً من:

1. `db/schema.sql`
2. `db/seed.sql`
3. `db/migrations/*.sql`

يمكن تعديل هذه المتغيرات من واجهة Coolify عند الحاجة: `PGUSER`, `PGDATABASE`, `SERVICE_PASSWORD_POSTGRES`, `SERVICE_REALBASE64_64_JWT`, `SERVICE_REALBASE64_64_B2B`, `B2B_USERNAME`, و `B2B_PIN`.
