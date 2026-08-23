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
