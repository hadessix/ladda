// import_employees.js — v2
// อ่านจาก เดือน6.69.xlsx แล้วสร้าง SQL import
// Active = อยู่ใน sheet "11-20" (latest period of latest month)
// Resigned = ไม่อยู่ใน 11-20 แต่มีประวัติใน 1-10 หรือ บัตร
// Run: node import_employees.js > import_employees.sql

const xl = require('xlsx');
const crypto = require('crypto');

const BASE = 'G:/.shortcut-targets-by-id/18kwutUtjkzp1dbvh2nUqfm1Z0q8a3_S_/Lerng duim/งด.พนง เฮียรวย/2569/';
const FILE = BASE + 'เดือน6.69.xlsx';

function uid() { return crypto.randomBytes(8).toString('hex'); }
function esc(s) {
  if (s === null || s === undefined || s === '') return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}
function isNumericName(s) { return /^\d+(\.\d+)?$/.test(String(s).trim()); }

const wb = xl.readFile(FILE);

// Helper: parse payroll sheet (1-10 or 11-20) into employee records
// Columns: [0]=?, [1]=สาย, [2]=ชื่อ, [3]=ค่าแรง, [4]=วัน, [5]=+, [6]=บัตร/งวด,
//          [7]="", [8]=งวดบัตร, [9]=โทรศัพท์, [10]=ค่าโทร, [11]=เบิก, [12]=ยืม,
//          [13]=กส.ห., [14]=กระสอบ, [15]=ห้อง, [16]=รับเงิน, [17]=หมายเหตุ
function parsePaySheet(sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = xl.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const result = [];
  let currentRoute = '';
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[1] && r[1] !== '' && !isNumericName(r[1])) currentRoute = r[1];
    const name = r[2];
    if (!name || name === '' || isNumericName(name)) continue;
    const daily_rate = typeof r[3] === 'number' ? r[3] : 0;
    const days_worked = typeof r[4] === 'number' ? r[4] : 0;
    const permit_per_period = typeof r[6] === 'number' && r[6] > 0 ? r[6] : 0;
    const permit_ref = String(r[8] || '').trim();
    const room_fee = typeof r[15] === 'number' && r[15] > 0 && r[15] < 1000 ? r[15] : 0;
    result.push({ name, route_name: currentRoute, daily_rate, days_worked, permit_per_period, permit_ref, room_fee });
  }
  return result;
}

const latest = parsePaySheet('11-20'); // source of truth for active/resigned
const prev   = parsePaySheet('1-10');  // supplementary (permit_ref, room_fee data)

const activeNames = new Set(latest.map(e => e.name));

// Build unified employee map (prefer latest data, fallback to prev for extra fields)
const empMap = {}; // name -> record

for (const e of latest) {
  // Skip monthly-salary supervisors — handled separately below
  if (e.daily_rate > 0 && e.daily_rate < 50) continue;
  // Skip obvious summary rows
  if (e.daily_rate === 0 && e.days_worked === 0 && !e.permit_ref) continue;
  empMap[e.name] = { ...e, status: 'active' };
}

// Add employees from prev that are NOT in latest (resigned)
const prevRouteMap = {};
for (const e of prev) {
  if (e.daily_rate > 0 && e.daily_rate < 50) continue;
  if (isNumericName(e.name)) continue;
  prevRouteMap[e.name] = e.route_name || e.route_name;
  if (!activeNames.has(e.name) && !empMap[e.name]) {
    empMap[e.name] = { ...e, status: 'resigned' };
  }
}

// Monthly-paid (จ่ายทุกวันที่ 1) แต่ฐานเป็นค่าแรงรายวัน
const MONTHLY_PAY_DAY1 = new Set(['หำ', 'สอน', 'โต้']);

// Supervisors — monthly salary, obfuscated in Excel
// น้าพร=17 in Excel → 17,000 บาท/เดือน
// พี่พี่กุ้ง=7.7 in Excel → 23,100 บาท/เดือน
// (route นั่งโต๊ะ)
empMap['น้าพร'] = {
  name: 'น้าพร', route_name: 'นั่งโต๊ะ', daily_rate: 0, days_worked: 0,
  permit_per_period: 0, permit_ref: '', room_fee: 0,
  status: 'active', monthly_salary: 23100
};
empMap['พี่พี่กุ้ง'] = {
  name: 'พี่พี่กุ้ง', route_name: 'นั่งโต๊ะ', daily_rate: 0, days_worked: 0,
  permit_per_period: 0, permit_ref: '', room_fee: 0,
  status: 'active', monthly_salary: 17000
};

// === Parse บัตร sheet for permit loan data ===
const batSheet = wb.Sheets['บัตร'];
const batRows = xl.utils.sheet_to_json(batSheet, { header: 1, defval: '' });
const permits = {}; // name -> { total_paid, total_should, diff, note }
for (let i = 1; i < batRows.length; i++) {
  const r = batRows[i];
  const name = r[1];
  if (!name || name === '' || isNumericName(name)) continue;
  const total_paid   = typeof r[32] === 'number' ? r[32] : 0;
  const total_should = typeof r[33] === 'number' ? r[33] : 0;
  const diff         = typeof r[34] === 'number' ? r[34] : 0;
  const note         = String(r[35] || '').trim();
  if (total_should > 0 || total_paid > 0) {
    permits[name] = { total_paid, total_should, diff, note };
  }
}

