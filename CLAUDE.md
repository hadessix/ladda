# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"น้องลัดดา" — a cash-counting and income/expense tracking app for multi-route businesses. Runs as a **single `index.html` file** with no build tools, no dependencies, and no package manager. Open directly in a browser or serve via Cloudflare Pages.

- Live URL: https://ladda-b0j.pages.dev/
- GitHub: https://github.com/hadessix/ladda
- Supabase: https://lsxnbdhyfsuqhopzuwls.supabase.co

## Deploy

```bash
# Deploy Worker (เมื่อแก้ worker.js)
wrangler deploy

# Deploy Pages (เมื่อแก้ index.html)
git add index.html && git commit -m "msg" && git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true
```

No local dev server needed — open `index.html` directly in a browser to test.

## Architecture

Everything lives in `index.html` in this order:
1. **`<style>`** — all CSS (CSS variables in `:root`, dark theme)
2. **`<body>`** — overview screen (`#overview-screen`) + login screen (`#login-screen`) + app shell (`#app`)
3. **`<script>`** — all JavaScript, structured as:
   - Constants & utilities (`BT`, `bv`, `cpk`, `fmt`, `uid`, `today`)
   - Worker API helpers (`_wToken`, `_wFetch`, `sbGet`, `sbUpsert`, `sbDelete`)
   - Field mappers (`entryToRow`, `rowToEntry`)
   - Global state (`S`, `AUTH`)
   - Data loading (`loadAll`)
   - Auth (`authInit`, `sha256`, `pinCheck`, `showApp`, `logout`, `isAdmin`)
   - Render functions (`render`, `renderSidebar`, `renderContent`, `renderShopContent`, `renderGroupContent`)
   - Overview page (`showOverview`, `backToMain`, `renderOverview`, `renderOvTabs`, `toggleOvVisible`, `setOvYear`, `setOvMonth`)
   - Feature logic (count, income, expense, exchange, payowner)
   - Modal helpers (`OM`, `CM`, `CMask`, `toast`)

## Global State

```js
S = {
  shops:   [{ id, name, color, tab_flags, sort_order }],
  groups:  [{ id, name, sort_order, is_owner, tab_flags }],
  groupMembers: { [groupId]: [routeId, ...] },
  entries: { [routeId]: { [monthKey]: [entry, ...] } },
  sessions:{ [routeId]: { [monthKey]: { subs: [{df, dt, bills}] } | null } },
  view:  { type: 'shop'|'group', id: string },
  shop:  string,   // shortcut = view.id when type==='shop'
  month: "YYYY-MM",
  year:  "YYYY"
}

AUTH = { role: 'user' | 'admin' | 'viewer' }  // persisted in localStorage: 'ladda_role'
// Token: localStorage 'ladda_token' (JWT issued by Worker, 30-day expiry)
```

## Supabase Schema

```sql
routes (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#22c55e',
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true,"payowner":false,"auto_collect":false,"viewer_visible":false}',
  sort_order  int DEFAULT 0,
  created_at  timestamp DEFAULT now()
)

entries (
  id              text PRIMARY KEY,
  route_id        text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  month_key       text NOT NULL,       -- "YYYY-MM"
  type            text NOT NULL,       -- count | income | expense | exin | exout
  title           text,
  note            text,
  date_from       date,
  date_to         date,
  amount          numeric DEFAULT 0,
  total           numeric DEFAULT 0,
  bills           jsonb,               -- { 1000:n, 500:n, 100:n, 50:n, 20:n, coin:n }
  subs            jsonb,               -- for count type
  other_route_id  text,               -- for exin/exout
  created_at      timestamp DEFAULT now()
)

sessions (
  id          text PRIMARY KEY,
  route_id    text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  month_key   text NOT NULL,
  subs        jsonb,
  created_at  timestamp DEFAULT now(),
  UNIQUE(route_id, month_key)
)

groups (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  sort_order  int DEFAULT 0,
  is_owner    boolean DEFAULT false,
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true,"payowner":false,"auto_collect":false,"viewer_visible":false}'
)

group_members (
  group_id    text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  route_id    text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  sort_order  int DEFAULT 0,
  PRIMARY KEY (group_id, route_id)
)
```

