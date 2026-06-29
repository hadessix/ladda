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

**IMPORTANT**: Always deploy immediately after every index.html edit — no need to ask first.

No local dev server needed — open `index.html` directly in a browser to test.

## Architecture

Everything lives in `index.html` in this order:
1. **`<style>`** — all CSS (CSS variables in `:root`, dark theme)
2. **`<body>`** — overview screen (`#overview-screen`) + login screen (`#login-screen`) + app shell (`#app`) + payroll screen (`#payroll-screen`)
3. **`<script>`** — all JavaScript, structured as:
   - Constants & utilities (`BT`, `bv`, `cpk`, `fmt`, `uid`, `today`)
   - Worker API helpers (`_wToken`, `_wFetch`, `sbGet`, `sbUpsert`, `sbDelete`)
   - Field mappers (`entryToRow`, `rowToEntry`)
   - Global state (`S`, `AUTH`, `PR`)
   - Data loading (`loadAll`)
   - Auth (`authInit`, `sha256`, `pinCheck`, `showApp`, `logout`, `isAdmin`, `isHR`)
   - Render functions (`render`, `renderSidebar`, `renderContent`, `renderShopContent`, `renderGroupContent`)
   - Overview page (`showOverview`, `backToMain`, `renderOverview`, `renderOvTabs`, `toggleOvVisible`, `setOvYear`, `setOvMonth`)
   - Feature logic (count, income, expense, exchange, payowner)
   - Modal helpers (`OM`, `CM`, `CMask`, `toast`)
   - Payroll system (`showPayroll`, `loadPayroll`, `renderPayroll`, `renderPrPeriods`, `renderPrEmployees`, ...)

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

AUTH = { role: 'user' | 'admin' | 'viewer' | 'hr' }  // persisted in localStorage: 'ladda_role'
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
  vehicle     jsonb,               -- LEGACY (1 สาย=1คัน) ย้ายไป table `vehicles` แล้ว; เก็บไว้สำหรับ migrate
  created_at  timestamp DEFAULT now()
)

