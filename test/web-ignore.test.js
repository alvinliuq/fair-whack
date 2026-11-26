// Product page Google Shopping rail: same-product rows only, and a tester can ignore one shop's result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';

test('product web prices: filtered, and ignore is per tester', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-wig-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's', SERPAPI_KEY: 'k' };
  env.DB.raw.prepare("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, brand, cur_price_cents, cur_captured_at) VALUES ('coles:1', 'coles', '1', 'Life Space Probiotic Advanced 90 Capsules', 'Life Space', 3700, ?)").run(new Date().toISOString());
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ shopping_results: [
    { title: 'Life-Space Probiotic Advanced 90 Caps', source: 'eBay - kings', extracted_price: 35.9 },
    { title: 'Life Space Probiotic 90 Capsules', source: 'eBay', extracted_price: 31.95 },
    { title: 'Life Space Probiotic Advanced 90 Capsules', source: 'Priceline', extracted_price: 39.99 },
  ] }), { status: 200 });
  t.after(() => { globalThis.fetch = realFetch; });
  const login = async (name) => (await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code: 'beta' }) }), env)).headers.get('Set-Cookie').split(';')[0];
  const ann = await login('Ann'), bob = await login('Bob');
  const call = async (cookie, p, method = 'GET', body) => (await handle(new Request(`http://x${p}`, { method, headers: { Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env)).json();
  let d = await call(ann, '/api/product/coles%3A1/web');
  assert.deepEqual(d.results.map((r) => [r.store, r.ignored]), [['eBay - kings', false], ['Priceline', false]]);
  await call(ann, '/api/product/coles%3A1/web/ignore', 'PUT', { store: 'eBay - kings', on: true });
  d = await call(ann, '/api/product/coles%3A1/web');
  assert.deepEqual(d.results.map((r) => r.ignored), [true, false]);
  assert.deepEqual((await call(bob, '/api/product/coles%3A1/web')).results.map((r) => r.ignored), [false, false]);
  // Home: lowest anywhere, from saved Google results, less what this tester ignored (Ann ignores eBay - kings at $35.90).
  const low = async (cookie) => (await call(cookie, '/api/lowest?ids=coles%3A1')).lowest['coles:1'];
  assert.equal(await low(ann), true);
  assert.equal(await low(bob), false);
  await call(ann, '/api/product/coles%3A1/web/ignore', 'PUT', { store: 'eBay - kings', on: false });
  assert.deepEqual((await call(ann, '/api/product/coles%3A1/web')).results.map((r) => r.ignored), [false, false]);
});
