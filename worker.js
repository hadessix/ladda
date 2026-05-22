// ─── Ladda API Worker ───
// Proxies all Supabase requests so no keys are exposed in the frontend.
// Env vars (set via wrangler secret put):
//   SUPABASE_URL     – https://xxx.supabase.co
//   SUPABASE_ANON_KEY – supabase anon key
//   HASH_USER        – SHA-256 of user PIN
//   HASH_ADMIN       – SHA-256 of admin PIN
//   JWT_SECRET       – random 32-byte hex secret for signing tokens

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Prefer',
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

async function makeToken(role, secret) {
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 วัน
  const payload = `${role}:${expiry}`;
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
    const [role, expiry] = payload.split(':');
    if (!role || !expiry) return null;
    if (Math.floor(Date.now() / 1000) > parseInt(expiry)) return null;
    const expected = await hmacSign(secret, payload);
    if (sig !== expected) return null;
    return { role };
  } catch {
    return null;
  }
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
      if (!role) return jsonRes({ error: 'invalid' }, 401);

      const token = await makeToken(role, env.JWT_SECRET);
      return jsonRes({ token, role });
    }

    // ── /api/* — proxy ไป Supabase (ต้องมี token) ──
    if (url.pathname.startsWith('/api/')) {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const payload = await verifyToken(token, env.JWT_SECRET);
      if (!payload) return jsonRes({ error: 'unauthorized' }, 401);

      const sbPath = url.pathname.slice('/api/'.length);
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
