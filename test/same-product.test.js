// Stage 7: "Same product in other stores" — compare, "not the same" hides it for that tester at once,
// Admin sees it as reported and "Different" splits the pair for everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';

test('not the same: hidden for me, reported to Admin, split by Admin', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-same-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const now = new Date().toISOString();
  for (const [id, r, price] of [['coles:1', 'coles', 300], ['woolworths:1', 'woolworths', 280], ['aldi:1', 'aldi', 250]]) {
    env.DB.raw.prepare("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, cur_price_cents, cur_captured_at, canonical_product_id) VALUES (?, ?, '1', 'Milk 2L', ?, ?, 'c:milk')").run(id, r, price, now);
  }
  const person = async (name, code = 'beta') => {
    const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code }) }), env);
    const cookie = res.headers.get('Set-Cookie').split(';')[0];
    return async (p, body) => { const r = await handle(new Request(`http://x${p}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env); return { status: r.status, ...(await r.json()) }; };
  };
  const ann = await person('Ann'), bob = await person('Bob'), admin = await person('Boss', 'admin');
  for (const who of [ann, bob]) { const { lists } = await who('/api/lists'); await who(`/api/lists/${lists[0].id}/items`, { product_id: 'coles:1' }); }
  const item = (await ann('/api/lists')).lists[0].items[0];
  assert.equal(item.offers.length, 3);
  const same = await ann(`/api/items/${item.id}/same`);
  assert.deepEqual(same.offers.map((o) => o.retailer), ['aldi', 'woolworths', 'coles']);

  await ann(`/api/items/${item.id}/not-same`, { product_id: 'aldi:1' });
  assert.equal((await ann('/api/lists')).lists[0].items[0].offers.length, 2, 'hidden for Ann');
  assert.equal((await bob('/api/lists')).lists[0].items[0].offers.length, 3, 'Bob still sees it');
  const hiddenNow = await ann(`/api/items/${item.id}/same`);
  assert.deepEqual(hiddenNow.hidden.map((o) => o.id), ['aldi:1'], 'listed under "Hidden", can be put back');

  // Undo: back in the comparison, report withdrawn.
  const del = await handle(new Request(`http://x/api/items/${item.id}/not-same/aldi:1`, { method: 'DELETE', headers: { Cookie: (await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Ann', code: 'beta' }) }), env)).headers.get('Set-Cookie').split(';')[0] } }), env);
  assert.equal(del.status, 200);
  assert.equal((await ann('/api/lists')).lists[0].items[0].offers.length, 3, 'put back');
  assert.equal((await admin('/api/admin/matches')).matches.filter((x) => x.status === 'reported').length, 0, 'report withdrawn');

  await ann(`/api/items/${item.id}/not-same`, { product_id: 'aldi:1' });

  const m = (await admin('/api/admin/matches')).matches;
  assert.equal(m[0].status, 'reported');
  await admin(`/api/admin/matches/${m[0].id}`, { action: 'reject' });
  assert.equal((await bob('/api/lists')).lists[0].items[0].offers.length, 2, 'split for everyone');
});

test('a pair marked Different is never linked again, not even through a third store', async () => {
  const { computeMatches } = await import('../pipeline/match.js');
  const P = (id, r) => ({ id, retailer: r, name: 'Pauls Full Cream Milk 2L', brand: 'Pauls', size_value: 2000, size_unit: 'ml', canonical_product_id: null });
  const prods = [P('aldi:1', 'aldi'), P('coles:1', 'coles'), P('woolworths:1', 'woolworths')];
  const all = computeMatches(prods).canonOf;
  assert.equal(new Set(all.values()).size, 1);
  const r = computeMatches(prods, new Set(['aldi:1|coles:1'])).canonOf;
  assert.notEqual(r.get('aldi:1'), r.get('coles:1'));
});
