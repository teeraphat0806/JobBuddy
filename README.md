# JobBuddy

ผู้ช่วยหางานใน LINE — รวมงานจากหลายเว็บ, บันทึกงานที่สมัคร, ปฏิทินสัมภาษณ์ และโน้ต ไว้ที่เดียว
แค่เพิ่มเพื่อน LINE Official Account ก็ใช้ได้เลย

> สถานะ: 🚧 ใช้งานได้: PDPA → ตั้งค่างาน → 🔍 งานใหม่วันนี้ (~610 งานในไทยจาก 33 บริษัท) →
> ⭐ เก็บไว้ / ✅ สมัครแล้ว / ❌ ไม่สนใจ / 📤 แชร์ให้เพื่อน → ดูรายการที่เก็บ/สมัครไว้ →
> 📥 ส่งลิงก์งานจากเว็บไหนก็ได้ → 🔄 สถานะการสมัคร (นับวันที่รอในแต่ละขั้น) → 📝 โน้ตต่องาน →
> 🏠 ตั้งบ้าน/คอนโด → 📏 ระยะทางไปที่ทำงาน →
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
│   ├── stages.ts        # ขั้นของการสมัคร + นับวันที่อยู่ในขั้นนั้น ("รอติดต่อกลับ · 5 วัน")
│   ├── places.ts        # ตั้งบ้าน/คอนโดจากการแชร์ตำแหน่งใน LINE (สูงสุด 5 ที่)
│   ├── messages.ts      # ข้อความตอบกลับทั้งหมด
│   ├── richmenu.ts      # layout เมนู + sync กับ LINE ตอน start
│   ├── messenger.ts     # wrapper ของ LINE Messaging API
│   └── postback.ts, ui.ts
├── interviews/
│   ├── time.ts          # เวลาตาม APP_TIMEZONE, อ่านเวลาที่พิมพ์ภาษาไทย, กติกาการเตือน
│   ├── reminders.ts     # รอบส่งเตือน (ทุก 5 นาที) — จองสิทธิ์ใน DB ก่อน push จึงไม่ส่งซ้ำ
│   └── repository.ts
├── links/
│   ├── preview.ts       # อ่านชื่องานจากลิงก์: ATS API, กฎเฉพาะเว็บ, JSON-LD หรือ <title>/og:
│   ├── saveLink.ts      # บันทึกลิงก์ 1 ลิงก์ (ใช้ทั้งในแชทและในคิว)
│   ├── importWorker.ts  # คิวลิงก์จำนวนมาก: ทยอยบันทึกทีละหน้าต่อเว็บ แล้ว push สรุป
│   ├── refreshTitles.ts # อ่านลิงก์เก่าที่ชื่อยังไม่แยกตำแหน่ง/บริษัทใหม่ (ตอนเริ่มเซิร์ฟเวอร์)
│   └── safeFetch.ts     # ดึงหน้าเว็บแบบกัน SSRF (ห้าม IP ภายใน/พอร์ตแปลก)
├── geo/                 # ระยะทาง: geocode ที่ตั้งงานด้วย OpenStreetMap (แคชใน DB) + ระยะเส้นตรง
├── places/repository.ts # ที่พักของผู้ใช้
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
- ATS ที่รองรับ: Greenhouse, Lever, SmartRecruiters, Workable (Workable มี rate limit ของ Cloudflare —
  อย่ายิงถี่, รอบละ 1 ครั้งต่อบริษัทพอ)

#### แหล่งที่ตรวจแล้วว่า **ไม่ดึง** (พ.ย. 2026)

| เว็บ             | เหตุผล                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------- |
| JobsDB           | ข้อตกลงห้ามรวบรวม/คัดลอกข้อมูล, robots.txt ปิดเกือบทั้งเว็บ                             |
| JobThai          | ข้อตกลงห้ามทำซ้ำ/คัดลอก/ดัดแปลงเนื้อหา                                                  |
| JobBKK           | ข้อตกลงห้ามคัดลอก/ผลิตซ้ำ                                                               |
| JobTopGun        | ข้อตกลง ข้อ 3.3 ห้าม Screen Scraping / Robots / Data Gathering                          |
| LinkedIn, Indeed | ข้อตกลงห้าม scraping                                                                    |
| Jooble API       | อนุญาต แต่ฟรีแค่ 500 requests ต่อคีย์ตลอดอายุ — ไม่พอสำหรับ sync                        |
| Careerjet API    | อนุญาต แต่ต้องส่ง IP/User-Agent ของผู้ใช้ปลายทาง (LINE ไม่ให้) — ต้องถาม Careerjet ก่อน |

