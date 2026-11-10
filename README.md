# JobBuddy

ผู้ช่วยหางานใน LINE — รวมงานจากหลายเว็บ, บันทึกงานที่สมัคร, ปฏิทินสัมภาษณ์ และโน้ต ไว้ที่เดียว
แค่เพิ่มเพื่อน LINE Official Account ก็ใช้ได้เลย

> สถานะ: 🚧 ใช้งานได้: PDPA → ตั้งค่างาน → 🔍 งานใหม่วันนี้ (~480 งานในไทยจาก 15 บริษัท) →
> ⭐ เก็บไว้ / ✅ สมัครแล้ว / ❌ ไม่สนใจ / 📤 แชร์ให้เพื่อน → ดูรายการที่เก็บ/สมัครไว้ →
> 📥 ส่งลิงก์งานจากเว็บไหนก็ได้ → 🔄 สถานะการสมัคร → 📝 โน้ตต่องาน →
> 📅 นัดสัมภาษณ์ (เลือกจากปฏิทิน หรือพิมพ์ "พรุ่งนี้ บ่ายสอง") + ⏰ เตือนคืนก่อน 19:00 และ 2 ชม. ก่อน
> ถัดไป: อีเมลส่งต่อเพื่ออัปเดตสถานะอัตโนมัติ, Careerjet/Jooble

## ฟีเจอร์ (แผน)

- 🎯 ตั้งค่าตำแหน่ง / จังหวัด / เงินเดือนที่อยากได้ (หลายชุด)
- 📥 ส่งลิงก์งานให้บอท → ดึงข้อมูลและบันทึกให้อัตโนมัติ
- ✅ บันทึกการสมัคร + สถานะ `สมัครแล้ว → ได้รับการติดต่อ → นัดสัมภาษณ์ → รอผล → ได้งาน / ไม่ผ่าน`
- 📅 นัดสัมภาษณ์ด้วยภาษาพูด + แจ้งเตือนล่วงหน้าใน LINE
- 📝 โน้ตต่องาน / ต่อการสัมภาษณ์
- 📧 อีเมลส่งต่อส่วนตัวต่อผู้ใช้ เพื่ออัปเดตสถานะจากอีเมลตอบรับ / เชิญสัมภาษณ์

## สถาปัตยกรรม

| ส่วน          | เทคโนโลยี                                                     |
| ------------- | ------------------------------------------------------------- |
| ช่องทางผู้ใช้ | LINE Messaging API + Rich Menu + LIFF                         |
| Backend       | Node.js + TypeScript                                          |
| ฐานข้อมูล     | PostgreSQL (Railway)                                          |
| Hosting       | Railway — services: `api`, `worker`, `cron`, `Postgres`       |
| รับอีเมล      | Cloudflare Email Routing → Email Worker → `api`               |
| AI            | Claude (อ่านลิงก์งาน, แปลงข้อความเป็นวันเวลา, จัดประเภทอีเมล) |

### หลักการประหยัดโควต้า LINE

- ใช้ **Reply** (ฟรี ไม่จำกัด) เป็นหลัก — ผู้ใช้กดปุ่มใน Rich Menu เพื่อดึงข้อมูลเอง
- ใช้ **Push** เฉพาะแจ้งเตือนสัมภาษณ์ และรวมหลายข้อความเป็นการส่งครั้งเดียว

## โครงสร้างโค้ด