// Add anyone in บัตร but not yet in empMap (old resigned employees with permit history)
// Normalize name variants: มองลี.เติม ↔ มองลี(เติม)
const nameNorm = { 'มองลี.เติม': 'มองลี(เติม)', 'อ่องซิล': 'อ่องซิล' };
for (const [rawName, p] of Object.entries(permits)) {
  const name = nameNorm[rawName] || rawName;
  if (!empMap[name]) {
    // Look for route in prev payroll
    const route_name = prevRouteMap[name] || prevRouteMap[rawName] || '';
    empMap[name] = {
      name, route_name, daily_rate: 0, days_worked: 0,
      permit_per_period: 0, permit_ref: '', room_fee: 0, status: 'resigned'
    };
  }
}

// Assign IDs
const empIds = {};
for (const name of Object.keys(empMap)) {
  empIds[name] = uid();
}

// Normalize permit lookup: also try raw variants
function findPermit(name) {
  if (permits[name]) return permits[name];
  // reverse normalize
  for (const [raw, norm] of Object.entries(nameNorm)) {
    if (norm === name && permits[raw]) return permits[raw];
  }
  return null;
}

// === Output SQL ===
const lines = [];
lines.push('-- ============================================================');
lines.push('-- Employee Import — เดือน6.69.xlsx (sheet 11-20 = source of truth)');
lines.push('-- Generated: ' + new Date().toISOString());
lines.push('-- Run in Supabase SQL Editor');
lines.push('-- ============================================================');
lines.push('');
lines.push('-- STEP 1: employees');
lines.push('');

const active = [], resigned = [];
for (const [name, emp] of Object.entries(empMap)) {
  const id = empIds[name];
  const nat = emp.permit_ref && /mou|MOU|AN|P8|ทำเอง/i.test(emp.permit_ref) ? 'เมียนมา' : 'ไทย';
  const notes = emp.monthly_salary
    ? `เงินเดือนรายเดือน ${emp.monthly_salary.toLocaleString()} บาท`
    : MONTHLY_PAY_DAY1.has(name)
    ? `จ่ายรายเดือนวันที่ 1 (ค่าแรงรายวัน ${emp.daily_rate} บาท)`
    : (emp.permit_ref || null);

  const line = [
    `INSERT INTO employees (id, name, route_id, daily_rate, status, nationality, room_fee, notes)`,
    `  VALUES (${esc(id)}, ${esc(name)},`,
    `          (SELECT id FROM routes WHERE name = ${esc(emp.route_name)} LIMIT 1),`,
    `          ${emp.daily_rate}, ${esc(emp.status)}, ${esc(nat)}, ${emp.room_fee}, ${esc(notes)})`,
    `  ON CONFLICT (id) DO NOTHING;`,
    ''
  ].join('\n');

  if (emp.status === 'active') active.push({ name, line });
  else resigned.push({ name, line });
}

lines.push('-- Active employees (' + active.length + ')');
for (const { line } of active) lines.push(line);

lines.push('');
lines.push('-- Resigned employees SKIPPED (' + resigned.length + ' คน) — จะเพิ่มเองทีหลังเมื่อมีคนออก');

lines.push('');
lines.push('-- STEP 2: employee_loans (permits)');
lines.push('');

let loanCount = 0, warnCount = 0;
const allNames = new Set([...Object.keys(empMap), ...Object.keys(nameNorm).map(k => nameNorm[k])]);

for (const [rawName, p] of Object.entries(permits)) {
  const name = nameNorm[rawName] || rawName;
  // Skip loans for resigned employees
  if (empMap[name]?.status === 'resigned') continue;
  const empId = empIds[name];
  if (!empId) {
    lines.push(`-- !! No employee record for "${rawName}" (total_should=${p.total_should}, paid=${p.total_paid})`);
    warnCount++;
    continue;
  }
  const loanId = uid();
  // diff = paid - should; negative means still owes
  const status = p.diff >= 0 ? 'completed' : 'active';
  const emp = empMap[name] || {};
  const perPeriod = emp.permit_per_period || 0;
  const desc = p.note ? `บัตรใบอนุญาต (${p.note})` : 'บัตรใบอนุญาตทำงาน';

  lines.push(`INSERT INTO employee_loans (id, employee_id, type, description, total_amount, per_period_amount, paid_amount, status)`);
  lines.push(`  VALUES (${esc(loanId)}, ${esc(empId)}, 'permit', ${esc(desc)},`);
  lines.push(`          ${p.total_should}, ${perPeriod}, ${p.total_paid}, ${esc(status)})`);
  lines.push(`  ON CONFLICT (id) DO NOTHING;`);
  lines.push('');
  loanCount++;
}

lines.push('-- ============================================================');
lines.push('-- Summary:');
lines.push(`--   Active employees  : ${active.length}`);
lines.push(`--   Resigned employees: ${resigned.length}`);
lines.push(`--   Permit loans      : ${loanCount}`);
if (warnCount) lines.push(`--   Unmatched WARNING : ${warnCount} (see above)`);
lines.push('-- ============================================================');

console.log(lines.join('\n'));