RLS is disabled; anon key has full CRUD on all tables (accessed only via Worker).

### Entry types

| type | ความหมาย | ผลต่อยอด |
|---|---|---|
| `count` | รอบนับเงิน (has `subs[]`) | +total |
| `income` | รายรับพิเศษ | +amount |
| `expense` | รายจ่าย | -amount |
| `exin` | รับแลกเงิน / รับจากจ่ายเฮียรวย | +amount |
| `exout` | แลกเงินออก / จ่ายเฮียรวย | -amount |

> **Summary cards**: `tIncome` = `income` only, `tExpense` = `expense` only — exin/exout ไม่นับในช่องรายรับ/รายจ่าย แต่รวมใน net: `net = tCount + tIncome − tExpense + tExIn − tExOut`

### JS ↔ Supabase field mapping

| JS | Supabase |
|---|---|
| `df` | `date_from` |
| `dt` | `date_to` |
| `oid` | `other_route_id` |

## Auth

```
เปิดแอป
  └─ มี ladda_role + ladda_token ใน localStorage?
        ├─ ใช่ → showApp()
        │         ├─ admin/user → main app (#app)
        │         └─ viewer     → overview screen (#overview-screen)
        └─ ไม่ → แสดงหน้า password input
                   └─ กรอก PIN → sha256(PIN) → POST /auth (Worker)
                         ├─ admin  → token + role → main app
                         ├─ user   → token + role → main app
                         ├─ viewer → token + role → overview screen (read-only)
                         └─ ผิด   → error, ล้าง input
```

- PIN จริงและ hash ไม่มีใน source code เลย — อยู่แค่ใน Cloudflare Worker env vars
- `isAdmin()` guards all delete/manage actions
- Logout: ลบ `ladda_role` + `ladda_token` → แสดงหน้า login

## Roles

| Role | PIN | สิทธิ์ |
|---|---|---|
| `admin` | (Worker secret) | ทุกอย่าง รวมถึงลบ จัดการสาย/กลุ่ม ตั้งค่า overview |
| `user` | (Worker secret) | ดู + เพิ่มข้อมูล, ลบไม่ได้, จัดการสายไม่ได้ |
| `viewer` | (Worker secret) | เข้าได้เฉพาะหน้าภาพรวม (overview), ดูอย่างเดียว |

## Overview Page (`#overview-screen`)

- **viewer**: เห็นเฉพาะกลุ่ม/สายที่ `viewer_visible: true`
- **admin**: เห็นทุกกลุ่ม/สาย + ปุ่ม 👁️ บนการ์ดเพื่อ toggle การแสดงผล; การ์ดที่ซ่อนจะ opacity 0.45
- แสดง: กลุ่มร้านค้า (ยอดรวมทั้งกลุ่ม) + สายที่ไม่มีกลุ่ม
- **ไม่แสดง**: สายย่อยที่อยู่ในกลุ่มแยกรายสาย
- `viewer_visible` เก็บใน `tab_flags` jsonb ของทั้ง routes และ groups
- admin เข้า overview ได้จากปุ่ม "📊 ภาพรวม" ที่ header; มีปุ่ม "← หน้าหลัก" กลับ
- **Navigation**: tab ปี (BE) → tab เดือน (`#ov-tabs-bar`); เดือนที่ > `cpk()` จะไม่แสดง; `S.ovYear` เก็บปีที่เลือกใน overview
- **Chart** (`#ov-chart-canvas`): กราฟเส้นยอดสุทธิรายเดือน (1–12) ใช้ Chart.js 4.4 (CDN); ปุ่มเลือกได้เฉพาะกลุ่ม + สายไม่มีกลุ่ม; เลือกกลุ่มเดียว → แตกรายสายในกลุ่ม (สีตาม route.color); มีชื่อสายกำกับท้ายเส้น (`_endLabelPlugin`); กลุ่มใช้สีจาก `_GPC[]` palette

