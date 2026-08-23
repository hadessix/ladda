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
