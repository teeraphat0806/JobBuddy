# JobBuddy

ผู้ช่วยหางานใน LINE — รวมงานจากหลายเว็บ, บันทึกงานที่สมัคร, ปฏิทินสัมภาษณ์ และโน้ต ไว้ที่เดียว
แค่เพิ่มเพื่อน LINE Official Account ก็ใช้ได้เลย

> สถานะ: 🚧 เริ่มต้นโปรเจกต์

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
├── line/                # LINE messenger wrapper, event handlers, ข้อความตอบกลับ
├── users/repository.ts  # เข้าถึงตาราง users
└── lib/logger.ts        # JSON logger
drizzle/                 # SQL migrations (สร้างด้วย npm run db:generate)
tests/                   # vitest
```

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
