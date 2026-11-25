// Web Push from the app itself (Cloudflare Workers), for friend requests and shared products.
// Sends an empty "wake-up" push signed with VAPID (no payload, so no payload encryption is needed);
// the service worker then fetches /api/notifications/pending and shows what is waiting.
// The VAPID key pair is derived from SESSION_SECRET exactly as scripts/vapid.js does for the pipeline.

const te = new TextEncoder();
export const b64u = {
  enc: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0)),
};

const keys = new Map(); // SESSION_SECRET -> Promise<CryptoKey>
function vapidPrivateKey(env) {
  if (!keys.has(env.SESSION_SECRET)) {
    keys.set(env.SESSION_SECRET, (async () => {
      const pub = b64u.dec(env.VAPID_PUBLIC_KEY);
      const x = b64u.enc(pub.slice(1, 33)), y = b64u.enc(pub.slice(33, 65));
      const hmac = await crypto.subtle.importKey('raw', te.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      for (let i = 0; i < 10; i++) {
        const d = await crypto.subtle.sign('HMAC', hmac, te.encode(`fair-whack-vapid-${i}`));
        try {
          return await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: b64u.enc(d), x, y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        } catch { /* out of range: next, like scripts/vapid.js */ }
      }
      throw new Error('no VAPID key');
    })());
  }
  return keys.get(env.SESSION_SECRET);
}

/** VAPID JWT for one push service origin. */
export async function vapidJwt(env, endpoint, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: 'mailto:beta@fairwhack.app' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidPrivateKey(env), te.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u.enc(sig)}`;
}

/**
 * Queue a notification for a user and wake their devices. The notification is saved first, so it is
 * shown the next time the app opens even if no device can be reached.
 */
export async function notify(env, userId, { kind, title, body, url }) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO notifications (id, user_id, kind, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, kind, title, body || null, url || '/#/', new Date().toISOString()).run();
  if (!env.VAPID_PUBLIC_KEY || !env.SESSION_SECRET) return { queued: id, sent: 0 };
  const subs = (await env.DB.prepare('SELECT id, endpoint FROM push_subs WHERE user_id = ?').bind(userId).all()).results;
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { TTL: '86400', Urgency: 'normal', Authorization: `vapid t=${await vapidJwt(env, s.endpoint)}, k=${env.VAPID_PUBLIC_KEY}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(s.id).run();
      else if (res.ok) sent++;
    } catch { /* device unreachable: the notification waits in the app */ }
  }));
  return { queued: id, sent };
}
