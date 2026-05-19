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
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true}',
  sort_order  int DEFAULT 0,
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

-- 4. groups (กลุ่มสาย)
groups (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  sort_order  int DEFAULT 0,
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true}'
)

-- 5. group_members (สมาชิกกลุ่ม)
group_members (
  group_id    text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  route_id    text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  sort_order  int DEFAULT 0,
  PRIMARY KEY (group_id, route_id)
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

## ระบบ Login (PIN-based Auth)

| รายการ | รายละเอียด |
|---|---|
| เก็บสถานะ | `localStorage` key: `ladda_role` |
| Login ครั้งเดียว | เปิด browser ใหม่ไม่ต้อง login ซ้ำ |
| ออกจากระบบ | กด badge role ที่ header แล้วยืนยัน |

### PIN Codes

| Role | PIN | สิทธิ์ |
|---|---|---|
| 👤 ผู้ใช้งานทั่วไป | `1111` | ดู + เพิ่มรายการ (**ลบไม่ได้**) |
| 👑 ผู้ดูแล | `0000` | ทุกอย่าง รวมถึงลบรายการ + จัดการสาย |

### สิทธิ์แต่ละ Role

| ฟีเจอร์ | ผู้ใช้ทั่วไป | ผู้ดูแล |
|---|---|---|
| นับเงิน / รายรับ / รายจ่าย / แลกเงิน | ✅ | ✅ |
| ลบรายการ | ❌ | ✅ |
| เพิ่มสาย | ❌ | ✅ |
| แก้ไขสาย (ชื่อ + สี) | ❌ | ✅ |
| ลบสาย | ❌ | ✅ |

### Auth Flow

```
เปิดแอป
  └─ มี ladda_role ใน localStorage?
        ├─ ใช่ → showApp() → loadAll() → render()
        └─ ไม่ → แสดงหน้า PIN pad
                   └─ กด PIN 4 หลัก → ตรวจสอบ
                         ├─ ถูก → บันทึก role + showApp()
                         └─ ผิด → แสดง error, ล้าง PIN
```

---

## ฟีเจอร์หลัก

### 1. Multi-Route (หลายสาย)
- แต่ละ "สาย" จัดการข้อมูลแยกกัน
- เพิ่มสายใหม่ได้ พร้อมเลือกสีประจำสาย (admin only)
- แก้ไข / ลบสายได้ (admin only) — ปุ่ม ✏️ 🗑 ใน sidebar
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
ALTER TABLE public.groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members DISABLE ROW LEVEL SECURITY;

-- ให้ anon role เข้าถึงได้
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_members TO anon;
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
  shops:   [{ id, name, color, tab_flags, sort_order }],
  groups:  [{ id, name, sort_order, tab_flags }],
  groupMembers: { [groupId]: [routeId, ...] },
  entries: { [routeId]: { [monthKey]: [ entry, ... ] } },
  sessions:{ [routeId]: { [monthKey]: { subs: [{ df, dt, bills }] } | null } },
  view:  { type: 'shop'|'group', id: string },
  shop:  "s1",   // shortcut = view.id เมื่อ type==='shop'
  month: "2025-05",
  year:  "2025"
}

