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
