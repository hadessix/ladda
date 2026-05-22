# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"น้องลัดดา" — a cash-counting and income/expense tracking app for multi-route businesses. Runs as a **single `index.html` file** with no build tools, no dependencies, and no package manager. Open directly in a browser or serve via Cloudflare Pages.

- Live URL: https://ladda-b0j.pages.dev/
- GitHub: https://github.com/hadessix/ladda
- Supabase: https://lsxnbdhyfsuqhopzuwls.supabase.co

## Deploy

```bash
# Git push + deploy (ทำทีเดียว)
git add index.html
git commit -m "message"
git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true

# Deploy อย่างเดียว
wrangler pages deploy . --project-name=ladda --commit-dirty=true
```

No local dev server needed — open `index.html` directly in a browser to test.

## Architecture

Everything lives in `index.html` in this order:
1. **`<style>`** — all CSS (CSS variables in `:root`, dark theme)
2. **`<body>`** — login screen (`#login-screen`) + app shell (`#app`) with header, sidebar, tabs, content area
3. **`<script>`** — all JavaScript, structured as:
   - Constants & utilities (`BT`, `bv`, `cpk`, `fmt`, `uid`, `today`)
   - Supabase config + REST helpers (`sbGet`, `sbUpsert`, `sbDelete`)
   - Field mappers (`entryToRow`, `rowToEntry`)
   - Global state (`S`, `AUTH`)
   - Data loading (`loadAll`)
   - Auth (`authInit`, `sha256`, `pinCheck`, `showApp`, `logout`, `isAdmin`)
   - Render functions (`render`, `renderSidebar`, `renderContent`, `renderShopContent`, `renderGroupContent`)
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

AUTH = { role: 'user' | 'admin' }  // persisted in localStorage key: 'ladda_role'
```

## Supabase Schema

```sql
routes (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#22c55e',
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true,"payowner":false,"auto_collect":false}',
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
  tab_flags   jsonb DEFAULT '{"count":true,"income":true,"expense":true,"exchange":true,"payowner":false,"auto_collect":false}'
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
| `exin` | รับแลกเงินจากสายอื่น / รับจากจ่ายเฮียรวย / รับ auto-collect | +amount |
| `exout` | แลกเงินออกไปสายอื่น / จ่ายเฮียรวย / โอน auto-collect | -amount |

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
  └─ มี ladda_role ใน localStorage?
        ├─ ใช่ → showApp() → loadAll() → render()
        └─ ไม่ → แสดงหน้า password input
                   └─ กรอก PIN → pinCheck() (async, SHA-256)
                         ├─ hash ตรงกับ HASH_USER  → role=user  (ดู + เพิ่ม, ลบไม่ได้)
                         ├─ hash ตรงกับ HASH_ADMIN → role=admin (ทุกอย่าง)
                         └─ ผิด → แสดง error, ล้าง input