AUTH = { role: 'user' | 'admin' }   // สถานะ login (in-memory)
// role ถูกเก็บใน localStorage key: 'ladda_role'
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
| `authInit()` | ตรวจ localStorage → showApp() หรือแสดงหน้า login |
| `pinPress(d)` | กด digit บน numpad — ครบ 4 ตัวตรวจสอบอัตโนมัติ |
| `pinCheck()` | เทียบ PIN → set role + showApp() หรือ error |
| `showApp()` | ซ่อนหน้า login, อัปเดต badge, เรียก loadAll() |
| `logout()` | ลบ localStorage, แสดงหน้า login ใหม่ |
| `isAdmin()` | คืน true ถ้า role === 'admin' |
| `loadAll()` | โหลด routes/entries/sessions/groups/group_members จาก Supabase |
| `render()` | re-render ทุก component |
| `renderSidebar()` | sidebar: กลุ่ม (บนสุด) + สายไม่มีกลุ่ม (ล่าง) |
| `renderContent()` | router → renderShopContent() หรือ renderGroupContent() |
| `renderShopContent()` | หน้าสาย (เดิม) — กรอง tab ตาม tab_flags |
| `renderGroupContent()` | หน้าสรุปกลุ่ม — ยอดรวม + card แต่ละสาย |
| `setView(type,id)` | เปลี่ยน view ปัจจุบัน (shop/group) แล้ว render() |
| `curTabFlags()` | คืน tab_flags ของ view ปัจจุบัน |
| `groupTot(gid)` | ยอดรวมของกลุ่ม |
| `groupedRouteIds()` | Set ของ routeId ที่อยู่ในกลุ่มใดก็ได้ |
| `addGroup()` | เปิด modal เพิ่มกลุ่ม (admin only) |
| `saveGroup()` | บันทึกกลุ่มใหม่ + members ลง Supabase |
| `editGroup(id)` | เปิด modal แก้ไขกลุ่ม |
| `saveEditGroup(id)` | บันทึกการแก้ไขกลุ่ม + sync members |
| `deleteGroup(id)` | ลบกลุ่ม (สายไม่ถูกลบ) |
| `openCountGroup()` | ปุ่มนับเงินจากหน้ากลุ่ม → popup เลือกสาย |
| `openIncomeGroup()` | ปุ่มรายรับจากหน้ากลุ่ม → popup เลือกสาย |
| `openExpenseGroup()` | ปุ่มรายจ่ายจากหน้ากลุ่ม → popup เลือกสาย |
| `pickShopThen(...)` | modal เลือกสายก่อนเปิด action |
| `tfChips(flags,prefix)` | render toggle chip สำหรับ tab_flags |
| `getTf(prefix)` | อ่านค่า tab_flags จาก chip ใน DOM |
| `toggleGrpCard(id)` | ขยาย/ยุบ card สายในหน้าสรุปกลุ่ม |
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
| `openExchange()` | เปิด modal แลกเงินระหว่างสาย |
| `refreshExchangeCB()` | อัปเดต cap + label "มี X ใบ" เมื่อเปลี่ยนสาย |
| `billInpWithLimit(p,cb)` | render grid input แบงค์พร้อม cap |
| `billInpExchange(p,cb)` | render input แบงค์สำหรับ modal แลกเงิน |
| `updBLimit(p)` | อัปเดตยอด real-time สำหรับ input ที่มี cap |
| `billInp(p)` | render grid input แบงค์ไม่มี cap |
| `updB(p)` | อัปเดตยอด real-time สำหรับ input ไม่มี cap |
| `addShop()` | เปิด modal เพิ่มสาย (admin only) |
| `saveShop()` | บันทึกสายใหม่ลง Supabase (รวม tab_flags) |
| `editShop(id)` | เปิด modal แก้ไขชื่อ + สี + tab_flags (admin only) |
| `saveEditShop(id)` | บันทึกการแก้ไขสาย |
| `deleteShop(id)` | ลบสายและข้อมูลทั้งหมด + sync groupMembers |
| `OM/CM` | เปิด/ปิด modal |
| `toast(msg)` | แสดง notification ชั่วคราว |

---

## Bug fixes ที่แก้ไปแล้ว

| วันที่ | รายการ |
|---|---|
| 2025-05 | `updBLimit` ไม่ทำงาน — สาเหตุ: `JSON.stringify` ใน oninput attribute ทำให้ double quotes ชนกัน → SyntaxError แก้โดยเพิ่ม `_cbMap` global เก็บ cb แยกตาม prefix แทน |
| 2025-05 | ย้ายแถบ "ยอดที่จ่ายออก" / "ยอดให้" ไปใต้ grid แบงค์ทั้งใน รายจ่าย และ แลกเงิน (ทั้งซ้าย-ขวา) |
| 2026-05 | ปรับ modal แลกเงินระหว่างสาย: เอา cbBar ออก, เปลี่ยนเป็น layout grid แถวตรงกัน (display:contents), denomination เรียง 1 บรรทัด/แถว, font input 20px, เอาช่องวันที่/หมายเหตุออก ใช้ `today()` อัตโนมัติ |
| 2026-05 | เพิ่มระบบ PIN login: ผู้ใช้ทั่วไป (1111) / ผู้ดูแล (0000) — จำ session ใน localStorage, ผู้ใช้ทั่วไปลบรายการไม่ได้, ผู้ดูแลจัดการสายได้ (เพิ่ม/แก้ไข/ลบ) |
| 2026-05 | เพิ่มระบบ Group: admin สร้างกลุ่มสายได้, sidebar แสดงกลุ่มบนสุด + สายไม่มีกลุ่มด้านล่าง, หน้าสรุปกลุ่มแสดงยอดรวม + card แต่ละสาย, toggle tab_flags ต่อกลุ่ม/สาย |

---

## 🗺️ Roadmap — แผนต่อไป

### Phase 2 — Auth & Multi-user
- [x] ระบบ PIN login เบื้องต้น (2 role: user / admin)
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