งานจากเว็บพวกนี้ให้ผู้ใช้ **ส่งลิงก์มาเอง** (อ่านแค่ title แบบ link preview) หรือรอฟีเจอร์ส่งต่ออีเมลแจ้งเตือนงาน

### งานจากลิงก์ที่ผู้ใช้ส่งมา

- ลิงก์ Greenhouse / Lever / SmartRecruiters / Workable → อ่านผ่าน API สาธารณะ (ถ้าเป็นงานที่ sync อยู่แล้วจะใช้แถวเดิม)
- เว็บอื่น → ดึงหน้าเว็บ **ครั้งเดียว** ตอนผู้ใช้ส่งลิงก์ อ่านแค่ meta ของหน้านั้น (เหมือน link preview):
  - JobThai: `description` ("งาน {บริษัท} ตำแหน่งงาน {ตำแหน่ง}") หรือ `<title>` ทั้ง 2 แบบ
  - JobsDB: `data-automation="job-detail-title"` / `advertiser-name` (หรือ `og:title` "… Job in {ที่ตั้ง} - Jobsdb")
  - JobBKK และเว็บทั่วไป: JSON-LD `JobPosting` (title, hiringOrganization, jobLocation)
  - ที่เหลือ: `<title>` / `og:title` / `og:site_name` · หน้าแรก/สโลแกนของเว็บหางานไม่นับเป็นชื่องาน
    ถ้าอ่านไม่ได้ (ต้องล็อกอิน, กันบอท) บอทจะถามชื่อตำแหน่งจากผู้ใช้แทน
- ตอนเริ่มเซิร์ฟเวอร์ จะอ่านลิงก์ที่เคยบันทึกด้วยชื่อทั้งหน้า (เช่น "JobThai - งาน หางาน สมัครงาน…") ใหม่อีกครั้ง
  (`src/links/refreshTitles.ts`, ครั้งละไม่เกิน 50 ลิงก์ เว้น 1.5 วินาที) — อ่านไม่ได้ก็ตั้งเป็น "งานจาก {เว็บ}" ให้แก้ชื่อเองได้
- **ส่งทีละหลายลิงก์**: ไม่เกิน 10 ลิงก์บันทึกทันทีพร้อมการ์ด · มากกว่านั้นเข้าคิว (`link_imports`)
  - ตอบทันทีว่าได้รับกี่ลิงก์ + เวลาโดยประมาณ แล้ว worker เบื้องหลังทยอยบันทึก
  - อ่าน **ทีละหน้าต่อเว็บ เว้น 1 วินาที** (ไม่รัวเว็บต้นทาง) ทำพร้อมกันได้ 4 เว็บ · ผู้ใช้หลายคนผลัดกันในคิว
  - เสร็จหมดแล้ว Push สรุป **1 ข้อความต่อผู้ใช้** (รวมทุกข้อความที่ส่งมาระหว่างนั้น) — ใช้โควต้า Push
  - คิวได้สูงสุด 2,000 ลิงก์ต่อคน · ข้อความ LINE ยาวได้ 5,000 ตัวอักษร (~50–150 ลิงก์) จึงต้องส่งหลายข้อความ
  - รีสตาร์ทกลางคันไม่หาย: งานที่ค้าง > 10 นาทีถูกหยิบใหม่ · ลบข้อมูลผู้ใช้ลบคิวด้วย
- ลิงก์ซ้ำ: งานที่อยู่ใน ⭐/📋 แล้ว หรือส่งลิงก์เดียวกันซ้ำในข้อความเดียว → แจ้งว่าซ้ำและไม่บันทึกซ้ำ ที่เหลือบันทึกตามปกติ
- เก็บเป็น `provider = 'link'` — ไม่โผล่ในฟีดของคนอื่น
- `safeFetch` ปฏิเสธ IP ภายใน (127/8, 10/8, 169.254/16, …), `localhost`, `*.internal` และพอร์ตที่ไม่ใช่ 80/443
  ตรวจตอน DNS lookup ของ socket จริง จึงกัน DNS rebinding ด้วย

