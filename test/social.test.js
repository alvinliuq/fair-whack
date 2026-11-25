// Stage 7 sharing: friends by @user name or QR code (the other person always accepts), sharing products,
// blocking, and the notifications the service worker fetches after a wake-up push.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-social-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  env.DB.raw.prepare("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, cur_price_cents, cur_captured_at) VALUES ('jbhifi:1', 'jbhifi', '1', 'Dyson V8', 49900, ?)").run(new Date().toISOString());
  const person = async (name) => {
    const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code: 'beta' }) }), env);
    const cookie = res.headers.get('Set-Cookie').split(';')[0];
    const call = async (p, body, method) => {
      const r = await handle(new Request(`http://x${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env);
      return { status: r.status, ...(await r.json()) };
    };
    return { call, id: (await res.json()).user.id };
  };
  return { env, person };
}

test('user names: made from the name, unique, can be changed', async () => {
  const { person } = setup();
  const a = await person('Alvin Liu'), b = await person('AlvinLiu');
  const sa = await a.call('/api/social'), sb = await b.call('/api/social');
  assert.equal(sa.me.handle, 'alvinliu');
  assert.equal(sb.me.handle, 'alvinliu2');
  assert.ok(sa.me.code.length >= 10);
  assert.equal((await b.call('/api/social/handle', { handle: '@AlvinLiu' }, 'PUT')).status, 409);
  assert.equal((await b.call('/api/social/handle', { handle: 'x' }, 'PUT')).status, 400);
  assert.equal((await b.call('/api/social/handle', { handle: 'sherry_l' }, 'PUT')).handle, 'sherry_l');
});

test('friends: request by user name needs acceptance; QR code also needs acceptance; sharing and blocking', async () => {
  const { person, env } = setup();
  const a = await person('Ann'), b = await person('Ben'), c = await person('Cat');
  const ha = (await a.call('/api/social')).me.handle;
  const codeA = (await a.call('/api/social')).me.code;
  await c.call('/api/social');

  // Ben asks Ann by user name.
  assert.equal((await b.call('/api/social/lookup?handle=' + ha)).status, 'none');
  assert.equal((await b.call('/api/friends/request', { handle: '@' + ha })).status, 'requested');
  assert.equal((await a.call('/api/social')).incoming[0].id, b.id);
  // Ben can't share before Ann accepts.
  assert.equal((await b.call('/api/shares', { product_id: 'jbhifi:1', to: [a.id] })).status, 400);
  assert.equal((await a.call(`/api/friends/${b.id}/accept`, {})).ok, true);
  assert.equal((await b.call('/api/social')).friends[0].id, a.id);

  // Cat scans Ann's QR code: still a request until Ann accepts.
  assert.equal((await c.call('/api/social/lookup?code=' + codeA)).person.id, a.id);
  assert.equal((await c.call('/api/friends/request', { code: codeA })).status, 'requested');
  assert.equal((await a.call('/api/social')).incoming.length, 1);
  // Ann asking Cat back counts as accepting.
  const hc = (await c.call('/api/social')).me.handle;
  assert.equal((await a.call('/api/friends/request', { handle: hc })).status, 'friends');

  // Ben shares with Ann (and tries Cat, who isn't his friend).
  const s = await b.call('/api/shares', { product_id: 'jbhifi:1', to: [a.id, c.id], note: 'Half price!' });
  assert.equal(s.sent, 1);
  const inbox = await a.call('/api/shares');
  assert.equal(inbox.shares[0].product.name, 'Dyson V8');
  assert.equal(inbox.shares[0].from.name, 'Ben');
  assert.equal(inbox.shares[0].note, 'Half price!');
  assert.equal((await a.call('/api/social')).unseenShares, 1);
  await a.call('/api/shares/seen', {});
  assert.equal((await a.call('/api/social')).unseenShares, 0);
  assert.equal((await c.call('/api/shares')).shares.length, 0);

  // Notifications for Ann: Ben's request, Cat's request, the share; each shown once.
  const n = await a.call('/api/notifications/pending');
  assert.deepEqual(n.notifications.map((x) => x.kind), ['friend_request', 'friend_request', 'share']);
  assert.match(n.notifications[2].title, /Ben shared Dyson V8/);
  assert.equal((await a.call('/api/notifications/pending')).notifications.length, 0);

  // Ann blocks Ben: his shares go, and he can't ask again (without being told he's blocked).
  await a.call(`/api/friends/${b.id}/block`, {});
  assert.equal((await a.call('/api/shares')).shares.length, 0);
  assert.equal((await b.call('/api/social')).friends.length, 0);
  assert.equal((await b.call('/api/friends/request', { handle: ha })).status, 'requested');
  assert.equal((await a.call('/api/social')).incoming.length, 0);
  assert.equal((await a.call('/api/social')).blocked[0].id, b.id);
  // Unblock (delete) → they can ask again.
  await a.call(`/api/friends/${b.id}`, null, 'DELETE');
  assert.equal((await b.call('/api/friends/request', { handle: ha })).status, 'requested');

  // A new QR code makes the old one stop working.
  await a.call('/api/social/code/new', {});
  assert.equal((await c.call('/api/social/lookup?code=' + codeA)).status, 404);
  assert.ok(env);
});
