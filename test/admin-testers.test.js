// Admin tester management: last active, remove (and block), allow back, merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-adm-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const now = new Date().toISOString();
  for (const id of ['coles:1', 'coles:2', 'coles:3']) {
    env.DB.raw.prepare("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, cur_price_cents, cur_captured_at) VALUES (?, 'coles', ?, ?, 100, ?)").run(id, id.split(':')[1], `Product ${id}`, now);
  }
  const person = async (name, code = 'beta') => {
    const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code }) }), env);
    const cookie = res.headers.get('Set-Cookie')?.split(';')[0];
    const call = async (p, body) => {
      const r = await handle(new Request(`http://x${p}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env);
      return { status: r.status, ...(await r.json()) };
    };
    return { status: res.status, body: await res.json(), call };
  };
  const add = async (who, productId) => { const { lists } = await who.call('/api/lists'); return who.call(`/api/lists/${lists[0].id}/items`, { product_id: productId }); };
  return { env, person, add };
}

test('last active is recorded, at most once an hour', async () => {
  const { env, person } = setup();
  const sam = await person('Sam Nguyen');
  await sam.call('/api/me');
  const first = env.DB.raw.prepare("SELECT last_active_at FROM users WHERE id = 'u:sam-nguyen'").get().last_active_at;
  assert.ok(first);
  await sam.call('/api/me');
  assert.equal(env.DB.raw.prepare("SELECT last_active_at FROM users WHERE id = 'u:sam-nguyen'").get().last_active_at, first);
  env.DB.raw.prepare("UPDATE users SET last_active_at = '2026-01-01T00:00:00.000Z'").run();
  await sam.call('/api/me');
  assert.ok(env.DB.raw.prepare("SELECT last_active_at FROM users WHERE id = 'u:sam-nguyen'").get().last_active_at > '2026-11');
});

test('only admins can manage testers, and not their own account', async () => {
  const { person } = setup();
  const boss = await person('Boss', 'admin');
  const sam = await person('Sam');
  assert.equal((await sam.call('/api/admin/users', { action: 'remove', id: 'u:boss' })).status, 403);
  assert.equal((await boss.call('/api/admin/users', { action: 'remove', id: 'u:boss' })).status, 400);
  assert.equal((await boss.call('/api/admin/users', { action: 'merge', id: 'u:boss', into: 'u:sam' })).status, 400);
  assert.equal((await boss.call('/api/admin/users', { action: 'remove', id: 'u:nobody' })).status, 404);
  assert.equal((await boss.call('/api/admin/users', { action: 'merge', id: 'u:sam', into: 'u:sam' })).status, 400);
});

test('remove: data deleted, signed out at once, name blocked until allowed back', async () => {
  const { env, person, add } = setup();
  const boss = await person('Boss', 'admin');
  const sam = await person('Sam Nguyen');
  await add(sam, 'coles:1');
  await sam.call('/api/search?q=product');
  assert.equal((await boss.call('/api/admin/users', { action: 'remove', id: 'u:sam-nguyen' })).ok, true);
  assert.equal((await sam.call('/api/me')).status, 401, 'existing session stops working');
  const count = (t, col = 'user_id') => env.DB.raw.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = 'u:sam-nguyen'`).get().n;
  assert.deepEqual([count('users', 'id'), count('lists'), count('search_history'), count('search_log')], [0, 0, 0, 0]);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM list_items').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM search_log').get().n, 1, 'the search still counts towards popular searches');
  const again = await person('sam  nguyen');
  assert.equal(again.status, 403);
  assert.match(again.body.error, /removed from the beta/);
  const o = await boss.call('/api/admin/overview');
  assert.deepEqual(o.removed.map((r) => r.name), ['Sam Nguyen']);
  assert.equal(o.users.some((u) => u.id === 'u:sam-nguyen'), false);
  await boss.call('/api/admin/users', { action: 'restore', id: 'u:sam-nguyen' });
  const back = await person('Sam Nguyen');
  assert.equal(back.status, 200);
  assert.equal((await back.call('/api/lists')).lists[0].items.length, 0, 'starts again with an empty list');
});

test('merge: lists, alerts and history move to one account', async () => {
  const { env, person, add } = setup();
  const boss = await person('Boss', 'admin');
  const a = await person('Sherry');
  const b = await person('Sherry Jia');
  await add(a, 'coles:1'); await add(a, 'coles:2');
  await add(b, 'coles:2'); await add(b, 'coles:3');
  await a.call('/api/lists', { name: 'Party', retailer: 'coles' });
  await a.call('/api/search?q=product'); await b.call('/api/search?q=product');
  await a.call('/api/profile', { ageRange: '25-34', gender: 'female', household: '3', favCategories: ['Pantry'] });
  env.DB.raw.prepare("UPDATE users SET created_at = '2026-11-01T00:00:00.000Z' WHERE id = 'u:sherry'").run();
  assert.equal((await boss.call('/api/admin/users', { action: 'merge', id: 'u:sherry', into: 'u:sherry-jia' })).ok, true);
  assert.equal((await a.call('/api/me')).status, 401, 'the merged-away name is signed out');
  const { lists } = await b.call('/api/lists');
  assert.deepEqual(lists.map((l) => l.name).sort(), ['My list', 'Party']);
  assert.deepEqual(lists.find((l) => l.name === 'My list').items.map((i) => i.product.id).sort(), ['coles:1', 'coles:2', 'coles:3']);
  const u = env.DB.raw.prepare("SELECT * FROM users WHERE id = 'u:sherry-jia'").get();
  assert.equal(u.age_range, '25-34');
  assert.equal(u.created_at, '2026-11-01T00:00:00.000Z');
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM search_log WHERE user_id = 'u:sherry-jia'").get().n, 2);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM search_history WHERE user_id = 'u:sherry-jia'").get().n, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM users").get().n, 2);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM lists WHERE user_id = 'u:sherry'").get().n, 0);
  assert.equal((await boss.call('/api/admin/overview')).removed.length, 0, 'a merged name is not blocked');
});