### การเตือนนัดสัมภาษณ์ (ใช้โควต้า Push)

- เตือน 2 ครั้ง/นัด: **19:00 คืนก่อนวันนัด** และ **2 ชม. ก่อนเริ่ม** (ข้ามครั้งที่เลยเวลาไปแล้วตอนจองนัด)
- ผู้ใช้พิมพ์ `ปิดเตือน` / `เปิดเตือน` ได้ · ปิดทั้งระบบด้วย `REMINDERS=false`
- Push นับโควต้ารายเดือนของ LINE OA — คร่าวๆ 2 ข้อความต่อ 1 นัด

### สถานะการสมัครและการนับวัน

```
✅ สมัครแล้ว (⏳ รอติดต่อกลับ · N วัน)
   → 📞 ติดต่อกลับแล้ว → สัมภาษณ์แล้วหรือยัง?
        → 📅 ยัง: นัดสัมภาษณ์ (เลือกวันเวลา + เตือน)
        → ✅ สัมภาษณ์แล้ว: ⏳ รอผล · เริ่มนับวันใหม่
             → 🎉 ได้งาน / 🙏 ไม่ผ่าน
```

- `user_jobs.stage_changed_at` เก็บเวลาที่เข้าขั้นปัจจุบัน — นับวันตามปฏิทินใน `APP_TIMEZONE`
- เปลี่ยนขั้นแล้วนับใหม่ · กดขั้นเดิมซ้ำหรือกด ✅ สมัครแล้ว ซ้ำ ไม่รีเซ็ต
- ปุ่มขั้นถัดไปขึ้นที่รายละเอียดงานและเมนู 🔄 อัปเดตสถานะ (แก้เป็นขั้นอื่นได้เสมอ)

### ระยะทางจากบ้าน (ฟรี ไม่ต้องใช้ API key)

- ผู้ใช้พิมพ์ `บ้าน` แล้วกด 📍 ส่งตำแหน่ง (แชร์ตำแหน่งของ LINE) — ตั้งได้ 5 ที่ ตั้งชื่อได้ (บ้าน, คอนโด, …)
- ที่ตั้งงาน (ข้อความเช่น "Huai Khwang, Bangkok") แปลงเป็นพิกัดด้วย **OpenStreetMap Nominatim**
  - ส่งไปแค่ข้อความที่ตั้งงาน (ข้อมูลสาธารณะ) — **ไม่ส่งพิกัดบ้านของผู้ใช้ออกไปที่ไหน**
  - ทำตาม [usage policy](https://operations.osmfoundation.org/policies/nominatim/): ไม่เกิน 1 request/วินาที, ระบุ User-Agent, แคชทุกผลในตาราง `geocodes` (ไม่เจอ → ลองใหม่หลัง 30 วัน), แสดง © OpenStreetMap contributors
  - รายการ/การ์ดใช้แค่ค่าที่แคชไว้ (ตอบเร็ว) ที่ยังไม่รู้จะค้นเบื้องหลัง · หน้ารายละเอียดงานค้นทันที 1 ครั้ง
  - ผลที่หยาบระดับจังหวัด (เช่น "Bangkok") ไม่แสดงระยะ เพราะไม่มีความหมาย — ต้องระดับเขต/อำเภอขึ้นไป
- ระยะเป็น **เส้นตรงโดยประมาณ** (`~4.6 กม.`) · ปุ่ม 🗺️ เส้นทาง เปิด Google Maps ไปที่ทำงาน (ไม่ใส่ตำแหน่งบ้านในลิงก์ ใช้ตำแหน่งปัจจุบันของโทรศัพท์แทน)
- ไม่แสดงสำหรับงาน remote หรืองานที่ไม่ระบุที่ตั้ง (เช่นลิงก์ JobThai ส่วนใหญ่)
- ปิดด้วย `GEOCODING=false` · ใช้ Nominatim ของตัวเองด้วย `GEOCODER_URL`

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
