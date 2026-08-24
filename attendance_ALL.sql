-- ═══════════════════════════════════════════════════════════
-- 📦 รวมทุก migration ของระบบเช็คเวลาเข้างาน — รันไฟล์นี้ไฟล์เดียว
-- รันซ้ำได้ไม่พัง · ไม่ต้องจำว่าเคยรันอันไหนไปแล้ว
-- ═══════════════════════════════════════════════════════════


-- ────────── attendance_migration.sql ──────────
-- ═══════════════════════════════════════════════════════════
-- ระบบเช็คเวลาเข้างาน NFC — น้องลัดดา
-- รันทั้งไฟล์นี้ใน Supabase SQL editor ครั้งเดียว (รันซ้ำได้ ไม่พัง)
-- ═══════════════════════════════════════════════════════════

-- ── 1) จุดแตะ = สติ๊กเกอร์ NFC 1 ใบ ──
--    kind='vehicle' → แปะบนรถ (เคลื่อนที่ ไม่ใช้ geofence, เช็คด้วยการเทียบพิกัดกับเพื่อนร่วมรถ)
--    kind='place'   → จุดคงที่ เช่น ลานจอดบูรชัย (ใช้ lat/lng + radius_m)
create table if not exists att_points (
  id         text primary key,
  name       text not null,
  kind       text not null default 'vehicle',   -- vehicle | place
  vehicle_id text,                              -- ผูกกับรถคันไหน (kind=vehicle)
  route_id   text,                              -- ผูกกับสายไหน
  lat        numeric,
  lng        numeric,
  radius_m   int default 200,                   -- ใช้เฉพาะ kind=place
  status     text not null default 'active',
  created_at timestamptz default now()
);

-- ── 2) เครื่องที่ผูกกับพนักงาน (1 คน = 1 เครื่อง active) ──
create table if not exists att_devices (
  id          text primary key,
  employee_id text not null references employees(id) on delete cascade,
  label       text,                             -- "Samsung A15 ของสมชาย"
  secret_hash text not null,                    -- sha256 ของ device secret (ไม่เก็บตัวจริง)
  status      text not null default 'active',   -- active | revoked
  bound_by    text,
  bound_at    timestamptz default now(),
  revoked_at  timestamptz,
  last_seen   timestamptz,
  ua          text
);
create unique index if not exists att_devices_one_active
  on att_devices(employee_id) where status = 'active';

-- ── 3) เหตุการณ์แตะ (append-only — ห้ามแก้/ลบจากฝั่งพนักงาน) ──
create table if not exists att_events (
  id          text primary key,
  employee_id text not null references employees(id) on delete cascade,
  device_id   text,
  point_id    text,
  route_id    text,                             -- snapshot สายที่สังกัดตอนแตะ
  vehicle_id  text,                             -- รถที่แตะ (ถ้าเป็นสติ๊กเกอร์บนรถ)
  work_date   date not null,                    -- วันทำงาน (ตัดที่ 04:00 กันกะข้ามคืน)
  ts          timestamptz not null default now(),  -- เวลา server = ตัวจริง
  client_ts   timestamptz,                      -- เวลาจากเครื่อง ไว้จับคนแก้เวลามือถือ
  seq         int,                              -- ครั้งที่เท่าไรของวันนั้น
  lat         numeric,
  lng         numeric,
  accuracy    numeric,
  dist_m      numeric,
  flags       jsonb default '{}'::jsonb,        -- {far,noloc,clockskew,dup,mock,lonely}
  ua          text,
  ip          text
);
create index if not exists att_events_date  on att_events(work_date);
create index if not exists att_events_emp   on att_events(employee_id, work_date);
create index if not exists att_events_route on att_events(route_id, work_date);

