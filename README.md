# 💰 น้องลัดดา — Cash Counter

แอปนับเงินและบันทึกรายรับ-รายจ่ายแบบ multi-route สำหรับธุรกิจที่มีหลายสาย
ทำงานเป็น single HTML file ไม่ต้องติดตั้ง เปิดผ่าน browser ได้เลย

---

## ที่เก็บไฟล์

```
C:\นับเงินอี้อ๋า\
├── index.html      ← ไฟล์หลัก
└── README.md          ← ไฟล์นี้
```

---

## ภาพรวม

| รายการ | รายละเอียด |
|---|---|
| ไฟล์ | `index.html` |
| เทคโนโลยี | Vanilla HTML + CSS + JavaScript (ไม่มี dependency) |
| การเก็บข้อมูล | **Supabase** (cloud) — ข้อมูลถาวร ไม่หายเมื่อปิด browser |
| Hosting | **Cloudflare Pages** |
| รองรับ | Desktop + Mobile (responsive) |

---

## URL & Credentials

| รายการ | ค่า |
|---|---|
| **URL แอป** | https://e34ef8d2.ladda-b0j.pages.dev/ |
| **GitHub repo** | https://github.com/hadessix/ladda |
| **Supabase URL** | https://lsxnbdhyfsuqhopzuwls.supabase.co |
| **Supabase anon key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzeG5iZGh5ZnN1cWhvcHp1d2xzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxOTEyMjQsImV4cCI6MjA5NDc2NzIyNH0.yQUghPf7xNmPclMYNg1fX2c2ST9CTYsXl3-VjLRM2tA` |

---

## Supabase Schema

```sql
-- 1. routes (สาย)
routes (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#22c55e',
  created_at  timestamp DEFAULT now()
)

-- 2. entries (รายการ)
entries (
  id              text PRIMARY KEY,
  route_id        text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  month_key       text NOT NULL,       -- "YYYY-MM"
  type            text NOT NULL,       -- count | income | expense | exin | exout
  title           text,
  note            text,
  date_from       date,
  date_to         date,
  amount          numeric DEFAULT 0,
  total           numeric DEFAULT 0,
  bills           jsonb,               -- { 1000:n, 500:n, ... }
  subs            jsonb,               -- สำหรับ count type
  other_route_id  text,               -- สำหรับ exin/exout
  created_at      timestamp DEFAULT now()
)

-- 3. sessions (รอบนับเงินที่ยังไม่สรุป)
sessions (
  id          text PRIMARY KEY,
  route_id    text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  month_key   text NOT NULL,
  subs        jsonb,
  created_at  timestamp DEFAULT now(),
  UNIQUE(route_id, month_key)
)
```

### Entry types

| type | ความหมาย | ผลต่อยอด |
|---|---|---|
| `count` | รอบนับเงิน (มี subs[]) | +total |
| `income` | รายรับพิเศษ | +amount |
| `expense` | รายจ่าย | -amount |
| `exin` | รับแลกเงินจากสายอื่น | +amount |
| `exout` | แลกเงินออกไปสายอื่น | -amount |

### bills object

```js
{ 1000: n, 500: n, 100: n, 50: n, 20: n, coin: n }
// coin = จำนวนเหรียญ (คิดเหรียญละ ฿1)
```

---

## ฟีเจอร์หลัก

### 1. Multi-Route (หลายสาย)
- แต่ละ "สาย" จัดการข้อมูลแยกกัน
- เพิ่มสายใหม่ได้ พร้อมเลือกสีประจำสาย
- ดู grand total รวมทุกสายที่ header

### 2. ระบบงวดรายเดือน
- รอบบัญชีเริ่มวันที่ 11 ของเดือน ถึง 10 ของเดือนถัดไป
- tab แสดงแยกตามปี (พ.ศ.) และเดือนที่มีข้อมูล + เดือนปัจจุบันเสมอ

### 3. การนับเงิน (Count Session)
- เปิด session ก่อน แล้วเพิ่มได้หลายครั้ง (ครั้งที่ 1, 2, 3…)
- แต่ละครั้งระบุ: วันที่เริ่ม, วันที่สิ้นสุด, จำนวนแบงค์แต่ละชนิด
- ยอดอัปเดต real-time ขณะกรอกแบงค์
- กด **สรุปรอบ** → บันทึกเป็น entry ถาวรลง Supabase

### 4. รายรับ
- ระบุแบงค์ที่รับ (บังคับ) — ยอดคำนวณอัตโนมัติ real-time
- บันทึกเป็น `income` entry

### 5. รายจ่าย
- ระบุแบงค์ที่จ่ายออก (บังคับ อย่างน้อย 1 ใบ)
- ยอดคำนวณอัตโนมัติ real-time — แสดงใต้ grid แบงค์
- จำกัดไม่เกินแบงค์ที่มีในกล่อง (cap per denomination)
- บันทึกเป็น `expense` entry

### 6. แลกเงินระหว่างสาย
- UI 2 คอลัมน์ — ซ้าย/ขวาตรงกันทุก denomination ด้วย CSS grid แถวเดียวกัน
- แต่ละ denomination เรียงลงมา 1 บรรทัด/1 แถว (1000 → 500 → 100 → 50 → 20 → เหรียญ)
- แสดง "มี X ใบ" ในแต่ละช่อง — cap อัตโนมัติ ใส่เกินไม่ได้
- ไม่มีช่องวันที่/หมายเหตุ — วันที่บันทึกตามวันจริง real-time
- บันทึก exout/exin ทั้ง 2 ฝั่งพร้อมกันใน transaction เดียว

---

## Supabase — การตั้งค่าที่ทำไปแล้ว

```sql
-- ปิด RLS (ยังไม่ใช้ Auth)
ALTER TABLE public.routes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY;