## Key Patterns

- **bills object**: `{ 1000: n, 500: n, 100: n, 50: n, 20: n, coin: n }` — `coin` = ฿1 each; use `bv(bills)` to compute total
- **month_key**: `"YYYY-MM"` — fiscal period starts on 11th of month; `cpk()` returns current period key; `shopTot(sid, mk)` accepts optional `mk` param — always pass `mk` explicitly when computing for a specific month, not current
- **tab_flags**: `{ count, income, expense, exchange, payowner, auto_collect, viewer_visible }` — controls tabs + visibility; `curTabFlags()` returns flags for current view
- **`_cbMap` global**: stores bill-input callbacks by prefix to avoid JSON.stringify/double-quote conflicts in inline `oninput` attributes
- **`calcCB(sid, mk)`**: computes cumulative bills in cash box for a single route at a given month by replaying all entries
- **`calcCBGroup(gid, mk)`**: sums `calcCB()` across **all** routes in the group (not just the first). Use this whenever checking group balance.
- **`firstRouteWithMoney(gid, mk)`**: returns first route in group that has a positive balance; used to pick the source route when writing exout entries for a group
- **Modal UX**: modals are fullscreen (`width:100%; height:100%`); clicking outside does NOT close; close button calls `CMask()` which calls `confirm()` before closing to prevent accidental data loss
- **Exchange modal** (`openExchange(fromShop, lockedId)`):
  - Left dropdown: groups (`g:${id}`) + standalone routes (`r:${id}`) — **not** individual routes that are in a group
  - Right dropdown: same rule, excludes self and own group
  - Both sides specify bills to give out (bilateral swap); each side validated against `calcCBGroup` (for groups) or `calcCB` (for routes)
  - When group is on left: exout entry saved to `firstRouteWithMoney(Lid)`, not always first route
  - When group is on right: exout entry saved to `firstRouteWithMoney(Rid)`, validated against `calcCBGroup`
  - Paired exout+exin entries (same `oid`, same `df`) are displayed as **one combined row** via `renderEntriesList` + `renderExchangePair`; delete button (`delExPair`) deletes both at once
- **Pay-owner tab**: `tab_flags.payowner`; target group must have `is_owner=true`; saves exout+exin
- **Count flow** (simplified — no session step):
  - `openCount()` opens a modal with bill inputs; pressing "บันทึก" calls `saveCountDirect()` immediately
  - `saveCountDirect()` creates a `count` entry directly (no intermediate session); entry has `subs:[{df,dt,bills}]`
  - If a stale open session exists from old data, it shows "สรุปรอบค้าง" + "ยกเลิก" buttons only
  - **No auto-collect** on count save (removed to prevent orphaned exout entries on delete)
- **Sidebar icon**: `⭐` = is_owner group, `⚡` = auto_collect group, `📁` = normal group

## Function Reference