```

- PIN จริงไม่เคยอยู่ใน source — มีแค่ SHA-256 hash (`HASH_USER`, `HASH_ADMIN`)
- `sha256(str)` ใช้ `crypto.subtle.digest` (Web Crypto API, built-in browser)
- `isAdmin()` guards all delete/manage actions
- Logout: กด badge role ที่ header → ลบ localStorage → แสดงหน้า login ใหม่

## Key Patterns

- **bills object**: `{ 1000: n, 500: n, 100: n, 50: n, 20: n, coin: n }` — `coin` = ฿1 each; use `bv(bills)` to compute total
- **month_key**: `"YYYY-MM"` — fiscal period starts on 11th of month; `cpk()` returns current period key
- **tab_flags**: `{ count, income, expense, exchange, payowner, auto_collect }` — controls which tabs show per route/group; `curTabFlags()` returns flags for current view
- **`_cbMap` global**: stores bill-input callbacks by prefix to avoid JSON.stringify/double-quote conflicts in inline `oninput` attributes
- **`calcCB(sid, mk)`**: computes cumulative bills in cash box at a given month by replaying all entries
- **Exchange modal** (`openExchange(fromShop, lockedId)`):
  - Right dropdown uses `r:${id}` prefix for routes, `g:${id}` for groups
  - Routes/groups with zero balance are filtered out (cannot be selected)
  - Self-exchange validation: route cannot exchange with itself or its own group
  - `fromShop=true` → left side locks to current route
- **Pay-owner tab**: enabled via `tab_flags.payowner`; target group must have `is_owner=true`; saves `exout` at payer + `exin` at first route of owner group
- **Auto-collect** (`tab_flags.auto_collect` on group): after sub-shop summarizes a count round, auto-creates `exout` (from sub-shop) + `exin` (to first route = collector) immediately; first route of group is always the collector and is exempt
- **Count session**: open session → add multiple subs (each with date range + bills) → **สามารถแก้ไขแต่ละ sub ได้ก่อนสรุป** → กด "สรุปรอบ" → upsert entry + delete session; หลังสรุปแก้ไขไม่ได้
- **Sidebar icon**: `⭐` = is_owner group, `⚡` = auto_collect group, `📁` = normal group

## Function Reference

| Function | หน้าที่ |
|---|---|
| `authInit()` | ตรวจ localStorage → showApp() หรือแสดงหน้า login |
| `sha256(str)` | async — SHA-256 hash via Web Crypto API |
| `pinCheck()` | async — hash input → เทียบ HASH_USER/HASH_ADMIN → set role + showApp() |
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
| `openCount()` | เริ่มรอบนับเงิน หรือ addSubCount() ถ้ามี session อยู่แล้ว |
| `addSubCount()` | เพิ่ม sub ครั้งใหม่ใน session ที่เปิดอยู่ |
| `editSubCount(idx)` | เปิด modal แก้ไข sub ครั้งที่ idx (0-based) ใน session ที่ยังเปิด |
| `saveEditSub(idx)` | บันทึกการแก้ไข sub → upsert session ใน Supabase |
| `summarize()` | สรุปรอบนับเงิน → upsert entry + delete session + auto-collect ถ้าเปิด |
| `cancelSess()` | ยกเลิกและลบ session ที่เปิดอยู่ |
| `openExchange(fromShop,lockedId)` | เปิด modal แลกเงิน (กรอง zero-balance ออก) |
| `refreshExchangeCB(fromShop)` | อัปเดต cap + label "มี X ใบ" เมื่อเปลี่ยนปลายทาง |
| `saveExchange(fromShop)` | บันทึกการแลก รองรับ route (`r:id`) และ group (`g:id`) เป็นปลายทาง |
| `openPayOwner(fromSid)` | เปิด modal จ่ายเฮียรวย จาก shop view |
| `openPayOwnerGroup(gid)` | เปิด modal เลือกสายก่อนจ่ายเฮียรวย จาก group view |
| `savePayOwner(fromSid,ownerGid,ownerFirstId)` | บันทึก exout+exin สำหรับจ่ายเฮียรวย |
| `billInpWithLimit(p,cb)` | render grid input แบงค์พร้อม cap |
| `updBLimit(p)` | อัปเดตยอด real-time สำหรับ input ที่มี cap |
| `billInp(p)` | render grid input แบงค์ไม่มี cap |
| `updB(p)` | อัปเดตยอด real-time สำหรับ input ไม่มี cap |
| `addShop/saveShop` | เพิ่มสายใหม่ (admin only) |
| `editShop/saveEditShop(id)` | แก้ไขชื่อ + สี + tab_flags สาย (admin only) |
| `deleteShop(id)` | ลบสายและข้อมูลทั้งหมด + sync groupMembers |
| `addGroup/saveGroup` | เพิ่มกลุ่มใหม่ (admin only) |
| `editGroup/saveEditGroup(id)` | แก้ไขกลุ่ม + sync members + auto_collect checkbox |
| `deleteGroup(id)` | ลบกลุ่ม (สายไม่ถูกลบ) |
| `pickShopThen(...)` | modal เลือกสายก่อนเปิด action |
| `tfChips(flags,prefix)` | render toggle chip สำหรับ tab_flags |
| `getTf(prefix)` | อ่านค่า tab_flags จาก chip ใน DOM |
| `toggleGrpCard(id)` | ขยาย/ยุบ card สายในหน้าสรุปกลุ่ม |
| `OM/CM` | เปิด/ปิด modal |
| `toast(msg)` | แสดง notification ชั่วคราว |

## Security

| Layer | สถานะ | รายละเอียด |
|---|---|---|
| PIN hashing | ✅ Done | SHA-256 — source มีแค่ WORKER_URL ไม่มี hash ไม่มี PIN |
| Cloudflare Worker proxy | ✅ Done | `worker.js` — secrets อยู่ใน Cloudflare env, ไม่มีใน source เลย |
| Supabase RLS | 🔲 TODO | ต้องทำหลัง Worker (ต้องมี auth token จริง) |

### Worker Details
- URL: `https://ladda-api.hades-six.workers.dev`
- Endpoints: `POST /auth` (ตรวจ PIN hash → ออก JWT), `GET|POST|DELETE /api/:table` (proxy → Supabase)
- Secrets (ตั้งผ่าน `wrangler secret put`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `HASH_USER`, `HASH_ADMIN`, `JWT_SECRET`
- Token อายุ 30 วัน, เก็บใน `localStorage.ladda_token`
- ถ้า Worker คืน 401 → `logout()` อัตโนมัติ

### Deploy Commands
```bash
# Deploy Worker (เมื่อแก้ worker.js)
wrangler deploy

# Deploy Pages (เมื่อแก้ index.html)
git add index.html && git commit -m "msg" && git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true
```

## Roadmap

- [x] SHA-256 PIN hashing
- [x] Cloudflare Worker API proxy (ไม่มี key ใดๆ ใน source)
- [ ] Supabase RLS per authenticated user
- [ ] PWA — manifest + service worker (iOS/Android Add to Home Screen)
- [ ] Export รายงาน (PDF / Excel)
- [ ] Cross-system integration กับระบบน้ำแข็ง
