-- ═══════════════════════════════════════════════════════════
-- ระบบเช็คเวลาเข้างาน NFC — น้องลัดดา
-- รันทั้งไฟล์นี้ใน Supabase SQL editor ครั้งเดียว
-- ═══════════════════════════════════════════════════════════

-- ── 1) เครื่องที่ผูกกับพนักงาน (1 คน = 1 เครื่อง active) ──
create table if not exists att_devices (
  id          text primary key,
  employee_id text not null references employees(id) on delete cascade,
  label       text,                          -- ชื่อเครื่อง เช่น "Samsung A15 ของสมชาย"
  secret_hash text not null,                 -- sha256 ของ device secret (ไม่เก็บตัวจริง)
  status      text not null default 'active',-- active | revoked
  bound_by    text,                          -- ใครเป็นคนผูก
  bound_at    timestamptz default now(),
  revoked_at  timestamptz,
  last_seen   timestamptz,
  ua          text                           -- user agent ตอนผูก
);
-- กันไม่ให้ 1 พนักงานมีเครื่อง active มากกว่า 1 เครื่อง
create unique index if not exists att_devices_one_active
  on att_devices(employee_id) where status = 'active';

-- ── 2) จุดแตะ (สติ๊กเกอร์ NFC แต่ละใบ) ──
create table if not exists att_points (
  id         text primary key,
  name       text not null,                  -- "ประตูหน้าโกดัง"
  lat        numeric,
  lng        numeric,
  radius_m   int default 200,                -- แตะห่างเกินนี้ = ตีธง
  status     text not null default 'active',
  created_at timestamptz default now()
);

-- ── 3) เหตุการณ์แตะ (append-only — ห้ามแก้/ลบจากฝั่งพนักงาน) ──
create table if not exists att_events (
  id          text primary key,
  employee_id text not null references employees(id) on delete cascade,
  device_id   text references att_devices(id) on delete set null,
  point_id    text references att_points(id) on delete set null,
  route_id    text,                           -- snapshot สายที่สังกัดตอนแตะ
  work_date   date not null,                  -- วันทำงาน (ตัดที่ 04:00 กันกะข้ามคืน)
  ts          timestamptz not null default now(),  -- เวลาจาก server = ตัวจริง
  client_ts   timestamptz,                    -- เวลาจากเครื่อง ไว้เทียบว่าโกงเวลาไหม
  seq         int,                            -- ครั้งที่เท่าไรของวันนั้น
  lat         numeric,
  lng         numeric,
  accuracy    numeric,                        -- ความแม่นยำ GPS (เมตร)
  dist_m      numeric,                        -- ระยะห่างจากจุดแตะ
  flags       jsonb default '{}'::jsonb,      -- {far:true, noloc:true, clockskew:true, dup:true}
  ua          text,
  ip          text
);
create index if not exists att_events_date  on att_events(work_date);
create index if not exists att_events_emp   on att_events(employee_id, work_date);
create index if not exists att_events_route on att_events(route_id, work_date);

-- ── 4) ตารางเวลาต่อสาย (แต่ละสายเข้างานคนละเวลา จำนวนรอบไม่เท่ากัน) ──
create table if not exists route_shifts (
  route_id      text primary key references routes(id) on delete cascade,
  start_time    time,                         -- เวลาเข้างาน เช่น 05:30
  trips         int default 1,                -- จำนวนรอบส่งต่อวัน
  expected_taps int,                          -- จำนวนครั้งที่ควรแตะ = 1 + trips*2
  grace_min     int default 10,               -- สายได้กี่นาทีถึงจะนับว่าสาย
  work_days     text default '1234567',       -- วันทำงาน (1=จันทร์)
  note          text
);

-- ── 5) สิทธิ์ (Supabase SQL editor ไม่ auto-grant ให้ anon) ──
grant all on table att_devices  to anon, authenticated, service_role;
grant all on table att_points   to anon, authenticated, service_role;
grant all on table att_events   to anon, authenticated, service_role;
grant all on table route_shifts to anon, authenticated, service_role;

alter table att_devices  disable row level security;
alter table att_points   disable row level security;
alter table att_events   disable row level security;
alter table route_shifts disable row level security;

-- ── 6) จุดแตะเริ่มต้น 1 จุด (แก้ชื่อ/พิกัดทีหลังในแอปได้) ──
insert into att_points (id, name, radius_m)
values ('p_office', 'ออฟฟิศ / โกดัง', 200)
on conflict (id) do nothing;
