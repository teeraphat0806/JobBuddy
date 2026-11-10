# JobBuddy

ผู้ช่วยหางานใน LINE — รวมงานจากหลายเว็บ, บันทึกงานที่สมัคร, ปฏิทินสัมภาษณ์ และโน้ต ไว้ที่เดียว
แค่เพิ่มเพื่อน LINE Official Account ก็ใช้ได้เลย

> สถานะ: 🚧 ใช้งานได้: เพิ่มเพื่อน → ยอมรับ PDPA → ตั้งค่างานที่อยากได้ (5 ขั้น) → Rich Menu / ลบข้อมูลของฉัน
> ถัดไป: ดึงงานจาก Greenhouse/Lever + ปุ่ม "งานใหม่วันนี้" + แชร์ให้เพื่อน

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
├── line/
│   ├── handlers.ts      # router: follow / consent / menu / wizard / ลบข้อมูล
│   ├── messages.ts      # ข้อความตอบกลับทั้งหมด
│   ├── richmenu.ts      # layout เมนู + sync กับ LINE ตอน start
│   ├── messenger.ts     # wrapper ของ LINE Messaging API
│   └── postback.ts, ui.ts
├── prefs/               # ตั้งค่างาน: wizard (state machine), parse, repository
├── conversation/        # สถานะการคุยหลายขั้น (หมดอายุ 30 นาที)
├── users/repository.ts  # ตาราง users (+ consent, ลบข้อมูล)
└── lib/logger.ts        # JSON logger
assets/richmenu-main.png # รูป Rich Menu (สร้างด้วย npm run richmenu:image)
scripts/                 # เครื่องมือสำหรับนักพัฒนา
drizzle/                 # SQL migrations (สร้างด้วย npm run db:generate)
tests/                   # vitest
```

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
