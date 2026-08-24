// ─── Ladda API Worker ───
// Proxies all Supabase requests so no keys are exposed in the frontend.
// Env vars (set via wrangler secret put):
//   SUPABASE_URL     – https://xxx.supabase.co
//   SUPABASE_ANON_KEY – supabase anon key
//   HASH_USER        – SHA-256 of user PIN
//   HASH_ADMIN       – SHA-256 of admin PIN
//   HASH_HR          – SHA-256 of hr PIN
//   JWT_SECRET       – random 32-byte hex secret for signing tokens

// tables ที่ hr เข้าไม่ได้
const HR_BLOCKED_TABLES = ['employees_salary', 'payroll_periods', 'payroll_entries', 'payroll_deductions', 'employee_loans'];

// ── ระบบเช็คเวลาเข้างาน ──
const AUTO_REVOKE_DAYS = 3;   // ไม่แตะเกินกี่วัน → เครื่องหลุด ต้องให้หัวหน้าผูกใหม่
const DUP_WINDOW_SEC   = 20;  // แตะซ้ำจุดเดิมภายในกี่วินาที = นับเป็นครั้งเดียว (กันแตะเบิ้ล/NFC อ่านซ้ำ — สั้นพอไม่กันรอบจริงถัดไป)
const CLOCK_SKEW_SEC   = 300; // เวลาเครื่องต่างจาก server เกินนี้ = ตีธง
const AWAY_WINDOW_MIN  = 15;  // เทียบพิกัดกับเพื่อนร่วมสายที่แตะห่างกันไม่เกินกี่นาที
const AWAY_DIST_M      = 800; // ห่างจากเพื่อนร่วมสายเกินนี้ = ตีธง (คนละที่กันชัดเจน)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Prefer,X-View-Key',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function hmacSign(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return b64url(sig);
}

async function makeToken(role, secret, sub, days) {
  const expiry = Math.floor(Date.now() / 1000) + 86400 * (days || 30);
  const payload = sub ? `${role}:${expiry}:${sub}` : `${role}:${expiry}`;
  const sig = await hmacSign(secret, payload);
  const enc = btoa(payload).replace(/=/g, '');
  return `${enc}.${sig}`;
}

async function verifyToken(token, secret) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  try {
    const enc = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    // pad base64
    const pad = enc + '=='.slice(0, (4 - enc.length % 4) % 4);
    const payload = atob(pad);
    const [role, expiry, sub] = payload.split(':');
    if (!role || !expiry) return null;
    if (Math.floor(Date.now() / 1000) > parseInt(expiry)) return null;
    const expected = await hmacSign(secret, payload);
    if (sig !== expected) return null;
    const [deviceId, employeeId] = (sub || '').split('|');
    return { role, deviceId, employeeId, sig };
  } catch {
    return null;
  }
}

// ── เรียก Supabase ตรงจาก Worker ──
async function sb(env, path, opts = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!res.ok) throw new Error(typeof data === 'string' ? data : (data?.message || 'supabase error'));
  return data;
}