| Function | หน้าที่ |
|---|---|
| `authInit()` | ตรวจ localStorage → showApp() หรือแสดงหน้า login |
| `sha256(str)` | async — SHA-256 via Web Crypto API |
| `pinCheck()` | async — hash → POST Worker /auth → token + role → showApp() |
| `showApp()` | ซ่อน login; viewer→overview, admin/user→app |
| `logout()` | ลบ localStorage token+role, ซ่อน overview+app, แสดง login |
| `isAdmin()` | คืน true ถ้า role === 'admin' |
| `loadAll()` | โหลดข้อมูลทั้งหมดจาก Worker/Supabase |
| `render()` | re-render ทุก component |
| `renderSidebar()` | sidebar: กลุ่ม + สายไม่มีกลุ่ม |
| `renderContent()` | router → renderShopContent() หรือ renderGroupContent() |
| `renderShopContent()` | หน้าสาย |
| `renderGroupContent()` | หน้าสรุปกลุ่ม |
| `setView(type,id)` | เปลี่ยน view แล้ว render() |
| `curTabFlags()` | คืน tab_flags ของ view ปัจจุบัน |
| `showOverview()` | เปิดหน้า overview (admin badge + back button) |
| `backToMain()` | ปิดหน้า overview กลับ main app |
| `renderOverview()` | render การ์ดกลุ่ม+standalone shops; admin เห็นทั้งหมด, viewer เห็นเฉพาะ visible |
| `toggleOvVisible(type,id)` | admin toggle viewer_visible → upsert routes/groups → re-render |
| `renderOvTabs()` | render year+month tabs ใน overview; กรอง > cpk() ออก |
| `setOvYear(y)` | เลือกปีใน overview → renderOvTabs + renderOverview |
| `setOvMonth(mk)` | เลือกเดือนใน overview → renderOvTabs + renderOverview |
| `fmtMk(k)` | format month key เป็น "เดือนนี้" หรือ "[N] ชื่อเดือน"; ใช้ทั้ง main page และ overview |
| `renderOvChart()` | render/update Chart.js line chart; items = กลุ่ม + standalone; เลือกกลุ่มเดียว → drilldown รายสาย |
| `toggleOvShop(id)` | toggle กลุ่ม/สายใน `_ovShopVis` Set → renderOvChart() |
| `_ovCalc(ids)` | helper คำนวณยอดรวมจาก shop id หลายสาย |
| `groupTot(gid,mk)` | ยอดรวมของกลุ่ม (รับ mk optional) |
| `shopTot(sid,mk)` | ยอดสุทธิของสาย **ของเดือน mk** (mk required เมื่อไม่ใช่เดือนปัจจุบัน) |
| `grandTot()` | ยอดรวมทุกสาย |
| `groupedRouteIds()` | Set ของ routeId ที่อยู่ในกลุ่ม |
| `cpk()` | คืน month key ปัจจุบัน |
| `bv(bills)` | คำนวณยอดจาก bills object |
| `calcCB(sid,mk)` | แบงค์คงเหลือในกล่องของ route เดียว ณ เดือนนั้น |
| `calcCBGroup(gid,mk)` | แบงค์คงเหลือรวมทุก route ในกลุ่ม |
| `firstRouteWithMoney(gid,mk)` | route แรกในกลุ่มที่มียอด > 0 (fallback: route แรก) |
| `ge/gs/ss/cs` | entries array / get/set/clear session |
| `sbGet/sbUpsert/sbDelete` | Worker API helpers (ต้องมี token) |
| `entryToRow/rowToEntry` | map JS ↔ Supabase fields |
| `openCount()` | เปิด modal นับเงิน (ไม่มี session step) |
| `saveCountDirect()` | บันทึก count entry ทันที ไม่ผ่าน session |
| `openExchange/saveExchange` | modal แลกเงิน (bilateral, group-aware) |
| `refreshExchangeCB(fromShop)` | อัปเดต cap + label เมื่อเปลี่ยน dropdown |
| `renderEntriesList(entries)` | render รายการ; จับคู่ exout+exin (oid+df เดียวกัน) → renderExchangePair |
| `renderExchangePair(exout,exin)` | render คู่แลกเงินเป็น row เดียว (badge แลกเงิน, ยอดสองฝั่ง) |
| `delExPair(ev,id1,id2)` | ลบ exout+exin คู่พร้อมกัน |
| `renderEntry(e)` | render entry เดี่ยว (count/income/expense/exin/exout ที่ไม่มีคู่) |
| `openPayOwner/openPayOwnerGroup/savePayOwner` | จ่ายเฮียรวย |
| `billInp/billInpWithLimit/updB/updBLimit/gb` | bill input helpers |
| `addShop/saveShop/editShop/saveEditShop/deleteShop` | จัดการสาย (admin) |
| `addGroup/saveGroup/editGroup/saveEditGroup/deleteGroup` | จัดการกลุ่ม (admin) |
| `tfChips/getTf/toggleTf` | tab_flags chip UI |
| `toggleGrpCard(id)` | ขยาย/ยุบ card ใน group view |
| `OM/CM/CMask/toast` | modal open/close/confirm-close, notification |

