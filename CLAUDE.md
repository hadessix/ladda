# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"น้องลัดดา" — a cash-counting and income/expense tracking app for multi-route businesses. Runs as a **single `index.html` file** with no build tools, no dependencies, and no package manager. Open directly in a browser or serve via Cloudflare Pages.

- Live URL: https://e34ef8d2.ladda-b0j.pages.dev/
- GitHub: https://github.com/hadessix/ladda
- Supabase: https://lsxnbdhyfsuqhopzuwls.supabase.co

## Deploy

```bash
# Deploy to Cloudflare Pages only
wrangler pages deploy . --project-name=ladda --commit-dirty=true

# Git push + deploy
git add index.html
git commit -m "message"
git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true
```

No local dev server needed — open `index.html` directly in a browser to test.

## Architecture

Everything lives in `index.html` in this order:
1. **`<style>`** — all CSS (CSS variables in `:root`, dark theme)
2. **`<body>`** — login screen (`#login`) + app shell (`#app`) with header, sidebar, tabs, content area
3. **`<script>`** — all JavaScript, structured as:
   - Constants & utilities (`BT`, `bv`, `cpk`, `fmt`, `uid`, `today`)
   - Supabase config + REST helpers (`sbGet`, `sbUpsert`, `sbDelete`)
   - Field mappers (`entryToRow`, `rowToEntry`)
   - Global state (`S`, `AUTH`)
   - Data loading (`loadAll`)
   - Auth (`authInit`, `pinPress`, `pinCheck`, `showApp`, `logout`, `isAdmin`)
   - Render functions (`render`, `renderSidebar`, `renderContent`, `renderShopContent`, `renderGroupContent`)
   - Feature logic (count sessions, income, expense, exchange, payowner)
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

AUTH = { role: 'user' | 'admin' }  // persisted in localStorage key: 'ladda_role'
```

## Supabase Schema

```sql
routes (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#22c55e',
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true,"payowner":false}',
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
  is_owner    boolean DEFAULT false,   -- true = เฮียรวย group
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true,"payowner":false}'
)

group_members (
  group_id    text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  route_id    text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  sort_order  int DEFAULT 0,
  PRIMARY KEY (group_id, route_id)
)
```

RLS is disabled; anon key has full CRUD on all tables.

### Entry types

| type | ความหมาย | ผลต่อยอด |
|---|---|---|
| `count` | รอบนับเงิน (has `subs[]`) | +total |
| `income` | รายรับพิเศษ | +amount |
| `expense` | รายจ่าย | -amount |
| `exin` | รับแลกเงินจากสายอื่น / รับจากจ่ายเฮียรวย | +amount |
| `exout` | แลกเงินออกไปสายอื่น / จ่ายเฮียรวย | -amount |

### JS ↔ Supabase field mapping

| JS | Supabase |
|---|---|
| `df` | `date_from` |
| `dt` | `date_to` |
| `oid` | `other_route_id` |

## Auth

```
เปิดแอป
  └─ มี ladda_role ใน localStorage?
        ├─ ใช่ → showApp() → loadAll() → render()
        └─ ไม่ → แสดงหน้า PIN pad
                   └─ กด PIN 4 หลัก → pinCheck()
                         ├─ 1111 → role=user  (ดู + เพิ่ม, ลบไม่ได้, จัดการสายไม่ได้)
                         ├─ 0000 → role=admin (ทุกอย่าง)
                         └─ ผิด  → แสดง error, ล้าง PIN