-- ให้ anon role เข้าถึงได้
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO anon;
```

---

## วิธี Deploy / Update

เมื่อแก้ไข `index.html` แล้วต้องการ deploy ขึ้น Cloudflare:

```bash
cd "C:/นับเงินอี้อ๋า"
wrangler pages deploy . --project-name=ladda --commit-dirty=true
```

หรือถ้าต้องการ push ขึ้น GitHub ด้วย:

```bash
git add index.html
git commit -m "update"
git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true
```

---

## โครงสร้างข้อมูลใน JS (State)

```js
S = {
  shops:   [{ id, name, color }],
  entries: { [routeId]: { [monthKey]: [ entry, ... ] } },
  sessions:{ [routeId]: { [monthKey]: { subs: [{ df, dt, bills }] } | null } },
  shop:  "s1",
  month: "2025-05",
  year:  "2025"
}
```

### Field mapping JS ↔ Supabase

| JS | Supabase |
|---|---|
| `df` | `date_from` |
| `dt` | `date_to` |
| `oid` | `other_route_id` |

---

## ฟังก์ชันสำคัญ

| ฟังก์ชัน | หน้าที่ |
|---|---|
| `loadAll()` | โหลด routes/entries/sessions จาก Supabase ตอน init |
| `render()` | re-render ทุก component |
| `cpk()` | คืน month key ของงวดปัจจุบัน (เริ่มวันที่ 11) |
| `bv(bills)` | คำนวณยอดเงินรวมจาก bills object |
| `shopTot(sid)` | ยอดสุทธิของสาย (รวม open session) |
| `grandTot()` | ยอดรวมทุกสาย |
| `calcCB(sid,mk)` | คำนวณแบงค์คงเหลือในกล่อง ณ เดือนนั้น |
| `ge(sid,mk)` | ดึง / สร้าง entries array |
| `gs/ss/cs` | get / set / clear open session |
| `sbGet/sbUpsert/sbDelete` | Supabase REST helpers |
| `entryToRow/rowToEntry` | map JS ↔ Supabase fields |
| `summarize()` | สรุปรอบนับเงิน → upsert entry + delete session |
| `openExchange()` | เปิด modal แลกเงินระหว่างสาย (layout grid แถวตรงกัน) |
| `refreshExchangeCB()` | อัปเดต cap + label "มี X ใบ" เมื่อเปลี่ยนสาย |
| `billInpWithLimit(p,cb)` | render grid input แบงค์พร้อม cap — เก็บ cb ใน `_cbMap[p]` |
| `billInpExchange(p,cb)` | render input แบงค์สำหรับ modal แลกเงิน (1 คอลัมน์, font 20px) |
| `updBLimit(p)` | อัปเดตยอด real-time สำหรับ input ที่มี cap (อ่าน cb จาก `_cbMap`) |
| `billInp(p)` | render grid input แบงค์ไม่มี cap (สำหรับ count/income) |
| `updB(p)` | อัปเดตยอด real-time สำหรับ input ไม่มี cap |
| `OM/CM` | เปิด/ปิด modal |
| `toast(msg)` | แสดง notification ชั่วคราว |

---

## Bug fixes ที่แก้ไปแล้ว

| วันที่ | รายการ |
|---|---|
| 2025-05 | `updBLimit` ไม่ทำงาน — สาเหตุ: `JSON.stringify` ใน oninput attribute ทำให้ double quotes ชนกัน → SyntaxError แก้โดยเพิ่ม `_cbMap` global เก็บ cb แยกตาม prefix แทน |
| 2025-05 | ย้ายแถบ "ยอดที่จ่ายออก" / "ยอดให้" ไปใต้ grid แบงค์ทั้งใน รายจ่าย และ แลกเงิน (ทั้งซ้าย-ขวา) |
| 2026-05 | ปรับ modal แลกเงินระหว่างสาย: เอา cbBar ออก, เปลี่ยนเป็น layout grid แถวตรงกัน (display:contents), denomination เรียง 1 บรรทัด/แถว, font input 20px, เอาช่องวันที่/หมายเหตุออก ใช้ `today()` อัตโนมัติ |

---

## 🗺️ Roadmap — แผนต่อไป

### Phase 2 — Auth & Multi-user
- [ ] เปิด Supabase Auth — น้องลัดดามี account ของตัวเอง
- [ ] เปิด RLS + policy ตาม user
- [ ] ไม่ต้องใช้ anon key แบบเปิดอยู่

### Phase 3 — PWA
- [ ] เพิ่ม manifest + service worker
- [ ] รองรับ iOS / Android ผ่าน Add to Home Screen

### Phase 4 — Cross-system Integration
- [ ] ดึงข้อมูลข้ามระหว่างระบบน้องลัดดา ↔ ระบบน้ำแข็ง
- [ ] รายงานรวมทั้งสองธุรกิจ

### Phase 5 — Features เพิ่มเติม
- [ ] Export รายงาน (PDF / Excel)
- [ ] ประวัติย้อนหลังไม่จำกัด
