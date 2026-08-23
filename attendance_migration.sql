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
  expected_taps  int,                           -- = 1 + trips*2 (คำนวณให้อัตโนมัติ)
  grace_min      int default 10,                -- สายได้กี่นาที
  work_days      text default '123456',         -- 1=จันทร์ … 7=อาทิตย์
  point_mode     text default 'vehicle',        -- vehicle | place | off (off = ไม่ต้องตอกเวลา)
  place_point_id text,                          -- ถ้า point_mode='place' แตะที่จุดไหน
  note           text
);

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