```
src/
├── server.ts            # entry point: ประกอบทุกส่วนแล้วเปิด HTTP server
├── app.ts               # Hono routes: GET /health, POST /webhooks/line
├── config/env.ts        # ตรวจ environment variables ด้วย zod
├── db/                  # Drizzle schema, client, migration runner
├── jobs/
│   ├── sources.ts       # รายชื่อบริษัท + ATS ที่ดึงงาน
│   ├── providers.ts     # fetcher ของ Greenhouse / Lever / SmartRecruiters
│   ├── sync.ts          # ดึงงานตามรอบ (ค่าเริ่มต้นทุก 6 ชม.)
│   ├── match.ts         # ให้คะแนนงานเทียบกับการตั้งค่าของผู้ใช้
│   ├── synonyms.ts      # คำไทย → คำอังกฤษในชื่อตำแหน่ง (เช่น บัญชี → accountant)
│   └── location.ts, repository.ts
├── line/
│   ├── handlers.ts      # router: follow / consent / menu / wizard / งาน / ลบข้อมูล
│   ├── jobActions.ts    # ฟีดงาน, เก็บ/สมัคร/ซ่อน, รายการที่เก็บ/สมัครไว้
│   ├── jobCards.ts      # การ์ดงาน (Flex carousel) + ลิงก์แชร์ให้เพื่อน
│   ├── tracking.ts      # ส่งลิงก์งาน, โน้ต, สถานะการสมัคร
│   ├── interviews.ts    # นัดสัมภาษณ์: date picker, สถานที่/ลิงก์, รายการนัด, ข้อความเตือน
│   ├── stages.ts        # ขั้นของการสมัคร: สมัครแล้ว → ติดต่อ → สัมภาษณ์ → รอผล → ได้/ไม่ได้
│   ├── messages.ts      # ข้อความตอบกลับทั้งหมด
│   ├── richmenu.ts      # layout เมนู + sync กับ LINE ตอน start
│   ├── messenger.ts     # wrapper ของ LINE Messaging API
│   └── postback.ts, ui.ts
├── interviews/
│   ├── time.ts          # เวลาตาม APP_TIMEZONE, อ่านเวลาที่พิมพ์ภาษาไทย, กติกาการเตือน
│   ├── reminders.ts     # รอบส่งเตือน (ทุก 5 นาที) — จองสิทธิ์ใน DB ก่อน push จึงไม่ส่งซ้ำ
│   └── repository.ts
├── links/
│   ├── preview.ts       # อ่านชื่องานจากลิงก์: ATS API หรือ <title>/og: ของหน้าเว็บ
│   └── safeFetch.ts     # ดึงหน้าเว็บแบบกัน SSRF (ห้าม IP ภายใน/พอร์ตแปลก)
├── notes/repository.ts  # โน้ตต่องาน
├── prefs/               # ตั้งค่างาน: wizard (state machine), parse, repository
├── conversation/        # สถานะการคุยหลายขั้น (หมดอายุ 30 นาที)
├── users/repository.ts  # ตาราง users (+ consent, ลบข้อมูล)
└── lib/logger.ts        # JSON logger
assets/richmenu-main.png # รูป Rich Menu (สร้างด้วย npm run richmenu:image)
scripts/                 # เครื่องมือสำหรับนักพัฒนา
drizzle/                 # SQL migrations (สร้างด้วย npm run db:generate)
tests/                   # vitest
```

## แหล่งงาน

ดึงจาก **API สาธารณะของระบบรับสมัครงาน (ATS)** ที่บริษัทเปิดไว้ให้นำประกาศไปแสดงต่อ
เก็บแค่สรุป (ตำแหน่ง บริษัท สถานที่) แล้วลิงก์กลับไปที่ประกาศต้นทางเสมอ — ไม่ดูดข้อมูลจากเว็บหางาน

- เก็บเฉพาะงานในไทย, upsert ตาม `(provider, board, external_id)`, งานที่หายจากบอร์ดจะถูกตั้ง `active = false`
- บอร์ดที่ดึงไม่สำเร็จจะ **ไม่** ถูกปิดงาน (กัน API ล่มชั่วคราวแล้วงานหายหมด)
- เพิ่มบริษัท: ตรวจว่าบอร์ดมีงานในไทย แล้วเพิ่มใน `src/jobs/sources.ts`
- ปิดการดึงด้วย `JOB_SYNC=false`, เปลี่ยนรอบด้วย `JOB_SYNC_INTERVAL_HOURS`

### งานจากลิงก์ที่ผู้ใช้ส่งมา

- ลิงก์ Greenhouse / Lever / SmartRecruiters → อ่านผ่าน API สาธารณะ (ถ้าเป็นงานที่ sync อยู่แล้วจะใช้แถวเดิม)
- เว็บอื่น → ดึงหน้าเว็บ **ครั้งเดียว** อ่านแค่ `<title>` / `og:title` / `og:site_name` (เหมือน link preview)
  ถ้าอ่านไม่ได้ (ต้องล็อกอิน, กันบอท) บอทจะถามชื่อตำแหน่งจากผู้ใช้แทน
- เก็บเป็น `provider = 'link'` — ไม่โผล่ในฟีดของคนอื่น
- `safeFetch` ปฏิเสธ IP ภายใน (127/8, 10/8, 169.254/16, …), `localhost`, `*.internal` และพอร์ตที่ไม่ใช่ 80/443
  ตรวจตอน DNS lookup ของ socket จริง จึงกัน DNS rebinding ด้วย

