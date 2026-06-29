-- ตาราง vehicles: ประวัติรถแบบ 1 แถว = 1 คัน (รองรับหลายคันต่อเจ้าของ)
-- owner_type: 'route' (สายเดี่ยว) | 'group' (กลุ่ม เช่น บูรชัย) | 'office' (ออฟฟิศ ไม่ผูกสาย)
-- รันใน Supabase SQL editor ครั้งเดียว

create table if not exists vehicles (
  id          text primary key,
  owner_type  text not null default 'route',
  owner_id    text,
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

-- Supabase SQL editor ไม่ auto-grant anon role → ต้อง grant + disable RLS เอง
grant all on table vehicles to anon, authenticated, service_role;
alter table vehicles disable row level security;