-- ── 4) ตารางเวลาต่อสาย (ตั้งค่าในแอป: หน้าเงินเดือน → ⏱ เวลาเข้างาน) ──
create table if not exists route_shifts (
  route_id       text primary key references routes(id) on delete cascade,
  enabled        boolean default true,
  start_time     time,                          -- เวลาเข้างาน เช่น 05:30
  trips          int default 1,                 -- จำนวนรอบส่งต่อวัน
  trips_json     jsonb,                         -- [{start:'05:30',end:'09:00'}, ...] เวลาออก/กลับแต่ละเที่ยว
  expected_taps  int,                           -- = 1 + trips*2 (คำนวณให้อัตโนมัติ)
  grace_min      int default 10,                -- สายได้กี่นาที
  work_days      text default '1234567',        -- 1=จันทร์ … 7=อาทิตย์ (ค่าเริ่มต้น = ทำงานทุกวัน)
  point_mode     text default 'vehicle',        -- vehicle | place | off (off = ไม่ต้องตอกเวลา)
  place_point_id text,                          -- ถ้า point_mode='place' แตะที่จุดไหน
  note           text
);

-- ── 4b) เผื่อเคยรันเวอร์ชันก่อนหน้าไปแล้ว ──
alter table route_shifts add column if not exists trips_json jsonb;
alter table att_points   add column if not exists kind text default 'vehicle';
alter table att_points   add column if not exists vehicle_id text;
alter table att_points   add column if not exists route_id text;
alter table att_events   add column if not exists vehicle_id text;

-- ── 5) สิทธิ์ (Supabase SQL editor ไม่ auto-grant ให้ anon) ──
grant all on table att_points   to anon, authenticated, service_role;
grant all on table att_devices  to anon, authenticated, service_role;
grant all on table att_events   to anon, authenticated, service_role;
grant all on table route_shifts to anon, authenticated, service_role;

alter table att_points   disable row level security;
alter table att_devices  disable row level security;
alter table att_events   disable row level security;
alter table route_shifts disable row level security;

-- ── 6) จุดแตะเริ่มต้นสำหรับบูรชัย (แก้ชื่อ/เพิ่มได้ในแอป) ──
insert into att_points (id, name, kind, radius_m)
values ('p_burachai', 'ลานจอดบูรชัย', 'place', 250)
on conflict (id) do nothing;


-- ────────── attendance_enroll.sql ──────────
-- ═══════════════════════════════════════════════════════════
-- ลงทะเบียนเครื่องด้วยรหัส (QR + รหัส 7 หลัก)
-- รันต่อจาก attendance_migration.sql · รันซ้ำได้ไม่พัง
-- ═══════════════════════════════════════════════════════════

-- เครื่องที่ยังรออนุมัติจะยังไม่มีเจ้าของ → employee_id ต้องว่างได้
alter table att_devices alter column employee_id  drop not null;
alter table att_devices alter column secret_hash  drop not null;

-- รหัสจับคู่ + ตัวยืนยันว่าเป็นเครื่องเดิมที่ขอมา
alter table att_devices add column if not exists code       text;         -- รหัสที่โชว์บนมือถือ เช่น BC37041
alter table att_devices add column if not exists claim_hash text;         -- sha256 ของ secret ฝั่งเครื่อง
alter table att_devices add column if not exists claim_token text;        -- token ที่รอให้เครื่องมารับ (ล้างทิ้งหลังรับแล้ว)
alter table att_devices add column if not exists expires_at timestamptz;  -- รหัสหมดอายุ 15 นาที

create index if not exists att_devices_code on att_devices(code) where status = 'pending';

-- สถานะ: pending (รออนุมัติ) | active (ใช้งานได้) | revoked (ถูกถอน)


-- ────────── attendance_multi.sql ──────────
-- ═══════════════════════════════════════════════════════════
-- ยืนยันกฎ "1 พนักงาน = 1 เครื่อง" (ป้องกันฝากเครื่องให้เพื่อนกดแทน)
-- รันต่อจาก attendance_enroll.sql · รันซ้ำได้ไม่พัง
-- ═══════════════════════════════════════════════════════════

