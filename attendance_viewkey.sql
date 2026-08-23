-- ═══════════════════════════════════════════════════════════
-- กุญแจดูข้อมูลตัวเอง (สำหรับไอคอนบนหน้าจอโฮม)
-- เก็บเฉพาะค่า hash — ต่อให้ฐานข้อมูลหลุดก็ถอดกุญแจกลับไม่ได้
-- รันต่อจาก attendance_enroll.sql · รันซ้ำได้ไม่พัง
-- ═══════════════════════════════════════════════════════════

alter table att_devices add column if not exists view_hash text;

create index if not exists att_devices_viewhash
  on att_devices(view_hash) where status = 'active';
