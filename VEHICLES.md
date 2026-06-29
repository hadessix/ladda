# ระบบประวัติรถ (Vehicles)

ประวัติรถของแต่ละสาย/ออฟฟิศ — รองรับหลายคันต่อสาย เก็บในตาราง `vehicles` แยก (1 แถว = 1 คัน)

## ⚠️ ติดตั้งครั้งแรก (รัน SQL ใน Supabase)

ก่อนใช้งานครั้งแรก ต้องสร้างตารางใน Supabase SQL editor (ดูไฟล์ [vehicles_migration.sql](vehicles_migration.sql)):

```sql
create table if not exists vehicles (
  id          text primary key,
  owner_type  text not null default 'route',  -- 'route' | 'office'
  owner_id    text,                           -- route_id / null สำหรับ office
  name        text,
  plate       text,
  chassis     text,
  insurance   text,
  ins_tel     text,
  ins_expiry  date,
  tax_expiry  date,
  prb_expiry  date,
  oil_date    date,
  sort_order  int default 0,
  created_at  timestamp default now()
);
grant all on table vehicles to anon, authenticated, service_role;
alter table vehicles disable row level security;
```

> Supabase SQL editor ไม่ auto-grant anon role → ต้อง `grant` + `disable RLS` เองทุกครั้งที่สร้าง table ใหม่
> แอปกัน error ไว้แล้ว (`.catch(()=>[])`) — ถ้ายังไม่สร้าง table แอปจะไม่พัง แต่หน้าประวัติรถจะว่าง

## โครงสร้างข้อมูล

| field | ความหมาย |
|---|---|
| `owner_type` | `route` = ผูกกับสาย / `office` = รถออฟฟิศไม่ผูกสาย |
| `owner_id` | route_id (ถ้าเป็น route) หรือ null (ถ้าเป็น office) |
| `name` | ชื่อ/ป้ายรถ (เช่น "รถ 1") |
| `plate` | ทะเบียน (auto uppercase) |
| `chassis` | เลขครัสซี (auto uppercase) |
| `insurance` | บริษัทประกัน |
| `ins_tel` | เบอร์ประกัน |
| `ins_expiry` | วันหมดอายุประกัน |
| `tax_expiry` | อายุภาษี |
| `prb_expiry` | อายุพรบ. |
| `oil_date` | วันถ่ายน้ำมันล่าสุด |

**รถในกลุ่มผูกกับสายย่อยเสมอ** — กลุ่ม (เช่น บูรชัย) เป็นแค่ header กำกับ ไม่กองรวมที่ระดับกลุ่ม เพื่อให้รู้ว่าคันไหนเป็นของสายไหน

## วิธีใช้งาน

### ดู/แก้รถทั้งหมด
ปุ่ม **🚐 ประวัติรถ** ที่ header tab พนักงาน → modal รถทุกสาย
- กลุ่มแสดงเป็น header 📁 แล้วแตกเป็นรายสายย่อย → สายเดี่ยว → ออฟฟิศ
- กล่องสายอยู่ซ้าย (แบบหน้าพนักงาน) มี จุดสี + ชื่อสาย + จำนวนคัน + ปุ่ม "+ เพิ่มรถ"
- รถเรียงทางขวาเป็นแถวเดียว/คัน (compact)

### ดู/แก้รถของสายเดียว
- ปุ่ม 🚐 ที่กล่องสายย่อย (tab พนักงาน) หรือปุ่ม ✏️ จัดการ (หน้าสายในแอปหลัก)
- เปิด modal เฉพาะรถของสายนั้น ใช้การ์ดเต็ม (label + ช่อง 2 คอลัมน์)

### ปุ่มอื่น
- 🛢️ ข้างช่องถ่ายน้ำมัน → เซ็ตวันถ่ายน้ำมันเป็นวันนี้
- 🗑 → ลบรถคันนั้น (มี confirm)
- 📥 **นำเข้าข้อมูลรถเดิม** (admin เท่านั้น) → copy ข้อมูลจาก `routes.vehicle` เดิม (1 สาย=1คัน) เข้าตารางใหม่; กดซ้ำได้ ข้ามสายที่นำเข้าแล้ว

## สิทธิ์
- **admin** + **HR** เข้าได้ทั้งดูและแก้ (อยู่ใน tab พนักงานของ payroll)
- บันทึกทุก field เป็น onchange (auto-save) ผ่าน Worker → Supabase

## ฟังก์ชันหลัก (index.html)

| ฟังก์ชัน | หน้าที่ |
|---|---|
| `openAllVehicles()` | modal รถทั้งหมด (compact) — set `_vehCtx=null` |
| `openRouteVehicles(routeId)` | modal รถเฉพาะสาย (การ์ดเต็ม) — set `_vehCtx=routeId` |
| `_vehSection(o)` | 1 section ต่อเจ้าของ (กล่องสายซ้าย + รถ compact ขวา) |
| `_vehCard(v)` / `_vehCardFull(v)` | การ์ด compact 1 แถว / การ์ดเต็ม 2 คอลัมน์ |
| `_vehFor(type,id)` | คืน vehicles ของเจ้าของนั้น |
| `_vehField(id,field,val)` | auto-save 1 field → upsert แถวเต็ม; uppercase plate/chassis |
| `_vehAdd(ownerType,ownerId)` | เพิ่มรถ → `_vehRerender()` |
| `_vehDel(id)` | ลบรถ (confirm) → `_vehRerender()` |
| `_vehOilToday(id)` | เซ็ต oil_date = วันนี้ |
| `_vehRerender()` | re-render modal ที่เปิดอยู่ (ดูจาก `_vehCtx`) |
| `_migrateVehicles()` | admin: นำเข้าจาก `routes.vehicle` เดิม (idempotent) |

โหลดเข้า `S.vehicles[]` ทั้งใน `loadAll()` และ `loadPayroll()` (admin + hr)

## หมายเหตุ
- `routes.vehicle` jsonb เดิมยังอยู่ในตาราง routes สำหรับ migrate — ไม่ได้ลบ
- เคสที่ทำให้ต้องแยก table: **บูรชัย (กลุ่ม) มีรถ 4 คัน** + **ออฟฟิศมีรถ 3 คัน** ซึ่งแบบ 1 สาย=1 คัน เดิมรองรับไม่ได้