-- 1) ถ้ามีใครเผลอมีหลายเครื่องอยู่แล้ว เก็บเครื่องล่าสุดไว้เครื่องเดียว
update att_devices d set status = 'revoked', revoked_at = now()
where d.status = 'active'
  and exists (
    select 1 from att_devices x
    where x.employee_id = d.employee_id
      and x.status = 'active'
      and x.bound_at > d.bound_at
  );

-- 2) บังคับที่ระดับฐานข้อมูล — ต่อให้โค้ดพลาดก็เพิ่มเครื่องที่ 2 ไม่ได้
create unique index if not exists att_devices_one_active
  on att_devices(employee_id) where status = 'active';


-- ────────── attendance_viewkey.sql ──────────
-- ═══════════════════════════════════════════════════════════
-- กุญแจดูข้อมูลตัวเอง (สำหรับไอคอนบนหน้าจอโฮม)
-- เก็บเฉพาะค่า hash — ต่อให้ฐานข้อมูลหลุดก็ถอดกุญแจกลับไม่ได้
-- รันต่อจาก attendance_enroll.sql · รันซ้ำได้ไม่พัง
-- ═══════════════════════════════════════════════════════════

alter table att_devices add column if not exists view_hash text;

create index if not exists att_devices_viewhash
  on att_devices(view_hash) where status = 'active';


-- ────────── attendance_alerts.sql ──────────
-- ═══════════════════════════════════════════════════════════
-- แจ้งเหตุจากหน้างาน (รถเสีย ฯลฯ) — ปุ่ม 🚨 ในหน้าพนักงาน
-- รันต่อจาก attendance_viewkey.sql · รันซ้ำได้ไม่พัง
-- ═══════════════════════════════════════════════════════════

create table if not exists att_alerts (
  id          text primary key,
  employee_id text not null references employees(id) on delete cascade,
  device_id   text,
  route_id    text,
  kind        text not null default 'breakdown',  -- breakdown | other
  work_date   date not null,
  ts          timestamptz not null default now(),
  lat         numeric,
  lng         numeric,
  accuracy    numeric,
  note        text,
  status      text not null default 'open',       -- open | closed
  closed_at   timestamptz,
  ua          text,
  ip          text
);
create index if not exists att_alerts_date on att_alerts(work_date);

grant all on table att_alerts to anon, authenticated, service_role;
alter table att_alerts disable row level security;


-- ────────── push_migration.sql ──────────
-- ═══════════════════════════════════════════════════════════
-- แจ้งเตือนเด้งเข้ามือถือ (Web Push)
-- รันต่อจาก attendance_alerts.sql · รันซ้ำได้ไม่พัง
-- ═══════════════════════════════════════════════════════════

-- เครื่องที่สมัครรับแจ้งเตือน (1 แถว = 1 เบราว์เซอร์/ไอคอน)
create table if not exists push_subs (
  id         text primary key,
  endpoint   text not null unique,   -- URL ปลายทางของบริการ push
  role       text not null,          -- admin | user | viewer | hr (บทบาทตอนสมัคร)
  label      text,                   -- ชื่อเครื่องคร่าวๆ
  created_at timestamptz default now(),
  last_sent  timestamptz,
  fail_count int default 0
);

-- ค่าตั้งค่าทั่วไปของแอป (เก็บเป็น key/value)
create table if not exists app_settings (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- ค่าเริ่มต้น: ใครได้รับแจ้งเตือนรถเสียบ้าง
insert into app_settings (key, value)
values ('alert_roles', '["admin","hr"]'::jsonb)
on conflict (key) do nothing;

grant all on table push_subs    to anon, authenticated, service_role;
grant all on table app_settings to anon, authenticated, service_role;
alter table push_subs    disable row level security;
alter table app_settings disable row level security;