// วันทำงาน: เวลาไทย (UTC+7) ตัดวันที่ 04:00 → +7h แล้ว -4h = +3h
function workDate(d = new Date()) {
  return new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
// รหัสจับคู่: 2 ตัวอักษร + 5 ตัวเลข (ตัด I O เพื่อไม่ให้สับสนกับ 1 0)
function pairCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const r = n => Math.floor(Math.random() * n);
  return L[r(24)] + L[r(24)] + String(r(100000)).padStart(5, '0');
}
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function uid32() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}
// ระยะทางระหว่างสองพิกัด (เมตร)
function distM(a, b, c, d) {
  if ([a, b, c, d].some(v => v === null || v === undefined || isNaN(v))) return null;
  const R = 6371000, t = Math.PI / 180;
  const dLat = (c - a) * t, dLng = (d - b) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

// ── Web Push (VAPID) ──
// ส่งแบบไม่มีเนื้อหา → service worker ปลุกขึ้นมาแล้วแสดงข้อความเอง
// (ไม่ต้องทำการเข้ารหัส payload ซึ่งซับซ้อนกว่ามาก)
function b64uFromBuf(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64uFromBuf(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64uFromBuf(new TextEncoder().encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(header + '.' + payload));
  return { auth: `vapid t=${header}.${payload}.${b64uFromBuf(sig)}, k=${env.VAPID_PUBLIC}` };
}
async function sendPush(env, sub) {
  try {
    const { auth } = await vapidHeader(env, sub.endpoint);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: auth, TTL: '3600', 'Content-Length': '0', Urgency: 'high' },
    });
    if (res.status === 404 || res.status === 410) {
      await sb(env, `push_subs?id=eq.${sub.id}`, { method: 'DELETE' }).catch(() => {});
      return false;
    }
    await sb(env, `push_subs?id=eq.${sub.id}`, { method: 'PATCH', body: { last_sent: new Date().toISOString() } }).catch(() => {});
    return res.ok;
  } catch { return false; }
}
async function notifyRoles(env) {
  try {
    const st = await sb(env, `app_settings?key=eq.alert_roles&select=value`).catch(() => null);
    const roles = (st && st[0] && st[0].value) || ['admin'];
    if (!roles.length) return;
    const list = roles.map(r => `"${r}"`).join(',');
    const subs = await sb(env, `push_subs?role=in.(${list})&select=id,endpoint`);
    await Promise.all((subs || []).map(x => sendPush(env, x)));
  } catch {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── POST /auth — ตรวจ PIN hash แล้วออก token ──
    if (url.pathname === '/auth' && request.method === 'POST') {
      let hash;
      try { ({ hash } = await request.json()); }
      catch { return jsonRes({ error: 'bad request' }, 400); }

      let role = null;
      if (hash === env.HASH_ADMIN) role = 'admin';
      else if (hash === env.HASH_USER) role = 'user';
      else if (hash === env.HASH_VIEWER) role = 'viewer';
      else if (hash === env.HASH_HR) role = 'hr';
      if (!role) return jsonRes({ error: 'invalid' }, 401);

      const token = await makeToken(role, env.JWT_SECRET);
      return jsonRes({ token, role });
    }

    // ═══════════════════════════════════════════════
    // ระบบเช็คเวลาเข้างาน NFC
    // ═══════════════════════════════════════════════

    // ── POST /att/enroll — เครื่องลูกน้องขอรหัสจับคู่ (ไม่ต้อง auth) ──
    // คืน { code, device_id, secret } · ยังใช้แตะไม่ได้จนกว่าหัวหน้าจะอนุมัติ
    if (url.pathname === '/att/enroll' && request.method === 'POST') {
      try {
        const devId = 'd_' + uid32();
        const secret = crypto.randomUUID().replace(/-/g, '');
        const code = pairCode();
        const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await sb(env, 'att_devices', {
          method: 'POST', prefer: 'return=minimal',
          body: {
            id: devId, employee_id: null, status: 'pending', code,
            claim_hash: await sha256hex(secret), expires_at: expires,
            label: (request.headers.get('User-Agent') || '').slice(0, 80),
            bound_at: new Date().toISOString(),
            ua: request.headers.get('User-Agent') || null,
          },
        });
        return jsonRes({ ok: true, code, device_id: devId, secret, expires_at: expires });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    // ── GET /att/enroll/status?d=..&s=.. — เครื่องถามว่าหัวหน้าอนุมัติหรือยัง ──
    if (url.pathname === '/att/enroll/status' && request.method === 'GET') {
      const devId = url.searchParams.get('d') || '';
      const secret = url.searchParams.get('s') || '';
      if (!devId || !secret) return jsonRes({ error: 'bad request' }, 400);
      try {
        const rows = await sb(env, `att_devices?id=eq.${devId}&select=*`);
        const dev = rows && rows[0];
        if (!dev) return jsonRes({ status: 'gone' }, 404);
        if (dev.claim_hash !== await sha256hex(secret)) return jsonRes({ error: 'forbidden' }, 403);
        if (dev.status === 'pending') {
          if (dev.expires_at && new Date(dev.expires_at) < new Date()) return jsonRes({ status: 'expired' });
          return jsonRes({ status: 'pending', code: dev.code });
        }
        if (dev.status === 'active' && dev.claim_token) {
          const [token, viewKey] = dev.claim_token.split('~');
          // ให้ token แค่ครั้งเดียว แล้วล้างทิ้งจากฐานข้อมูล
          await sb(env, `att_devices?id=eq.${devId}`, { method: 'PATCH', body: { claim_token: null } });
          let name = '';
          if (dev.employee_id) {
            const emps = await sb(env, `employees?id=eq.${dev.employee_id}&select=name`);
            name = (emps && emps[0] && emps[0].name) || '';
          }
          return jsonRes({ status: 'approved', token, view_key: viewKey || null, employee: { id: dev.employee_id, name } });
        }
        if (dev.status === 'active') return jsonRes({ status: 'claimed' });
        return jsonRes({ status: 'revoked' });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    // ── POST /att/approve — หัวหน้างานอนุมัติรหัส แล้วผูกกับพนักงาน ──
    // body: { device_id | code, employee_id } · auth: admin | hr
    if (url.pathname === '/att/approve' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const payload = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
      if (!payload || !['admin', 'hr'].includes(payload.role)) return jsonRes({ error: 'unauthorized' }, 401);

      let body;
      try { body = await request.json(); } catch { return jsonRes({ error: 'bad request' }, 400); }
      const empId = body.employee_id;
      if (!empId) return jsonRes({ error: 'employee_id required' }, 400);

      try {
        const q = body.device_id
          ? `att_devices?id=eq.${body.device_id}&select=*`
          : `att_devices?code=eq.${(body.code || '').toUpperCase()}&status=eq.pending&select=*`;
        const rows = await sb(env, q);
        const dev = rows && rows[0];
        if (!dev) return jsonRes({ error: 'ไม่พบรหัสนี้' }, 404);
        if (dev.status !== 'pending') return jsonRes({ error: 'รหัสนี้ถูกใช้ไปแล้ว' }, 409);
        if (dev.expires_at && new Date(dev.expires_at) < new Date()) return jsonRes({ error: 'รหัสหมดอายุแล้ว — ให้ลูกน้องสแกนใหม่' }, 410);

        const emps = await sb(env, `employees?id=eq.${empId}&select=id,name,status`);
        const emp = emps && emps[0];
        if (!emp) return jsonRes({ error: 'ไม่พบพนักงาน' }, 404);
        if (emp.status !== 'active') return jsonRes({ error: 'พนักงานคนนี้ไม่ได้ทำงานอยู่' }, 403);

        // 1 คน = 1 เครื่องเท่านั้น → ถอนเครื่องเก่าทั้งหมดก่อน
        await sb(env, `att_devices?employee_id=eq.${empId}&status=eq.active`, {
          method: 'PATCH', body: { status: 'revoked', revoked_at: new Date().toISOString() },
        });

        const token = await makeToken('device', env.JWT_SECRET, `${dev.id}|${empId}`, 3650);
        // กุญแจดูข้อมูลตัวเอง (สำหรับไอคอนหน้าจอโฮม) — สุ่ม 32 ตัวอักษร เก็บเฉพาะ hash
        const viewKey = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
        await sb(env, `att_devices?id=eq.${dev.id}`, {
          method: 'PATCH',
          body: {
            employee_id: empId, status: 'active', claim_token: token + '~' + viewKey,
            view_hash: await sha256hex(viewKey),
            secret_hash: token.slice(token.lastIndexOf('.') + 1),
            bound_by: payload.role, bound_at: new Date().toISOString(), code: null,
          },
        });
        return jsonRes({ ok: true, employee: { id: emp.id, name: emp.name } });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    // ── POST /att/bind — หัวหน้างานผูกเครื่องให้พนักงาน ──
    // body: { employee_id, label } · auth: admin | hr
    if (url.pathname === '/att/bind' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const payload = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
      if (!payload || !['admin', 'hr'].includes(payload.role)) return jsonRes({ error: 'unauthorized' }, 401);

      let body;
      try { body = await request.json(); } catch { return jsonRes({ error: 'bad request' }, 400); }
      const empId = body.employee_id;
      if (!empId) return jsonRes({ error: 'employee_id required' }, 400);

      try {
        const emps = await sb(env, `employees?id=eq.${empId}&select=id,name,status`);
        const emp = emps && emps[0];
        if (!emp) return jsonRes({ error: 'ไม่พบพนักงาน' }, 404);
        if (emp.status !== 'active') return jsonRes({ error: 'พนักงานคนนี้ไม่ได้ทำงานอยู่' }, 403);

        // 1 คน = 1 เครื่องเท่านั้น → ถอนเครื่องเก่าทั้งหมดก่อน
        await sb(env, `att_devices?employee_id=eq.${empId}&status=eq.active`, {
          method: 'PATCH', body: { status: 'revoked', revoked_at: new Date().toISOString() },
        });

        const devId = 'd_' + uid32();
        const token = await makeToken('device', env.JWT_SECRET, `${devId}|${empId}`, 3650);
        await sb(env, 'att_devices', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            id: devId, employee_id: empId, label: body.label || null,
            secret_hash: token.slice(token.lastIndexOf('.') + 1),
            status: 'active', bound_by: payload.role, bound_at: new Date().toISOString(),
            ua: request.headers.get('User-Agent') || null,
          },
        });
        return jsonRes({ ok: true, token, device_id: devId, employee: { id: emp.id, name: emp.name } });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    // ── POST /att/tap — พนักงานแตะ NFC ──
    // body: { point_id, lat, lng, accuracy, client_ts }
    if (url.pathname === '/att/tap' && request.method === 'POST') {
      // รับได้ทั้งบัตรลงเวลา (Bearer) และกุญแจดูข้อมูล (X-View-Key จากไอคอนหน้าจอโฮม)
      const vkTap = request.headers.get('X-View-Key') || '';
      let payload = null;
      if (!vkTap) {
        const auth = request.headers.get('Authorization') || '';
        payload = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
        if (!payload || payload.role !== 'device') return jsonRes({ error: 'unauthorized', code: 'notoken' }, 401);
      } else if (vkTap.length < 24) return jsonRes({ error: 'unauthorized', code: 'notoken' }, 401);

      let body = {};
      try { body = await request.json(); } catch {}

      try {
        const devs = vkTap
          ? await sb(env, `att_devices?view_hash=eq.${await sha256hex(vkTap)}&select=*`)
          : await sb(env, `att_devices?id=eq.${payload.deviceId}&select=*`);
        const dev = devs && devs[0];
        if (!dev || dev.status !== 'active') return jsonRes({ error: 'เครื่องนี้ถูกถอนแล้ว — ติดต่อหัวหน้างาน', code: 'revoked' }, 403);

        const empIdTap = vkTap ? dev.employee_id : payload.employeeId;
        const emps = await sb(env, `employees?id=eq.${empIdTap}&select=id,name,route_id,status,photo_url`);
        const emp = emps && emps[0];
        if (!emp) return jsonRes({ error: 'ไม่พบพนักงาน', code: 'noemp' }, 404);
        if (emp.status !== 'active') {
          await sb(env, `att_devices?id=eq.${dev.id}`, { method: 'PATCH', body: { status: 'revoked', revoked_at: new Date().toISOString() } });
          return jsonRes({ error: 'พนักงานคนนี้ไม่ได้ทำงานอยู่แล้ว', code: 'inactive' }, 403);
        }

        const now = new Date();
        const wd = workDate(now);

        // หยุดเกิน N วัน → ถอนเครื่อง บังคับไปหาหัวหน้างาน
        const last = await sb(env, `att_events?employee_id=eq.${emp.id}&select=ts,work_date&order=ts.desc&limit=1`);
        if (last && last[0]) {
          const gapDays = Math.floor((new Date(wd) - new Date(last[0].work_date)) / 86400000);
          if (gapDays > AUTO_REVOKE_DAYS) {
            await sb(env, `att_devices?id=eq.${dev.id}`, { method: 'PATCH', body: { status: 'revoked', revoked_at: now.toISOString() } });
            return jsonRes({
              error: `หยุดงานเกิน ${AUTO_REVOKE_DAYS} วัน — ติดต่อหัวหน้างานเพื่อเปิดใช้งานใหม่`,
              code: 'stale', gap_days: gapDays,
            }, 403);
          }
        }

        // รายการแตะของวันนี้
        const today = await sb(env, `att_events?employee_id=eq.${emp.id}&work_date=eq.${wd}&select=id,ts,seq,point_id&order=ts.desc`);

        // แตะซ้ำจุดเดิมภายใน DUP_WINDOW_SEC → ไม่บันทึกซ้ำ
        if (today && today[0] && today[0].point_id === body.point_id) {
          const ago = (now - new Date(today[0].ts)) / 1000;
          if (ago < DUP_WINDOW_SEC) {
            return jsonRes({ ok: true, dup: true, employee: { name: emp.name, photo_url: emp.photo_url }, seq: today[0].seq, taps_today: today.length, ts: today[0].ts });
          }
        }

        // จุดแตะ
        let point = null;
        if (body.point_id) {
          const pts = await sb(env, `att_points?id=eq.${body.point_id}&select=*`);
          point = pts && pts[0];
          if (!point || point.status !== 'active') return jsonRes({ error: 'จุดแตะนี้ใช้ไม่ได้แล้ว', code: 'nopoint' }, 404);
        }

        const flags = {};
        const lat = body.lat ?? null, lng = body.lng ?? null;
        if (lat === null || lng === null) flags.noloc = true;
        if (body.mock) flags.mock = true;
        if (body.manual) flags.manual = true;   // กดปุ่มในแอป ไม่ได้แตะสติ๊กเกอร์
        if (body.client_ts) {
          const skew = Math.abs((new Date(body.client_ts) - now) / 1000);
          if (skew > CLOCK_SKEW_SEC) flags.clockskew = Math.round(skew);
        }
        let dist = null;
        if (point && point.kind === 'place' && point.lat != null && lat != null) {
          dist = distM(Number(point.lat), Number(point.lng), Number(lat), Number(lng));
          if (dist != null && dist > (point.radius_m || 200)) flags.far = dist;
        }

        // สายของการแตะครั้งนี้ = สายที่ผูกกับสติ๊กเกอร์ (ไม่ใช่สายประจำตัวคนแตะ)
        // เผื่อไปแทนสายอื่น — ถ้าสติ๊กเกอร์ไม่ผูกสาย (หรือกดในแอป ไม่มีจุดแตะ) ใช้สายตัวเอง
        const tapRouteId = (point && point.route_id) || emp.route_id || null;

        // เทียบพิกัดกับเพื่อนร่วมสายที่แตะเวลาใกล้กัน — จับกรณีมีคนแตะแทนจากคนละที่
        if (lat != null && lng != null && tapRouteId) {
          const winStart = new Date(now - AWAY_WINDOW_MIN * 60000).toISOString();
          const mates = await sb(env, `att_events?route_id=eq.${tapRouteId}&work_date=eq.${wd}&employee_id=neq.${emp.id}&ts=gte.${winStart}&lat=not.is.null&select=employee_id,lat,lng,ts&order=ts.desc&limit=5`);
          if (mates && mates.length) {
            const mate = mates[0];
            const mDist = distM(Number(mate.lat), Number(mate.lng), lat, lng);
            if (mDist != null && mDist > AWAY_DIST_M) {
              flags.away = Math.round(mDist);
              flags.away_emp = mate.employee_id;
            }
          }
        }

        const row = {
          id: 'e_' + uid32(),
          employee_id: emp.id,
          device_id: dev.id,
          point_id: point ? point.id : null,
          route_id: tapRouteId,
          vehicle_id: point ? point.vehicle_id || null : null,
          work_date: wd,
          ts: now.toISOString(),
          client_ts: body.client_ts || null,
          seq: (today ? today.length : 0) + 1,
          lat, lng,
          accuracy: body.accuracy ?? null,
          dist_m: dist,
          flags,
          ua: request.headers.get('User-Agent') || null,
          ip: request.headers.get('CF-Connecting-IP') || null,
        };
        await sb(env, 'att_events', { method: 'POST', prefer: 'return=minimal', body: row });
        await sb(env, `att_devices?id=eq.${dev.id}`, { method: 'PATCH', body: { last_seen: now.toISOString() } });

        return jsonRes({
          ok: true, seq: row.seq, taps_today: row.seq, ts: row.ts, work_date: wd,
          point: point ? { id: point.id, name: point.name, kind: point.kind } : null,
          employee: { id: emp.id, name: emp.name, photo_url: emp.photo_url },
          route_id: tapRouteId,
          flags,
        });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    // ── POST /push/subscribe — เครื่องของหัวหน้าสมัครรับแจ้งเตือน ──
    if (url.pathname === '/push/subscribe' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const p = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
      if (!p || p.role === 'device') return jsonRes({ error: 'unauthorized' }, 401);
      let body;
      try { body = await request.json(); } catch { return jsonRes({ error: 'bad request' }, 400); }
      if (!body.endpoint) return jsonRes({ error: 'endpoint required' }, 400);
      try {
        await sb(env, 'push_subs?on_conflict=endpoint', {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { id: 'ps_' + uid32(), endpoint: body.endpoint, role: p.role, label: (body.label || '').slice(0, 80) },
        });
        return jsonRes({ ok: true, role: p.role });
      } catch (e) { return jsonRes({ error: e.message }, 500); }
    }

    // ── POST /push/unsubscribe ──
    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const p = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
      if (!p || p.role === 'device') return jsonRes({ error: 'unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { body = {}; }
      if (!body.endpoint) return jsonRes({ error: 'endpoint required' }, 400);
      try {
        await sb(env, `push_subs?endpoint=eq.${encodeURIComponent(body.endpoint)}`, { method: 'DELETE' });
        return jsonRes({ ok: true });
      } catch (e) { return jsonRes({ error: e.message }, 500); }
    }

    // ── POST /push/test — ส่งทดสอบให้ตัวเอง ──
    if (url.pathname === '/push/test' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const p = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
      if (!p || p.role !== 'admin') return jsonRes({ error: 'unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { body = {}; }
      if (!body.endpoint) return jsonRes({ error: 'endpoint required' }, 400);
      const ok = await sendPush(env, { id: 'test', endpoint: body.endpoint });
      return jsonRes({ ok });
    }

    // ── POST /att/alert — แจ้งเหตุจากหน้างาน (รถเสีย) ──
    // เข้าได้ทั้ง device token และกุญแจดูข้อมูล (ไอคอนหน้าจอโฮมมีแค่กุญแจ)
    if (url.pathname === '/att/alert' && request.method === 'POST') {
      let empId = null, devId = null;
      const vk = request.headers.get('X-View-Key') || '';
      try {
        if (vk) {
          if (vk.length < 24) return jsonRes({ error: 'unauthorized' }, 401);
          const rows = await sb(env, `att_devices?view_hash=eq.${await sha256hex(vk)}&select=id,employee_id,status`);
          const d = rows && rows[0];
          if (!d || d.status !== 'active') return jsonRes({ error: 'unauthorized' }, 403);
          empId = d.employee_id; devId = d.id;
        } else {
          const auth = request.headers.get('Authorization') || '';
          const p = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
          if (!p || p.role !== 'device') return jsonRes({ error: 'unauthorized' }, 401);
          const rows = await sb(env, `att_devices?id=eq.${p.deviceId}&select=id,status`);
          if (!rows || !rows[0] || rows[0].status !== 'active') return jsonRes({ error: 'unauthorized' }, 403);
          empId = p.employeeId; devId = p.deviceId;
        }
        let body = {};
        try { body = await request.json(); } catch {}
        const emps = await sb(env, `employees?id=eq.${empId}&select=id,name,route_id`);
        const emp = (emps && emps[0]) || {};
        const now = new Date();
        const row = {
          id: 'al_' + uid32(), employee_id: empId, device_id: devId,
          route_id: emp.route_id || null, kind: body.kind || 'breakdown',
          work_date: workDate(now), ts: now.toISOString(),
          lat: body.lat ?? null, lng: body.lng ?? null, accuracy: body.accuracy ?? null,
          note: body.note || null, status: 'open',
          ua: request.headers.get('User-Agent') || null,
          ip: request.headers.get('CF-Connecting-IP') || null,
        };
        await sb(env, 'att_alerts', { method: 'POST', prefer: 'return=minimal', body: row });
        await notifyRoles(env);
        return jsonRes({ ok: true, ts: row.ts, employee: { name: emp.name || '' } });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    // ── GET /me — ข้อมูลของตัวเอง (อ่านอย่างเดียว) ──
    // เข้าได้ 2 ทาง: device token (Bearer) หรือกุญแจดูข้อมูล (X-View-Key)
    // ทั้งสองทางดึงได้เฉพาะข้อมูลของเจ้าของเท่านั้น — ส่ง id คนอื่นมาไม่ได้
    if (url.pathname === '/me' && request.method === 'GET') {
      const viewKey = request.headers.get('X-View-Key') || '';
      let empId = null, devRow = null;

      if (viewKey) {
       try {
        if (viewKey.length < 24) return jsonRes({ error: 'unauthorized' }, 401);
        const rows = await sb(env, `att_devices?view_hash=eq.${await sha256hex(viewKey)}&select=id,employee_id,status`);
        devRow = rows && rows[0];
        if (!devRow || devRow.status !== 'active') return jsonRes({ error: 'ลิงก์นี้ใช้ไม่ได้แล้ว — ติดต่อหัวหน้างาน', code: 'revoked' }, 403);
        empId = devRow.employee_id;
       } catch (e) { return jsonRes({ error: 'ลิงก์นี้ใช้ไม่ได้ — ' + e.message, code: 'revoked' }, 403); }
      } else {
        const auth = request.headers.get('Authorization') || '';
        const payload = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.JWT_SECRET);
        if (!payload || payload.role !== 'device') return jsonRes({ error: 'unauthorized' }, 401);
        const devs = await sb(env, `att_devices?id=eq.${payload.deviceId}&select=id,status`);
        if (!devs || !devs[0] || devs[0].status !== 'active') return jsonRes({ error: 'เครื่องนี้ถูกถอนแล้ว', code: 'revoked' }, 403);
        empId = payload.employeeId;
      }

      try {
        // เฉพาะฟิลด์ที่ให้ลูกน้องเห็นได้ — ไม่มีค่าแรง ไม่มีของคนอื่น
        const emps = await sb(env, `employees?id=eq.${empId}&select=id,name,route_id,nationality,status,photo_url,permit_photos,license_photo,tel,permit_expiry,visa_expiry,passport_expiry`);
        const emp = emps && emps[0];
        if (!emp) return jsonRes({ error: 'ไม่พบพนักงาน' }, 404);

        const wd = workDate();
        // กุญแจดูข้อมูล: ใช้กฎ 3 วันเดียวกับการแตะบัตร — หยุดนานแล้วต้องไปหาหัวหน้างาน
        if (viewKey) {
          const last = await sb(env, `att_events?employee_id=eq.${empId}&select=work_date&order=ts.desc&limit=1`);
          if (last && last[0]) {
            const gap = Math.floor((new Date(wd) - new Date(last[0].work_date)) / 86400000);
            if (gap > AUTO_REVOKE_DAYS) return jsonRes({ error: `หยุดงานเกิน ${AUTO_REVOKE_DAYS} วัน — ติดต่อหัวหน้างาน`, code: 'stale' }, 403);
          }
        }
        const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
        const events = await sb(env, `att_events?employee_id=eq.${empId}&work_date=gte.${from}&select=work_date,ts,seq,point_id,route_id,flags&order=ts.desc&limit=80`);

        // ตารางเที่ยววิ่ง — ของสายตัวเอง + ของทุกสายที่แตะวันนี้ (เผื่อไปแทนสายอื่น)
        // ไม่ได้ดูแค่สายประจำตัว เพราะสติ๊กเกอร์ที่แตะอาจเป็นของสายอื่นก็ได้
        const todayRouteIds = new Set((events || []).filter(v => v.work_date === wd && v.route_id).map(v => v.route_id));
        if (emp.route_id) todayRouteIds.add(emp.route_id);
        let shifts = {}, routeNames = {};
        if (todayRouteIds.size) {
          const idList = [...todayRouteIds].map(r => `"${r}"`).join(',');
          const shiftRows = await sb(env, `route_shifts?route_id=in.(${idList})&select=route_id,trips_json,start_time`).catch(() => []);
          (shiftRows || []).forEach(s => { shifts[s.route_id] = s; });
          const routeRows = await sb(env, `routes?id=in.(${idList})&select=id,name`).catch(() => []);
          (routeRows || []).forEach(r => { routeNames[r.id] = r.name; });
        }

        // สลิป = งวดล่าสุดที่ "จ่ายแล้ว" เท่านั้น (ไม่โชว์งวดที่กำลังทำอยู่ ซึ่งวันทำงานยังเป็น 0)
        let payslip = null;
        const paid = await sb(env, `payroll_periods?status=eq.paid&select=id,period_key,status,pay_date&order=period_key.desc&limit=12`);
        for (const p of (paid || [])) {
          const ents = await sb(env, `payroll_entries?employee_id=eq.${empId}&period_id=eq.${p.id}&select=*&limit=1`);
          if (ents && ents[0]) {
            const deds = await sb(env, `payroll_deductions?entry_id=eq.${ents[0].id}&select=*`);
            // daily_rate อยู่ใน employees_salary ไม่ได้อยู่ในสลิป — ของตัวเองเท่านั้น
            const sal = await sb(env, `employees_salary?employee_id=eq.${empId}&select=daily_rate`).catch(() => null);
            payslip = { entry: ents[0], deductions: deds || [], period: p, daily_rate: (sal && sal[0] && sal[0].daily_rate) || 0 };
            break;
          }
        }
        return jsonRes({ ok: true, employee: emp, today: wd, events: events || [], payslip, shifts, routeNames });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    // ── /api/* — proxy ไป Supabase (ต้องมี token) ──
    if (url.pathname.startsWith('/api/')) {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const payload = await verifyToken(token, env.JWT_SECRET);
      if (!payload) return jsonRes({ error: 'unauthorized' }, 401);
      // device token แตะ table ตรงไม่ได้เด็ดขาด — ใช้ได้แค่ /att/tap และ /me
      if (payload.role === 'device') return jsonRes({ error: 'forbidden' }, 403);

      const sbPath = url.pathname.slice('/api/'.length);
      // hr ห้ามเข้า table ที่มีข้อมูลเงิน
      const tableName = sbPath.split('?')[0];
      if (payload.role === 'hr' && HR_BLOCKED_TABLES.includes(tableName)) {
        return jsonRes({ error: 'forbidden' }, 403);
      }
      const sbUrl = `${env.SUPABASE_URL}/rest/v1/${sbPath}${url.search}`;

      const fwdHeaders = new Headers();
      fwdHeaders.set('Content-Type', 'application/json');
      fwdHeaders.set('apikey', env.SUPABASE_ANON_KEY);
      fwdHeaders.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY}`);
      const prefer = request.headers.get('Prefer');
      if (prefer) fwdHeaders.set('Prefer', prefer);

      const hasBody = ['POST', 'PUT', 'PATCH'].includes(request.method);
      const sbReq = new Request(sbUrl, {
        method: request.method,
        headers: fwdHeaders,
        body: hasBody ? request.body : undefined,
      });

      const sbRes = await fetch(sbReq);
      const resHeaders = new Headers(sbRes.headers);
      Object.entries(CORS).forEach(([k, v]) => resHeaders.set(k, v));
      return new Response(sbRes.body, { status: sbRes.status, headers: resHeaders });
    }

    return jsonRes({ error: 'not found' }, 404);
  },
};