## Security

| Layer | สถานะ | รายละเอียด |
|---|---|---|
| PIN hashing | ✅ Done | hash อยู่ใน Worker env เท่านั้น ไม่มีใน source |
| Cloudflare Worker proxy | ✅ Done | ไม่มี Supabase key ใน source; JWT token 30 วัน |
| Supabase RLS | 🔲 TODO | ยังใช้ anon key (ผ่าน Worker); RLS จริงต้องการ auth token |

### Worker (`worker.js`)
- URL: `https://ladda-api.hades-six.workers.dev`
- `POST /auth` → ตรวจ hash → ออก JWT (role: admin/user/viewer)
- `GET|POST|DELETE /api/:table` → validate JWT → proxy ไป Supabase
- Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `HASH_USER`, `HASH_ADMIN`, `HASH_VIEWER`, `JWT_SECRET`
- 401 จาก Worker → `logout()` อัตโนมัติ

## Payroll System (`PR` state)

admin-only หน้าเงินเดือน — merged to main, deployed to production

### การเข้าถึง
- ปุ่ม **💼 เงินเดือน** ใน header (แสดงเฉพาะ admin)
- `showPayroll()` → ซ่อน `#app` + แสดง `#payroll-screen`
- `backFromPayroll()` → กลับ main app

### Global State
```js
PR = {
  tab: 'periods' | 'employees',
  month: "YYYY-MM",   // BE year, calendar month เช่น "2568-06"
  employees: [],
  loans: [],          // employee_loans
  periods: [],        // payroll_periods
  entries: [],        // payroll_entries
  deductions: [],     // payroll_deductions
  _loaded: false
}
```

### Payroll Tables (Supabase)
```sql
employees         -- โปรไฟล์พนักงาน (ติดตามตัวคน ไม่ใช่สาย)
employee_loans    -- บัตร(ใบอนุญาต)/ยืม ที่ผ่อนอยู่
payroll_periods   -- งวด 10 วัน (3 งวด/เดือน)
payroll_entries   -- สลิปต่อคนต่องวด
payroll_deductions -- รายการหักแต่ละรายการในสลิป
```

> **สำคัญ**: ต้อง GRANT + disable RLS ให้ทุก table ใหม่ เพราะ Supabase SQL editor ไม่ auto-grant anon role
> ```sql
> grant all on table employees to anon, authenticated, service_role;
> -- (ทำซ้ำสำหรับทุก table)
> alter table employees disable row level security;
> -- (ทำซ้ำสำหรับทุก table)
> ```

### Period Keys
- รูปแบบ: `"YYYY-MM-A"` (BE year, calendar month)
- A = 1–10 จ่าย 11, B = 11–20 จ่าย 21, C = 21–31 จ่าย 1 ของเดือนถัดไป

### สูตรคำนวณ net_pay
```
ค่าแรง (daily_rate) × วันทำงาน + โบนัส − รวมหัก (deductions) − เบิก (advance)
```

### Employee Status
- `active` → ทำงานอยู่
- `resigned` → ออกแล้ว (มีประวัติ)
- `blacklisted` → ห้ามรับกลับ (มีหนี้ค้าง)

### Loan Types
- `permit` → บัตรใบอนุญาตทำงาน (ผ่อนงวด)
- `loan` → ยืมเงิน (ผ่อนงวด, อนาคตมีดอกเบี้ย)
- `other` → อื่นๆ

### Flow การจ่ายเงิน
1. `generatePeriod(beYM, slot)` → สร้างงวด + entries ทุกคน + auto-ดึง deductions จาก active loans
2. admin แก้ days_worked / bonus / advance ได้ในแต่ละ entry
3. `markPeriodPaid(periodId)` → status='paid' + อัปเดต `paid_amount` ใน employee_loans
4. loan ที่ paid_amount >= total_amount → status='completed' อัตโนมัติ

