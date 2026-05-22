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
   - Feature logic (count sessions, income, expense, exchange, payowner, auto-collect)
   - Modal helpers (`OM`, `CM`, `toast`)

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
| `exin` | รับแลกเงิน / รับจากจ่ายเฮียรวย / รับ auto-collect | +amount |
| `exout` | แลกเงินออก / จ่ายเฮียรวย / โอน auto-collect | -amount |

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

## Key Patterns

- **bills object**: `{ 1000: n, 500: n, 100: n, 50: n, 20: n, coin: n }` — `coin` = ฿1 each; use `bv(bills)` to compute total
- **month_key**: `"YYYY-MM"` — fiscal period starts on 11th of month; `cpk()` returns current period key
- **tab_flags**: `{ count, income, expense, exchange, payowner, auto_collect, viewer_visible }` — controls tabs + visibility; `curTabFlags()` returns flags for current view
- **`_cbMap` global**: stores bill-input callbacks by prefix to avoid JSON.stringify/double-quote conflicts in inline `oninput` attributes
- **`calcCB(sid, mk)`**: computes cumulative bills in cash box at a given month by replaying all entries
- **Exchange modal** (`openExchange(fromShop, lockedId)`):
  - Right dropdown: `r:${id}` prefix for routes, `g:${id}` for groups
  - Routes/groups with zero balance filtered out
  - Self-exchange validation: cannot exchange with self or own group
- **Pay-owner tab**: `tab_flags.payowner`; target group must have `is_owner=true`; saves exout+exin
- **Auto-collect** (`tab_flags.auto_collect` on group): after sub-shop summarizes, auto exout→exin to first route (collector); first route is exempt
- **Count session**: open → add subs → **แก้ไข sub ได้ก่อนสรุป** → สรุปรอบ → finalized entry; หลังสรุปแก้ไขไม่ได้
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
| `_ovCalc(ids)` | helper คำนวณยอดรวมจาก shop id หลายสาย |
| `groupTot(gid)` | ยอดรวมของกลุ่ม |
| `groupedRouteIds()` | Set ของ routeId ที่อยู่ในกลุ่ม |
| `cpk()` | คืน month key ปัจจุบัน |
| `bv(bills)` | คำนวณยอดจาก bills object |
| `shopTot(sid)` | ยอดสุทธิของสาย |
| `grandTot()` | ยอดรวมทุกสาย |
| `calcCB(sid,mk)` | แบงค์คงเหลือในกล่อง ณ เดือนนั้น |
| `calcCBGroup(gid,mk)` | แบงค์คงเหลือของ route แรกใน group |
| `ge/gs/ss/cs` | entries array / get/set/clear session |
| `sbGet/sbUpsert/sbDelete` | Worker API helpers (ต้องมี token) |
| `entryToRow/rowToEntry` | map JS ↔ Supabase fields |
| `openCount()` | เริ่มรอบนับเงิน หรือ addSubCount() |
| `addSubCount()` | เพิ่ม sub ครั้งใหม่ |
| `editSubCount(idx)` | แก้ไข sub ครั้งที่ idx (เฉพาะ session ที่ยังเปิด) |
| `saveEditSub(idx)` | บันทึกการแก้ไข sub |
| `summarize()` | สรุปรอบ → entry + auto-collect |
| `cancelSess()` | ยกเลิก session |
| `openExchange/saveExchange` | modal แลกเงิน |
| `refreshExchangeCB(fromShop)` | อัปเดต cap เมื่อเปลี่ยนปลายทาง |
| `openPayOwner/openPayOwnerGroup/savePayOwner` | จ่ายเฮียรวย |
| `billInp/billInpWithLimit/updB/updBLimit/gb` | bill input helpers |
| `addShop/saveShop/editShop/saveEditShop/deleteShop` | จัดการสาย (admin) |
| `addGroup/saveGroup/editGroup/saveEditGroup/deleteGroup` | จัดการกลุ่ม (admin) |
| `tfChips/getTf/toggleTf` | tab_flags chip UI |
| `toggleGrpCard(id)` | ขยาย/ยุบ card ใน group view |
| `OM/CM/toast` | modal open/close, notification |

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

## Roadmap

- [x] SHA-256 PIN hashing + Cloudflare Worker proxy
- [x] Viewer role + Overview page
- [ ] Supabase RLS per authenticated user
- [ ] PWA — manifest + service worker
- [ ] Export รายงาน (PDF / Excel)
- [ ] Cross-system integration กับระบบน้ำแข็ง