```

- `isAdmin()` guards all delete/manage actions
- Logout: กด badge role ที่ header → ลบ localStorage → แสดงหน้า login ใหม่

## Key Patterns

- **bills object**: `{ 1000: n, 500: n, 100: n, 50: n, 20: n, coin: n }` — `coin` = ฿1 each; use `bv(bills)` to compute total
- **month_key**: `"YYYY-MM"` — fiscal period starts on 11th of month; `cpk()` returns current period key
- **tab_flags**: `{ count, income, expense, exchange, payowner }` — controls which tabs show per route/group; `curTabFlags()` returns flags for current view
- **`_cbMap` global**: stores bill-input callbacks by prefix to avoid JSON.stringify/double-quote conflicts in inline `oninput` attributes
- **`calcCB(sid, mk)`**: computes cumulative bills in cash box at a given month by replaying all entries
- **Exchange modal** (`openExchange(fromShop, lockedId)`): when `fromShop=true`, left side locks to current route; right side lists only standalone routes + groups (routes already in any group are filtered out, own group filtered too)
- **Pay-owner tab**: enabled via `tab_flags.payowner`; target group must have `is_owner=true`; saves `exout` at payer + `exin` at first route of owner group; admin sets owner group via ✏️ แก้ไขกลุ่ม → "⭐ ตั้งกลุ่มนี้เป็นเฮียรวย"
- **Count session**: open session → add multiple subs (each with date range + bills) → กด "สรุปรอบ" → upsert entry + delete session from Supabase

## Function Reference

| Function | หน้าที่ |
|---|---|
| `authInit()` | ตรวจ localStorage → showApp() หรือแสดงหน้า login |
| `pinPress(d)` | กด digit บน numpad — ครบ 4 ตัวตรวจสอบอัตโนมัติ |
| `pinCheck()` | เทียบ PIN → set role + showApp() หรือ error |
| `showApp()` | ซ่อนหน้า login, อัปเดต badge, เรียก loadAll() |
| `logout()` | ลบ localStorage, แสดงหน้า login ใหม่ |
| `isAdmin()` | คืน true ถ้า role === 'admin' |
| `loadAll()` | โหลด routes/entries/sessions/groups/group_members จาก Supabase |
| `render()` | re-render ทุก component |
| `renderSidebar()` | sidebar: กลุ่ม (บนสุด) + สายไม่มีกลุ่ม (ล่าง) |
| `renderContent()` | router → renderShopContent() หรือ renderGroupContent() |
| `renderShopContent()` | หน้าสาย — กรอง tab ตาม tab_flags |
| `renderGroupContent()` | หน้าสรุปกลุ่ม — ยอดรวม + card แต่ละสาย |
| `setView(type,id)` | เปลี่ยน view ปัจจุบัน แล้ว render() |
| `curTabFlags()` | คืน tab_flags ของ view ปัจจุบัน |
| `groupTot(gid)` | ยอดรวมของกลุ่ม |
| `groupedRouteIds()` | Set ของ routeId ที่อยู่ในกลุ่มใดก็ได้ |
| `cpk()` | คืน month key ของงวดปัจจุบัน (เริ่มวันที่ 11) |
| `bv(bills)` | คำนวณยอดเงินรวมจาก bills object |
| `shopTot(sid)` | ยอดสุทธิของสาย (รวม open session) |
| `grandTot()` | ยอดรวมทุกสาย |
| `calcCB(sid,mk)` | คำนวณแบงค์คงเหลือในกล่อง ณ เดือนนั้น |
| `calcCBGroup(gid,mk)` | คำนวณแบงค์คงเหลือของ route แรกใน group |
| `ge(sid,mk)` | ดึง / สร้าง entries array |
| `gs/ss/cs` | get / set / clear open session |
| `sbGet/sbUpsert/sbDelete` | Supabase REST helpers |
| `entryToRow/rowToEntry` | map JS ↔ Supabase fields |
| `summarize()` | สรุปรอบนับเงิน → upsert entry + delete session |
| `openExchange(fromShop,lockedId)` | เปิด modal แลกเงิน |
| `refreshExchangeCB(fromShop)` | อัปเดต cap + label "มี X ใบ" เมื่อเปลี่ยนปลายทาง |
| `saveExchange(fromShop)` | บันทึกการแลก รองรับ route และ group เป็นปลายทาง |
| `openPayOwner(fromSid)` | เปิด modal จ่ายเฮียรวย (1 ฝั่ง) จาก shop view |
| `openPayOwnerGroup(gid)` | เปิด modal เลือกสายก่อนจ่ายเฮียรวย จาก group view |
| `savePayOwner(fromSid,ownerGid,ownerFirstId)` | บันทึก exout+exin สำหรับจ่ายเฮียรวย |
| `billInpWithLimit(p,cb)` | render grid input แบงค์พร้อม cap |
| `billInpExchange(p,cb)` | render input แบงค์สำหรับ modal แลกเงิน |
| `updBLimit(p)` | อัปเดตยอด real-time สำหรับ input ที่มี cap |
| `billInp(p)` | render grid input แบงค์ไม่มี cap |
| `updB(p)` | อัปเดตยอด real-time สำหรับ input ไม่มี cap |
| `addShop/saveShop` | เพิ่มสายใหม่ (admin only) |
| `editShop/saveEditShop(id)` | แก้ไขชื่อ + สี + tab_flags สาย (admin only) |
| `deleteShop(id)` | ลบสายและข้อมูลทั้งหมด + sync groupMembers |
| `addGroup/saveGroup` | เพิ่มกลุ่มใหม่ (admin only) |
| `editGroup/saveEditGroup(id)` | แก้ไขกลุ่ม + sync members |
| `deleteGroup(id)` | ลบกลุ่ม (สายไม่ถูกลบ) |
| `pickShopThen(...)` | modal เลือกสายก่อนเปิด action |
| `tfChips(flags,prefix)` | render toggle chip สำหรับ tab_flags |
| `getTf(prefix)` | อ่านค่า tab_flags จาก chip ใน DOM |
| `toggleGrpCard(id)` | ขยาย/ยุบ card สายในหน้าสรุปกลุ่ม |
| `OM/CM` | เปิด/ปิด modal |
| `toast(msg)` | แสดง notification ชั่วคราว |

## Roadmap

- [ ] Supabase Auth + RLS per user (ยังใช้ anon key แบบเปิด)
- [ ] PWA — manifest + service worker (iOS/Android Add to Home Screen)
- [ ] Cross-system integration กับระบบน้ำแข็ง
- [ ] Export รายงาน (PDF / Excel)