### การเตือนนัดสัมภาษณ์ (ใช้โควต้า Push)

- เตือน 2 ครั้ง/นัด: **19:00 คืนก่อนวันนัด** และ **2 ชม. ก่อนเริ่ม** (ข้ามครั้งที่เลยเวลาไปแล้วตอนจองนัด)
- ผู้ใช้พิมพ์ `ปิดเตือน` / `เปิดเตือน` ได้ · ปิดทั้งระบบด้วย `REMINDERS=false`
- Push นับโควต้ารายเดือนของ LINE OA — คร่าวๆ 2 ข้อความต่อ 1 นัด

## Rich Menu

- Layout อยู่ใน `MENU_ITEMS` ใน `src/line/richmenu.ts` ทุกปุ่มส่ง postback `a=menu&m=<key>`
- ตอน start แอปจะ sync เมนูกับ LINE เอง (สร้าง → อัปโหลดรูป → ตั้งเป็นค่าเริ่มต้น → ลบเวอร์ชันเก่า)
- แก้เมนู: แก้ `MENU_ITEMS` → `npm run richmenu:image` → **เพิ่มเลขเวอร์ชันใน `RICH_MENU_NAME`** → deploy
- ปิดการ sync ด้วย `RICH_MENU_SYNC=false` (เช่น ตอนพัฒนาในเครื่องที่ไม่มี token จริง)

## การพัฒนาในเครื่อง

ต้องมี Node.js 22+ และ Docker

```bash
npm install
cp .env.example .env          # แล้วใส่ LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN
docker compose up -d          # Postgres สำหรับพัฒนา
npm run db:migrate:dev        # สร้างตาราง
npm run dev                   # http://localhost:3000
```

ทดสอบ webhook กับ LINE จริงจากเครื่อง: เปิด tunnel (เช่น `cloudflared tunnel --url http://localhost:3000`)
แล้วตั้ง Webhook URL ใน LINE Developers Console เป็น `https://<tunnel>/webhooks/line`

| คำสั่ง                               | ทำอะไร                                         |
| ------------------------------------ | ---------------------------------------------- |
| `npm test`                           | รัน unit tests                                 |
| `npm run typecheck` / `npm run lint` | ตรวจ type / lint                               |
| `npm run db:generate`                | สร้าง migration ใหม่หลังแก้ `src/db/schema.ts` |
| `npm run richmenu:image`             | สร้างรูป Rich Menu ใหม่จาก layout ในโค้ด       |
| `npm run build`                      | compile เป็น `dist/`                           |

## Deploy บน Railway

1. New Project → Deploy from GitHub repo → เลือก repo นี้ (service `api`)
2. Add → Database → PostgreSQL
3. ตั้ง Variables ของ service `api`:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`
   - `NODE_ENV` = `production`
4. Settings → Networking → Generate Domain
5. LINE Developers Console → Messaging API → Webhook URL = `https://<domain>/webhooks/line` → Verify → เปิด Use webhook

`railway.json` กำหนดให้รัน migration ก่อน deploy ทุกครั้ง และใช้ `/health` เป็น healthcheck

ค่าลับทั้งหมด (LINE channel secret/token, DATABASE_URL, API keys) เก็บใน environment variables เท่านั้น — ห้าม commit ลง repo

### สร้างตารางด้วยมือ

[`scripts/init-db.sql`](scripts/init-db.sql) = ทุก migration + แถว journal ของ drizzle รันใน query console
ของ DB **ว่าง** ได้เลย (สร้างใหม่ด้วย `npm run db:init-sql` หลัง `npm run db:generate`)

### Database has no tables (migrate ผ่านแต่ไม่มีตาราง)

Drizzle จำว่า migration ไหนรันแล้วไว้ใน `drizzle.__drizzle_migrations` ถ้าตารางใน `public` หายไป
แต่ journal ยังอยู่ `migrate` จะข้ามทุกไฟล์ ตอนนี้ `npm run db:migrate` จะ fail พร้อมข้อความ
`Migrations ran but required tables are missing` และ `/health` จะตอบ 503

วิธีแก้ (**ลบข้อมูลทั้งหมดใน DB** — ใช้เมื่อ `public` ว่างหรือไม่มีข้อมูลที่ต้องเก็บ):

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA public CASCADE;   -- enum types ค้างอยู่แม้ตารางหายแล้ว
CREATE SCHEMA public;
```

จากนั้น Redeploy — pre-deploy จะสร้างตารางใหม่ทั้งหมด
