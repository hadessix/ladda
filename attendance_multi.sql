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
