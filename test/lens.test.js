// "Search by product photo": empty Google Shopping still offers it; Google Lens runs only on request, keeps every
// AUD-priced shop (more than 5), leaves out stores we already read, and the saved result shows for everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle, lensResults } from '../shared/api.js';

test('lensResults keeps AUD-priced rows only, in Google order', () => {
  const rows = lensResults({ visual_matches: [
    { title: 'A', source: 'Shop A', link: 'https://a', price: { value: '$1,899.00', extracted_value: 1899, currency: '$' } },
    { title: 'B', source: 'Shop B', link: 'https://b', price: { value: '£999', extracted_value: 999, currency: '£' } },
    { title: 'C', source: 'Shop C', link: 'https://c' },
    { title: 'D used', source: 'Shop D', link: 'https://d', price: { extracted_value: 1200, currency: 'A$' } },
  ] });
  assert.deepEqual(rows.map((r) => [r.store, r.priceCents, r.used]), [['Shop A', 189900, false], ['Shop D', 120000, true]]);
});

test('product page: no Google Shopping match, then search by photo', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-lens-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's', SERPAPI_KEY: 'k' };
  env.DB.raw.prepare("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, brand, cur_price_cents, cur_captured_at, image_url) VALUES ('jbhifi:1', 'jbhifi', '1', 'HyperX OMEN 15 Gaming Laptop', 'HYPERX', 198800, ?, 'https://img.example/omen.jpg')").run(new Date().toISOString());
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = new URL(String(u));
    calls.push(url.searchParams.get('engine'));
    if (url.searchParams.get('engine') === 'google_lens') {
      assert.equal(url.searchParams.get('url'), 'https://img.example/omen.jpg');
      return new Response(JSON.stringify({ visual_matches: [
        ...Array.from({ length: 7 }, (_, i) => ({ title: `HP OMEN 15 ${i}`, source: `Shop ${i}`, link: `https://s${i}`, price: { extracted_value: 1900 + i, currency: '$' } })),
        { title: 'HyperX OMEN 15', source: 'JB Hi-Fi', link: 'https://jb', price: { extracted_value: 1988, currency: '$' } },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ shopping_results: [{ title: 'HP OMEN 15 Gaming Laptop 16GB 512GB', source: 'Shop X', extracted_price: 1999 }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const login = async (name) => (await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code: 'beta' }) }), env)).headers.get('Set-Cookie').split(';')[0];
  const ann = await login('Ann'), bob = await login('Bob');
  const call = async (cookie, p, method = 'GET') => (await handle(new Request(`http://x${p}`, { method, headers: { Cookie: cookie } }), env)).json();

  let d = await call(ann, '/api/product/jbhifi%3A1/web');
  assert.equal(d.results.length, 0);
  assert.equal(d.canLens, true);
  assert.equal(d.lens, null);
  assert.ok(!calls.includes('google_lens'), 'Lens only runs when asked');

  const l = await call(ann, '/api/product/jbhifi%3A1/lens', 'POST');
  assert.equal(l.results.length, 7, 'all shops, not capped at 5; JB Hi-Fi (ours) left out');
  assert.ok(!l.results.some((r) => r.store === 'JB Hi-Fi'));

  // Saved: Bob sees it with the page, and asking again costs no lookup.
  d = await call(bob, '/api/product/jbhifi%3A1/web');
  assert.equal(d.lens.results.length, 7);
  const before = calls.filter((c) => c === 'google_lens').length;
  await call(bob, '/api/product/jbhifi%3A1/lens', 'POST');
  assert.equal(calls.filter((c) => c === 'google_lens').length, before);
});