### ฟังก์ชัน Payroll หลัก
| ฟังก์ชัน | หน้าที่ |
|---|---|
| `showPayroll()` | เปิดหน้าเงินเดือน + โหลดข้อมูล |
| `loadPayroll()` | โหลด 5 tables พร้อมกัน; sets `PR._loaded=true` |
| `setPrTab(tab)` | เปลี่ยน tab periods/employees |
| `generatePeriod(beYM,slot)` | สร้างงวด + entries + deductions; guard `PR._loaded`; ถ้ามี stale period (ไม่มี entries) จะลบแล้วสร้างใหม่ |
| `openPeriod(periodId)` | modal สลิปทุกคน จัดกลุ่มเป็น card ตามสาย; แยก col หัก: ห้องพัก / ค่าบัตร / อื่นๆ; แสดง daily_rate/วัน |
| `prUpdateEntry(id,field,val)` | แก้ days/bonus/advance แล้ว save |
| `openPrEntryDetail(id,periodId)` | modal แก้ละเอียดต่อคน |
| `openAddDed(entryId,periodId)` | เพิ่มรายการหัก (จาก loan หรือ manual) |
| `markPeriodPaid(periodId)` | จ่ายแล้ว + update loans |
| `renderPrEmployees()` | tab พนักงาน (แยก active/inactive, grouped by route/dept); กรองตาม `_prSettings.hideManager/hideTopManager` |
| `quickAssignRoute(empId,routeId)` | กำหนด route_id ให้พนักงานแบบ inline (ไม่ต้องเปิด modal) |
| `prMoveRoute(routeId,dir)` | สลับ sort_order ของ route ขึ้น/ลง → upsert routes |
| `openAddEmployee()` | modal เพิ่มพนักงาน (ชื่อ/สาย/แผนก/ตำแหน่ง/ค่าแรง/ค่าโทร/ค่าห้อง) |
| `openEditEmployee(empId)` | modal แก้ไขพนักงาน |
| `saveEmployee(editId)` | บันทึกพนักงาน (editId=null → เพิ่มใหม่); fields รวม `position` |
| `openEmpDetail(empId)` | โปรไฟล์พนักงาน + ประวัติ loan |
| `setEmpStatus(empId,status)` | active/resigned/blacklisted |
| `openAddLoan(empId)` | เพิ่ม loan/บัตร |
| `saveLoan(empId)` | บันทึก loan |

### Payroll gotchas
- **uid collision**: `uid()` ใช้ `crypto.randomUUID()` — อย่าเปลี่ยนกลับเป็น Date.now+random; การสร้าง 42 entries พร้อมกันใน `.map()` จะ collision แน่นอนถ้าใช้ timestamp-based id
- **insert order**: ต้อง upsert `payroll_entries` ก่อน `payroll_deductions` เสมอ (FK: deductions.entry_id → entries.id)
- **generatePeriod guard**: เช็ค `PR._loaded` ก่อนทำงาน; ถ้า render หน้า payroll ก่อน loadPayroll เสร็จ PR.employees จะว่างเปล่า
- **_openPeriodId**: เก็บ periodId ที่ modal เปิดอยู่; tray toggle ใช้ re-open modal หลังเปลี่ยน settings; ต้อง check `PR.tab==='periods'` ก่อน ไม่งั้นจะเด้งไปงวดจ่ายตอนอยู่ tab พนักงาน
- **_prSettings** (localStorage `pr_settings`): `{ hideRates, hideManager, hideTopManager }` — hideManager/hideTopManager กรองพนักงานตาม `emp.position` ทั้งหน้าพนักงานและ openPeriod modal