vehicles (                          -- ประวัติรถ: 1 แถว = 1 คัน, ผูกกับ route/group/office (รองรับหลายคันต่อเจ้าของ)
  id          text PRIMARY KEY,
  owner_type  text NOT NULL DEFAULT 'route',  -- 'route' | 'office' (UI ผูกรถกับสายย่อยเสมอ, ไม่กองรวมที่กลุ่ม)
  owner_id    text,                           -- route_id / null สำหรับ office
  name        text,                           -- ป้ายชื่อรถ (เช่น "รถบูรชัย 1")
  plate       text,
  chassis     text,
  insurance   text,
  ins_tel     text,
  ins_expiry  date,
  tax_expiry  date,
  prb_expiry  date,
  oil_date    date,
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

> **New tables**: ต้อง GRANT + disable RLS ทุกครั้ง เพราะ Supabase SQL editor ไม่ auto-grant anon role
> ```sql
> grant all on table <table> to anon, authenticated, service_role;
> alter table <table> disable row level security;
> ```

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
        │         ├─ viewer     → overview screen (#overview-screen)
        │         └─ hr         → payroll screen (#payroll-screen) tab พนักงาน, ไม่มี FAB, ไม่มี tab งวดจ่าย
        └─ ไม่ → แสดงหน้า password input
                   └─ กรอก PIN → sha256(PIN) → POST /auth (Worker)
                         ├─ admin  → token + role → main app
                         ├─ user   → token + role → main app
                         ├─ viewer → token + role → overview screen (read-only)
                         ├─ hr     → token + role → payroll employee tab (read-only salary)
                         └─ ผิด   → error, ล้าง input
```

- PIN จริงและ hash ไม่มีใน source code เลย — อยู่แค่ใน Cloudflare Worker env vars
- `isAdmin()` guards all delete/manage actions
- `isHR()` guards salary fields and payroll-only features
- Logout: ลบ `ladda_role` + `ladda_token` → แสดงหน้า login

## Roles

| Role | PIN | สิทธิ์ |
|---|---|---|
| `admin` | (Worker secret `HASH_ADMIN`) | ทุกอย่าง รวมถึงลบ จัดการสาย/กลุ่ม ตั้งค่า overview |
| `user` | (Worker secret `HASH_USER`) | ดู + เพิ่มข้อมูล, ลบไม่ได้, จัดการสายไม่ได้ |
| `viewer` | (Worker secret `HASH_VIEWER`) | เข้าได้เฉพาะหน้าภาพรวม (overview), ดูอย่างเดียว |
| `hr` | (Worker secret `HASH_HR`) | เข้าได้เฉพาะหน้าพนักงาน — เพิ่ม/แก้ชื่อ/สาย/สัญชาติ/รูป; ไม่เห็นค่าแรง/payment_type/loan/งวดจ่าย |

### HR Role — รายละเอียด

HR เข้าได้เฉพาะ payroll screen tab พนักงาน เท่านั้น:
- **ทำได้**: เพิ่มพนักงานใหม่, แก้ชื่อ/สาย/สัญชาติ/หมายเหตุ/เบอร์โทร/วันหมดอายุบัตร, อัปโหลดรูป, ดูและแก้ประวัติรถ (ผ่าน openAllVehicles), ดูประวัติพนักงานทั้งหมด (openAllEmployees)
- **ทำไม่ได้**: เห็นค่าแรง, ค่าโทร, ค่าห้อง, แผนก, ตำแหน่ง, payment_type, วันที่เริ่มงาน (ในหน้าประวัติ), loan, สถานะออกจากงาน, tab งวดจ่าย
- `backFromPayroll()` สำหรับ HR จะ `logout()` แทนกลับ main app
- `loadPayroll()` ฝั่ง HR โหลด: employees + routes + groups + group_members (เพื่อจัดกลุ่มสาย)
- `saveEmployee()` ฝั่ง HR: บันทึกเฉพาะ name/route_id/nationality/notes; daily_rate คงเดิม (default 360 ถ้าใหม่)

### employees_salary table (data isolation)

ข้อมูลเงินเดือนแยกออกมาจาก employees เพื่อความปลอดภัย — Worker บล็อก HR ระดับ API:

```sql
employees_salary (
  employee_id  text PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  daily_rate   numeric DEFAULT 360,
  phone_fee    numeric DEFAULT 0,
  room_fee     numeric DEFAULT 0,
  department   text,
  position     text,
  payment_type text DEFAULT 'เงินสดW'
)
```

- Worker: `HR_BLOCKED_TABLES = ['employees_salary', 'payroll_periods', 'payroll_entries', 'payroll_deductions', 'employee_loans']` → 403 ถ้า role=hr
- admin: `loadPayroll()` โหลดทั้ง employees + employees_salary แล้ว merge salary fields เข้า emp objects
- admin: `saveEmployee()` upsert employees ก่อน แล้ว upsert employees_salary แยก
- **แม้ HR เอา token ไปโยนใส่ Claude ก็ได้ 403** เพราะบล็อกที่ Worker ไม่ใช่ที่ UI

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
- **Sidebar gear (`_sbGear`)**: admin-only; `_sbGearToggle(id, e)` toggles gear for a group; when active shows ✏️🗑 buttons + draggable member chips; `_sbGear=null` after any reorder
- **Sidebar drag-to-reorder members**: `_sbDragStart/End` — saves new sort_order via `sbUpsert('group_members', members.map((r,i)=>({group_id,route_id:r,sort_order:i})))`; only works when `_sbGear` is active for that group
- **Payroll gear per group (`_prEditGrp`)**: `_prGearToggle(key)` where key = group id or `'standalone'`; toggles `_prEditGrp`; when active: ↑↓ buttons visible in route chips + drag-to-reassign enabled; renders via `renderPayroll()`
- **`_routeRow(rt, editMode)`**: renders a route chip in payroll employee tab; `editMode=true` shows ↑↓ in left column + attaches touch/mouse drag handlers; `editMode=false` shows plain chip, no drag
- **Duplicate style attribute bug**: `dragAttrs` must NOT contain a `style="..."` — the outer div's single `style` attribute must carry all styling (background, border, cursor etc.); two style attributes = browser ignores second
- **`sbUpsert` requires full object**: sending a partial object (e.g., `{id, photo_url}` only) causes NOT NULL constraint on `name`. Always spread the full record: `{...emp, ...patch}`

## Function Reference

| Function | หน้าที่ |
|---|---|
| `authInit()` | ตรวจ localStorage → showApp() หรือแสดงหน้า login |
| `sha256(str)` | async — SHA-256 via Web Crypto API |
| `pinCheck()` | async — hash → POST Worker /auth → token + role → showApp() |
| `showApp()` | ซ่อน login; viewer→overview, hr→payroll employee tab, admin/user→app |
| `logout()` | ลบ localStorage token+role, ซ่อน overview+app+payroll, แสดง login |
| `isAdmin()` | คืน true ถ้า role === 'admin' |
| `isHR()` | คืน true ถ้า role === 'hr' |
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
| `_sbGearToggle(id,e)` | toggle sidebar gear สำหรับกลุ่ม (admin only) |
| `_sbDragStart/_sbDragEnd` | drag-to-reorder สมาชิกในกลุ่ม (sidebar, admin+gear active) |
| `openAllVehicles()` | modal รถ**ทั้งหมด** (ปุ่ม 🚐 ด้านบน); กลุ่มเป็น header 📁 แตก section รายสายย่อย → สายเดี่ยว → ออฟฟิศ; กล่องสายอยู่ซ้าย (แบบหน้าพนักงาน), รถเรียงขวาเป็นแถว compact (1 แถว/คัน); set `_vehCtx=null` |
| `openRouteVehicles(routeId)` | modal รถ**เฉพาะสายเดียว** (ปุ่ม 🚐 ที่สายย่อย + ปุ่ม ✏️ ในหน้าสาย); ใช้การ์ดเต็ม `_vehCardFull` (label + 2 คอลัมน์); set `_vehCtx=routeId` |
| `_vehSection(o)` | render 1 section ต่อเจ้าของใน openAllVehicles; กล่องสายซ้าย + การ์ด compact `_vehCard` ขวา |
| `_vehCardFull(v)` / `_vehCard(v)` | การ์ดเต็ม (รายสาย) / การ์ด compact 1 แถว (ทั้งหมด) |
| `_vehCtx` / `_vehRerender()` | `null`=ดูทั้งหมด, routeId=ดูรายสาย; `_vehAdd`/`_vehDel` เรียก `_vehRerender()` เพื่อ re-render โมดัลที่เปิดอยู่ให้ถูกตัว |
| `_vehFor(type,id)` | คืน vehicles ของเจ้าของนั้น (office: owner_type==='office') |
| `_vehCard(v)` | render การ์ดรถ 1 คัน (name + grid fields + 🗑/🛢️) |
| `_vehField(id,field,val)` | save field onchange → upsert vehicles แถวเต็ม; toUpperCase plate/chassis |
| `_vehAdd(ownerType,ownerId)` | สร้างรถใหม่ในเจ้าของนั้น → re-render openAllVehicles |
| `_vehDel(id)` | confirm + ลบรถ → re-render |
| `_vehOilToday(id)` | เซ็ต oil_date = today(), update DOM input, call `_vehField` |
| `_migrateVehicles()` | admin: copy routes.vehicle เดิม → vehicles (owner_type='route'); idempotent ข้ามสายที่มีแล้ว |
| `openAllEmployees()` | table modal ประวัติพนักงานทุกคน; rowspan grouped by route/group order; HR access (ซ่อน daily_rate/payment_type/start_date); Thai = ซ่อน permit_expiry |
| `_prGearToggle(key)` | toggle `_prEditGrp` (group id หรือ 'standalone'); เปิด/ปิด edit mode ใน renderPrEmployees |
| `_routeRow(rt,editMode)` | render route chip ใน tab พนักงาน; editMode=true → ↑↓ + drag handlers |
| `_prEyeMenu(e)` | เปิด/ปิด `#pr-eye-popup` context menu ใต้ปุ่ม 👁️; วาง position จาก getBoundingClientRect |
| `_prEyeClose()` | ซ่อน `#pr-eye-popup` |

## Security

| Layer | สถานะ | รายละเอียด |
|---|---|---|
| PIN hashing | ✅ Done | hash อยู่ใน Worker env เท่านั้น ไม่มีใน source |
| Cloudflare Worker proxy | ✅ Done | ไม่มี Supabase key ใน source; JWT token 30 วัน |
| Salary data isolation | ✅ Done | employees_salary แยก table; Worker 403 ถ้า hr เข้า |
| Supabase RLS | 🔲 TODO | ยังใช้ anon key (ผ่าน Worker); RLS จริงต้องการ auth token |

### Worker (`worker.js`)
- URL: `https://ladda-api.hades-six.workers.dev`
- `POST /auth` → ตรวจ hash → ออก JWT (role: admin/user/viewer/hr)
- `GET|POST|DELETE /api/:table` → validate JWT → proxy ไป Supabase
- Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `HASH_USER`, `HASH_ADMIN`, `HASH_VIEWER`, `HASH_HR`, `JWT_SECRET`
- 401 จาก Worker → `logout()` อัตโนมัติ
- `HR_BLOCKED_TABLES`: `employees_salary`, `payroll_periods`, `payroll_entries`, `payroll_deductions`, `employee_loans` → return 403 ถ้า role=hr

## Payroll System (`PR` state)

admin + hr เข้าได้ (hr เห็นแค่ tab พนักงาน ไม่เห็นค่าแรง)

### การเข้าถึง
- ปุ่ม **💼 เงินเดือน** ใน header (แสดงเฉพาะ admin)
- HR: เข้าโดยตรงหลัง login ไม่มีปุ่ม "🪙 นับเงิน" กลับ — กด logout แทน
- `showPayroll()` → ซ่อน `#app` + แสดง `#payroll-screen`
- `backFromPayroll()` → admin: กลับ main app; hr: logout()

### Global State
```js
PR = {
  tab: 'periods' | 'employees',
  month: "YYYY-MM",   // BE year, calendar month เช่น "2568-06"
  employees: [],
  loans: [],          // employee_loans (admin only)
  periods: [],        // payroll_periods (admin only)
  entries: [],        // payroll_entries (admin only)
  deductions: [],     // payroll_deductions (admin only)
  _loaded: false
}
```

### Payroll Tables (Supabase)
```sql
employees (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  route_id     text,
  nationality  text,
  status       text DEFAULT 'active',
  photo_url    text,
  permit_photos jsonb,   -- array of up to 4 URLs (work permit, non-Thai only)
  license_photo text,    -- driver's license URL
  notes        text,
  tel          text,     -- เบอร์โทรศัพท์ (admin + HR กรอก/ดูได้)
  start_date   date,     -- วันที่เริ่มงาน
  permit_expiry date,    -- วันหมดอายุบัตรใบอนุญาตทำงาน (ซ่อนถ้า nationality='ไทย')
  visa_expiry  date,     -- อายุวีซ่า (ซ่อนถ้า nationality='ไทย' ในตารางประวัติ)
  passport_expiry date   -- อายุพาสปอร์ต (ซ่อนถ้า nationality='ไทย' ในตารางประวัติ)
)

employees_salary (
  employee_id  text PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  daily_rate   numeric DEFAULT 360,
  phone_fee    numeric DEFAULT 0,
  room_fee     numeric DEFAULT 0,
  department   text,
  position     text,
  payment_type text DEFAULT 'เงินสดW'
)

employee_loans    -- บัตร(ใบอนุญาต)/ยืม ที่ผ่อนอยู่
payroll_periods   -- งวด 10 วัน (3 งวด/เดือน)
payroll_entries   -- สลิปต่อคนต่องวด
payroll_deductions -- รายการหักแต่ละรายการในสลิป
```

### Cloudinary (รูปพนักงาน)
- Cloud name: `dai58zx93`, upload preset: `ladda_employees` (unsigned), folder: `ladda/employees`
- `_uploadToCloudinary(file, publicId)` → returns `secure_url`
- `_empPhotoUpsert(empId, patch)` → spreads full `emp` object before upsert (avoids NOT NULL on name)
- `uploadEmpPhoto(empId, input)` → profile photo → `employees.photo_url`
- `uploadPermitPhoto(empId, input)` → appends to `employees.permit_photos[]` (max 4)
- `uploadLicensePhoto(empId, input)` → `employees.license_photo`
- `delPermitPhoto(empId, idx)` / `delLicensePhoto(empId)` → remove photo + update DB

### Period Keys
- รูปแบบ: `"YYYY-MM-A"` (BE year, calendar month)
- A = 1–10 จ่าย 11, B = 11–20 จ่าย 21, C = 21–31 จ่าย 1 ของเดือนถัดไป

### Year/Month Picker (งวดจ่าย)
- Grid ปี: แสดงเฉพาะปีที่ ≤ ปีปัจจุบัน (BE); derive จาก `PR.periods` + ปีปัจจุบัน
- Grid เดือน: แถวเดียว; แสดงเฉพาะเดือนที่มีงวดใน `PR.periods` สำหรับปีนั้น + เดือนปัจจุบัน (ถ้าปีนั้น = ปีนี้); เดือนที่ยังไม่ถึงหรือก่อนเริ่มใช้แอปไม่แสดง

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
| `loadPayroll()` | admin: โหลด employees+salary+loans+periods+entries+deds; hr: โหลด employees+routes+groups+group_members |
| `renderPayroll()` | inject HTML เข้า `#pr-body` (ต้องเรียก ไม่ใช่ `renderPrEmployees()`) |
| `setPrTab(tab)` | เปลี่ยน tab periods/employees |
| `generatePeriod(beYM,slot)` | สร้างงวด + entries + deductions; guard `PR._loaded`; ถ้ามี stale period (ไม่มี entries) จะลบแล้วสร้างใหม่ |
| `openPeriod(periodId)` | modal สลิปทุกคน; ชื่อสายอยู่ด้านซ้าย (sidebar style); เรียงลำดับตาม group order เหมือนหน้าพนักงาน; แยก col หัก: ห้องพัก / ค่าบัตร / อื่นๆ |
| `prUpdateEntry(id,field,val)` | แก้ days/bonus/advance แล้ว save; อัปเดต cell สุทธิใน DOM ทันที (id="pr-net-${entryId}") |
| `openPrEntryDetail(id,periodId)` | modal แก้ละเอียดต่อคน |
| `openAddDed(entryId,periodId)` | เพิ่มรายการหัก; manual deduction มีช่อง "ยอดรวม" + "หักวีคละ"; ถ้าหักวีคละ < ยอดรวม → สร้าง employee_loans อัตโนมัติ (งวดถัดไปหักต่อเองจนครบ) |
| `saveAddDed(entryId,periodId)` | บันทึก manual deduction; ถ้ามี per_period → สร้าง loan type='other' ก่อน แล้วผูก deduction กับ loan นั้น |
| `markPeriodPaid(periodId)` | จ่ายแล้ว + update loans |
| `renderPrEmployees()` | **returns HTML string** — tab พนักงาน; drag-to-reassign chips; grouped by route/dept; กรองตาม `_prSettings`; salary chip ซ่อนถ้า isHR() |
| `quickAssignRoute(empId,routeId)` | กำหนด route_id ให้พนักงาน (inline, ไม่ต้องเปิด modal) |
| `prMoveRoute(routeId,dir)` | สลับ sort_order ของ route ขึ้น/ลง → upsert routes |
| `openAddEmployee()` | admin: form เต็ม; hr: form แค่ ชื่อ/สาย/สัญชาติ/หมายเหตุ |
| `openEditEmployee(empId)` | admin: form เต็ม; hr: form แค่ ชื่อ/สาย/สัญชาติ/หมายเหตุ |
| `saveEmployee(editId)` | admin: upsert employees + employees_salary; hr: upsert employees เท่านั้น (คง daily_rate เดิม) |
| `openEmpDetail(empId)` | admin: โปรไฟล์เต็ม + loan + status buttons; hr: เห็นแค่ สาย/สัญชาติ/สถานะ + รูป |
| `setEmpStatus(empId,status)` | active/resigned/blacklisted (admin only) |
| `openAddLoan(empId)` | เพิ่ม loan/บัตร (admin only) |
| `saveLoan(empId)` | บันทึก loan |
| `sharePeriod(periodId)` | เปิด modal 3 ปุ่ม: ส่งให้เฮียรวย / ส่งให้บูรชัย / ส่งให้น้องลัดดา |
| `shareEmployeeList()` | แชร์รายชื่อพนักงาน |

### sharePeriod — 3-group split

ใช้ `window._sp1/sp2/sp3` + `window._doShare(key)` pattern (หลีกเลี่ยง Thai encoding ใน onclick):

- **ส่งให้เฮียรวย** (`_sp1`): เงินสดW ทุกสายยกเว้นบูรชัย; F1 แยก subtotal; subtotal เฮียรวย + subtotal F1 แยกกัน
- **ส่งให้บูรชัย** (`_sp2`): พนักงานในกลุ่ม "บูรชัย" ที่ payment_type = เงินสดW หรือ โอนจ่ายM; **ไม่มี F1 เลย**; แสดง `[โอนจ่ายM]` ต่อท้าย
- **ส่งให้น้องลัดดา** (`_sp3`): ยอดรวมทุกสายยกเว้น F1 (ใช้ชื่อเฮียรวย) + ยอดรวม F1 + ยอดรวมบูรชัย
- F1 route หา via `S.shops.find(s=>s.name==='F1')`
- บูรชัย group หา via `S.groups.find(g=>g.name.includes('บูรชัย'))`

### Drag-to-Reassign Employee (หน้าพนักงาน)
- Touch: `ontouchstart="_empTouchStart(event,empId)"` → ghost สร้างหลัง 10px movement → `touchend` ใช้ `_dragZone` ที่ save ระหว่าง `touchmove` (ไม่ใช่ `elementFromPoint` ใน touchend)
- Mouse: `onmousedown="_empMouseStart(event,empId)"` → `mousemove/mouseup` บน `document`
- Ghost offset: คำนวณจาก grab point ภายใน chip (`_dragOffX/Y`) ไม่ใช่จากมุมบนซ้าย
- Drop zone: `data-drop-route="${rt.id}"` (empty string = ไม่มีสาย)
- `_empDrop(empId,zone)` → `quickAssignRoute` → **`renderPayroll()`** (ไม่ใช่ `renderPrEmployees()`)

### Payroll gotchas
- **uid collision**: `uid()` ใช้ `crypto.randomUUID()` — อย่าเปลี่ยนกลับเป็น Date.now+random; การสร้าง 42 entries พร้อมกันใน `.map()` จะ collision แน่นอนถ้าใช้ timestamp-based id
- **insert order**: ต้อง upsert `payroll_entries` ก่อน `payroll_deductions` เสมอ (FK: deductions.entry_id → entries.id)
- **generatePeriod guard**: เช็ค `PR._loaded` ก่อนทำงาน; ถ้า render หน้า payroll ก่อน loadPayroll เสร็จ PR.employees จะว่างเปล่า
- **_openPeriodId**: เก็บ periodId ที่ modal เปิดอยู่; tray toggle ใช้ re-open modal หลังเปลี่ยน settings; ต้อง check `PR.tab==='periods'` ก่อน ไม่งั้นจะเด้งไปงวดจ่ายตอนอยู่ tab พนักงาน
- **_prSettings** (localStorage `pr_settings`): `{ hideRates, hideManager, hideTopManager }` — hideManager/hideTopManager กรองพนักงานตาม `emp.position` ทั้งหน้าพนักงานและ openPeriod modal
- **renderPayroll() vs renderPrEmployees()**: `renderPrEmployees()` คืน HTML string เท่านั้น; ต้องเรียก `renderPayroll()` เพื่อ inject เข้า DOM จริง
- **HR loadPayroll**: โหลด employees + routes + groups + group_members เพื่อให้การเรียงสายตรงกับ admin view
- **openPeriod table columns**: ใช้ `width:auto` + `<colgroup>` กำหนด width คอลัมน์ตัวเลข; ชื่อพนักงานอยู่ซ้าย ตัวเลขชิดตาม; ช่อง "อื่นๆ" แสดงยอดรวมตัวเดียว + `title` tooltip รายละเอียด
- **openPeriod sticky column header**: header แถวเดียว `position:sticky;top:0` อยู่เหนือ route cards ทั้งหมด; ไม่มี thead ซ้ำใน แต่ละการ์ด
- **โอนจ่ายM/รายเดือน filter**: `_monthlyTypes=['โอนจ่ายM','รายเดือน']` — พนักงานกลุ่มนี้ไม่แสดงและไม่สร้าง entries ในงวด A (1-10) และ B (11-20); แสดงเฉพาะงวด C (21-31); การ์ดงวดก็กรองออกเช่นกัน
- **openPeriod header split totals**: `id="pr-hdr-grand/main/f1/bur"` — ยอดรวม/เฮียรวย/F1/บูรชัย; อัปเดต real-time พร้อมกับ net pay ใน `prUpdateEntry()`
- **Period card split totals**: การ์ดงวดแสดง เฮียรวย/F1/บูรชัย เหมือนกับหัวหน้างวด; คำนวณสดจาก daily_rate×วัน+โบนัส−หัก−เบิก (ไม่ใช้ net_pay จาก DB)
- **_allEmpField**: บันทึก salary fields (daily_rate/phone_fee/room_fee/payment_type) ไปที่ `employees_salary`; ฟิลด์อื่น (nationality/start_date/tel ฯลฯ) บันทึกไปที่ `employees` โดย strip salary fields ออกก่อน
- **vehicles table**: ประวัติรถย้ายจาก `routes.vehicle` jsonb (1 สาย=1คัน) → table `vehicles` แยก (1 แถว=1คัน, หลายคันต่อสายได้); `owner_type` = `route`/`office`; **รถในกลุ่มผูกกับสายย่อยเสมอ** (กลุ่มเป็นแค่ header กำกับ ไม่กองรวมที่ระดับกลุ่ม — งั้นจะดูไม่ออกว่าคันไหนของสายไหน); office = รถไม่ผูกสาย; โหลดเข้า `S.vehicles[]` ทั้งใน `loadAll()` และ `loadPayroll()` (admin+hr); `.catch(()=>[])` กันแอปพังถ้ายังไม่สร้าง table; **`routes.vehicle` เดิมยังอยู่** สำหรับ migrate ผ่านปุ่ม 📥 `_migrateVehicles()`
- **openAllEmployees rowspan layout**: pre-group employees ตาม orderedRoutes (group order เหมือน sidebar); แต่ละ route = `<td rowspan="N">` ครั้งแรก; HR ไม่เห็น daily_rate/payment_type/start_date; สัญชาติไทย = ซ่อน permit_expiry
- **_prEditGrp global**: `null` หรือ group id หรือ `'standalone'`; กดปุ่มเฟืองใน group header ของ tab พนักงาน → toggle; เมื่อ active: chip เป็น grab cursor + ↑↓ ปรากฏในคอลัมน์ซ้ายของ `_routeRow`; FAB fixed top:80px right:24px ไม่ทับปุ่มเพราะ ↑↓ อยู่ซ้ายแล้ว
- **employees_salary actual columns**: `employee_id, daily_rate, phone_fee, room_fee, payment_type` เท่านั้น — **ไม่มี** `department` และ `position` (อยู่ใน `employees` table)
- **loadPayroll merge**: merge `department` และ `position` จาก employees_salary เข้า emp ด้วย (ปัจจุบัน column ไม่มีจริง — ดึงจาก employees แทน)
- **CMask payroll exception**: ใน payroll screen ปิด modal ทันทีไม่มี confirm popup; หน้าอื่นยังมีตามเดิม

### Employee fields
| field | table | type | หมายเหตุ |
|---|---|---|---|
| `name` | employees | text | ชื่อพนักงาน |
| `route_id` | employees | text | สายที่สังกัด (null = ยังไม่มีสาย) |
| `nationality` | employees | text | สัญชาติ |
| `status` | employees | text | active/resigned/blacklisted |
| `photo_url` | employees | text | Cloudinary URL รูปโปรไฟล์ |
| `permit_photos` | employees | jsonb | array URL ใบอนุญาตทำงาน (max 4, non-Thai only) |
| `license_photo` | employees | text | Cloudinary URL ใบขับขี่ |
| `notes` | employees | text | หมายเหตุ |
| `tel` | employees | text | เบอร์โทรศัพท์ (admin + HR กรอก/ดูได้; แสดงเป็น `<a href="tel:...">`) |
| `start_date` | employees | date | วันที่เริ่มงาน (HR กรอกได้ตอนเพิ่มใหม่เท่านั้น ดูในโปรไฟล์ไม่ได้; ซ่อนใน openAllEmployees ถ้า HR) |
| `permit_expiry` | employees | date | วันหมดอายุบัตร (admin + HR กรอก/ดูได้; ซ่อนถ้า nationality='ไทย') |
| `visa_expiry` | employees | date | อายุวีซ่า (date input; ตารางประวัติซ่อนถ้า nationality='ไทย') |
| `passport_expiry` | employees | date | อายุพาสปอร์ต (date input; ตารางประวัติซ่อนถ้า nationality='ไทย') |
| `daily_rate` | employees_salary | numeric | ค่าแรงต่อวัน (default 360) |
| `phone_fee` | employees_salary | numeric | ค่าโทรต่องวด |
| `room_fee` | employees_salary | numeric | ค่าห้องต่องวด |
| `department` | employees_salary | text | แผนก (ออฟฟิศ/บัญชี/คลังสินค้า/ขนส่ง/อื่นๆ) |
| `position` | employees_salary | text | ตำแหน่งงาน (คนขับรถ/เด็กติดรถ/ออฟฟิศทั่วไป/ผู้จัดการ/ผู้จัดการใหญ่) |
| `payment_type` | employees_salary | text | เงินสดW / โอนจ่ายW / โอนจ่ายM / รายเดือน (default: เงินสดW) |

> หลัง `loadPayroll()` (admin) salary fields ถูก merge เข้า emp objects แล้ว ใช้ได้เป็น `emp.daily_rate` ปกติ

### Payroll Eye-Menu (แทน FAB)
- ปุ่ม 👁️ อยู่ใน header row ของ tab พนักงาน (admin only; ถัด + เพิ่มพนักงาน)
- กดแล้วขึ้น `#pr-eye-popup` — context menu เล็กๆ (position:fixed, วางใต้ปุ่ม) มี 2 ตัวเลือก:
  - 📤 ส่งต่อ → `_prShareCurrent()`
  - ⚙️ ตั้งค่า → `togglePrTray()`
- คลิกนอก popup → ปิดเองด้วย `document.addEventListener('click', _prEyeClose, {once:true})`
- `_prEyeMenu(e)`: คำนวณ position จาก `getBoundingClientRect()` แล้วแสดง popup
- `_prEyeClose()`: ซ่อน popup
- **ไม่มี** `#pr-fab-group` อีกต่อไป — ลบออกแล้ว; `showPayroll/backFromPayroll` ไม่ต้อง toggle FAB

### งานที่ยังต้องทำ (Payroll)
- [x] นำเข้าข้อมูลพนักงาน 42 คน + 21 permit loans
- [x] รูปพนักงาน + ใบอนุญาตทำงาน + ใบขับขี่ (Cloudinary)
- [x] Drag-to-reassign พนักงานระหว่างสาย (touch + mouse)
- [x] payment_type field + แสดงในโปรไฟล์ + แยกใน sharePeriod
- [x] HR role — แยก employees_salary table, Worker block, UI strip salary fields
- [x] sharePeriod แยก 3 ปุ่ม (เฮียรวย / บูรชัย / น้องลัดดา)
- [x] ประวัติพนักงาน bulk-edit modal (openAllEmployees)
- [ ] กำหนดสายให้พนักงานทุกคน (admin ทำเอง)
- [ ] กำหนดตำแหน่งงาน + payment_type ให้พนักงาน (admin ทำเอง)
- [ ] อัปเดตยอดค้างบัตรใบอนุญาต + วันหมดอายุ (admin ทำเอง)
- [ ] ดอกเบี้ยเงินยืม (5–10%)
- [ ] เชื่อมระบบเช็คเวลาเข้างาน (feature #2)

## Roadmap

### ✅ เสร็จแล้ว
- [x] SHA-256 PIN hashing + Cloudflare Worker proxy
- [x] Viewer role + Overview page
- [x] Modal fullscreen + confirm-before-close (CMask)
- [x] shopTot / groupTot แยกรายเดือน (ไม่สะสมข้ามเดือน)
- [x] Exchange dropdown: กลุ่ม + standalone เท่านั้น (ไม่มี route ในกลุ่ม)
- [x] calcCBGroup รวมทุก route ในกลุ่ม + firstRouteWithMoney
- [x] Count บันทึกตรง (saveCountDirect) ไม่มี session step
- [x] Exchange pair แสดงเป็น row เดียว (renderExchangePair)
- [x] Payroll system — employees, loans, periods, auto-calculation
- [x] openPeriod redesign — grouped by route card, split deduction columns, daily_rate display
- [x] Employee quick-assign route mode (drag-to-reassign, touch+mouse)
- [x] Route reorder (↑↓) via `prMoveRoute()`
- [x] Payroll settings tray (gear FAB) — hideRates, hideManager, hideTopManager
- [x] Share button (📤 FAB) — 3-group period split (เฮียรวย/บูรชัย/น้องลัดดา) or employee list
- [x] Employee position field + start_date field
- [x] Employee photo upload via Cloudinary (profile + permit ×4 + license)
- [x] payment_type field (เงินสดW/โอนจ่ายW/โอนจ่ายM/รายเดือน)
- [x] Sidebar gear (⚙️) — admin toggle ✏️🗑 + drag-to-reorder members
- [x] Payroll year/month grid picker (เฉพาะปี/เดือนที่ผ่านมาและมีข้อมูล)
- [x] HR role — employees_salary isolation, Worker 403, UI strip salary/loan/period
- [x] ประวัติพนักงาน bulk-edit modal
- [x] permit_expiry field (วันหมดอายุบัตร) — ทั้ง admin และ HR กรอก/ดูได้
- [x] openPeriod route sidebar layout + เรียงตาม group order
- [x] manual deduction with per_period — auto-creates loan หักต่อเนื่องงวดถัดไป
- [x] prUpdateEntry อัปเดต net pay ใน DOM ทันที (ไม่ต้อง F5)
- [x] openPeriod header split totals (เฮียรวย/F1/บูรชัย) อัปเดต real-time
- [x] โอนจ่ายM/รายเดือน ซ่อนในงวด A+B แสดงเฉพาะงวด C (การ์ดงวดก็กรองด้วย)
- [x] openPeriod sticky column header แถวเดียว ไม่ซ้ำในแต่ละการ์ด
- [x] Period card แสดง split totals เฮียรวย/F1/บูรชัย + คำนวณสดไม่ใช้ net_pay จาก DB
- [x] _allEmpField บันทึกถูกตาราง (salary → employees_salary, อื่น → employees)
- [x] CMask ในหน้า payroll ไม่มี confirm popup
- [x] tel field บน employees (admin + HR กรอก/ดูได้, แสดงเป็น tel: link)
- [x] vehicle jsonb บน routes (plate/chassis/insurance/ins_tel/ins_expiry/tax_expiry/prb_expiry/oil_date)
- [x] openAllVehicles modal — table ทุกสาย, inline edit, ปุ่ม 🛢️ oil-today
- [x] openAllEmployees — rowspan grouped by route, HR access, tel+permit_expiry cols, ซ่อน salary cols ถ้า HR, Thai = ซ่อน permit_expiry
- [x] employees.visa_expiry + passport_expiry (date) — ตารางประวัติ + รายคน + ฟอร์มเพิ่ม/แก้ไข; Thai = ซ่อนในตาราง (ต้อง `alter table employees add column`)
- [x] vehicle tax_expiry + prb_expiry (date) — openVehicle form + openAllVehicles table (jsonb ไม่ต้องแก้ schema)
- [x] _prEditGrp + _prGearToggle — gear per group ใน tab พนักงาน → unlock drag + ↑↓
- [x] _routeRow(editMode) — ↑↓ อยู่ซ้าย, drag handlers ติดเฉพาะ editMode=true
- [x] แทน FAB 2 ปุ่ม (📤⚙️) ด้วยปุ่ม 👁️ + context menu popup ใน header tab พนักงาน
- [x] vehicles table แยก (1 แถว=1คัน, owner route/group/office) — openAllVehicles แบ่ง section ตามเจ้าของ + เพิ่ม/ลบหลายคัน; ปุ่ม 📥 migrate จาก routes.vehicle เดิม (รองรับ บูรชัย 4 + ออฟฟิศ 3) — ต้อง `create table vehicles` + grant + disable RLS

### 🔲 งานที่ admin ต้องทำเองในแอป (ไม่ใช่งานโค้ด)
- [ ] กำหนดสาย + ตำแหน่ง + payment_type ให้พนักงานทุกคน
- [ ] อัปเดตยอดค้างบัตรใบอนุญาต + วันหมดอายุ

### 🔥 ต้องทำต่อ (เรียงตามความเร่งด่วน)

**1. Cross-system กระทบยอดกับระบบน้ำแข็ง** ← เร่งด่วนที่สุด
- ดึงข้อมูลจาก API ระบบน้ำแข็ง (รอ URL + spec จากทีมนั้น)
- แสดงยอดรายวันของทุกสาย เทียบกับยอดนับเงินรอบสุดท้ายใน น้องลัดดา
- ไฮไลต์ถ้ายอดสองฝั่งไม่ตรงกัน
- (TBD) ส่งสรุปกลับไปให้ระบบน้ำแข็ง

**2. ระบบเช็คเวลาเข้างาน (NFC)**
- พนักงานเอามือถือแตะสติ๊กเกอร์ NFC ที่ติดไว้จุดเข้างาน
- บันทึกเวลาเข้า-ออก ต่อคนต่อวัน
- เชื่อมกับ payroll (คำนวณ days_worked อัตโนมัติ)

**3. ดอกเบี้ยเงินยืม (5–10%)**
- ต่อยอดจากระบบ loan ที่มีอยู่แล้ว

### ⏳ ทำได้แต่ไม่เร่ง
- [ ] โปรไฟล์พนักงานเต็มรูปแบบ
- [ ] Export รายงาน (PDF / Excel)
- [ ] PWA — manifest + service worker (ติดตั้งลงมือถือได้)
- [ ] Supabase RLS per authenticated user