### Employee fields
| field | type | หมายเหตุ |
|---|---|---|
| `name` | text | ชื่อพนักงาน |
| `route_id` | text | สายที่สังกัด (null = ยังไม่มีสาย) |
| `department` | text | แผนก (ออฟฟิส/บัญชี/คลังสินค้า/ขนส่ง/อื่นๆ) — ใช้จัดกลุ่มใน grid เมื่อไม่มีสาย |
| `position` | text | ตำแหน่งงาน (คนขับรถ/เด็กติดรถ/ออฟฟิสทั่วไป/ผู้จัดการ/ผู้จัดการใหญ่) — ใช้ filter ใน _prSettings |
| `daily_rate` | numeric | ค่าแรงต่อวัน |
| `nationality` | text | สัญชาติ |
| `phone_fee` | numeric | ค่าโทรต่องวด |
| `room_fee` | numeric | ค่าห้องต่องวด |
| `status` | text | active/resigned/blacklisted |

### Payroll FAB (floating buttons)
- `#pr-fab-group`: `position:fixed; top:80px; right:24px` — แสดงเมื่อ `showPayroll()`, ซ่อนเมื่อ `backFromPayroll()`
- 📤 `_prShareCurrent()`: ถ้า tab=employees → `shareEmployeeList()`; ถ้า tab=periods → `sharePeriod()` งวดแรกของเดือน
- ⚙️ `togglePrTray()`: เปิด/ปิด bottom tray settings

### งานที่ยังต้องทำ (Payroll)
- [x] นำเข้าข้อมูลพนักงาน 42 คน + 21 permit loans (เดือน6.69.xlsx)
- [ ] กำหนดสายให้พนักงานทุกคน (ใช้ ⚡ กำหนดสาย ในหน้าพนักงาน)
- [ ] กำหนดตำแหน่งงานให้พนักงาน (admin ทำเอง)
- [ ] อัปเดตยอดค้างบัตรใบอนุญาต + วันหมดอายุ (admin ทำเอง)
- [ ] รูปใบอนุญาตทำงาน (Supabase Storage)
- [ ] ดอกเบี้ยเงินยืม (5–10%)
- [ ] เชื่อมระบบเช็คเวลาเข้างาน (feature #2)
- [ ] โปรไฟล์พนักงาน (feature #3)

## Roadmap

- [x] SHA-256 PIN hashing + Cloudflare Worker proxy
- [x] Viewer role + Overview page
- [x] Modal fullscreen + confirm-before-close (CMask)
- [x] shopTot / groupTot แยกรายเดือน (ไม่สะสมข้ามเดือน)
- [x] Exchange dropdown: กลุ่ม + standalone เท่านั้น (ไม่มี route ในกลุ่ม)
- [x] calcCBGroup รวมทุก route ในกลุ่ม + firstRouteWithMoney
- [x] Count บันทึกตรง (saveCountDirect) ไม่มี session step
- [x] Exchange pair แสดงเป็น row เดียว (renderExchangePair)
- [x] Payroll system — employees, loans, periods, auto-calculation
- [x] Payroll merged to main + deployed to production
- [x] openPeriod redesign — grouped by route card, split deduction columns, daily_rate display
- [x] Employee quick-assign route mode (`_prAssignMode`)
- [x] Route reorder (↑↓) via `prMoveRoute()`
- [x] Payroll settings tray (gear FAB) — hideRates, hideManager, hideTopManager
- [x] Share button (📤 FAB) — context-aware: period or employee list; respects hide settings
- [x] Employee position field (คนขับรถ/เด็กติดรถ/ออฟฟิสทั่วไป/ผู้จัดการ/ผู้จัดการใหญ่)
- [ ] กำหนดสายพนักงาน + ตำแหน่ง + อัปเดตยอดบัตรค้าง (admin ทำเอง)
- [ ] ระบบเช็คเวลาเข้างาน (feature #2)
- [ ] โปรไฟล์พนักงาน (feature #3)
- [ ] รูปใบอนุญาตทำงาน (Supabase Storage)
- [ ] Supabase RLS per authenticated user
- [ ] PWA — manifest + service worker
- [ ] Export รายงาน (PDF / Excel)
- [ ] Cross-system integration กับระบบน้ำแข็ง
