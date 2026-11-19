// FW1.2: per-store specials for the Home rail, barcode lookup, photo search.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeD1 } from '../dev/d1shim.js';
import { handle, barcodeForms } from '../shared/api.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function seededDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw12-'));
  const file = path.join(dir, 'test.db');
  execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', path.join(root, 'dev', 'seed.js')], { env: { ...process.env, LOCAL_DB: file, SEED_FIXTURE_DIR: path.join(dir, 'fixtures') }, stdio: 'pipe' });
  return file;
}

async function client(file, extra = {}) {
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's', ...extra };
  const login = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Rail Tester', code: 'beta' }) }), env);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const call = async (p, body) => {
    const r = await handle(new Request(`http://x${p}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, ...(await r.json()) };
  };
  return { env, call };
}

test('Home digest lists each store separately for items on special at both', async () => {
  const file = seededDb();
  const { env, call } = await client(file);
  const now = new Date().toISOString();
  // Two matched products (same canonical id), both on special.
  env.DB.raw.exec(`UPDATE retailer_product SET canonical_product_id = 'canon:test', cur_is_special = 1, cur_captured_at = '${now}', cur_was_cents = 500
    WHERE id IN (SELECT id FROM retailer_product WHERE retailer = 'woolworths' AND cur_price_cents IS NOT NULL LIMIT 1)
       OR id IN (SELECT id FROM retailer_product WHERE retailer = 'coles' AND cur_price_cents IS NOT NULL LIMIT 1)`);
  const [w] = env.DB.raw.prepare("SELECT id FROM retailer_product WHERE canonical_product_id = 'canon:test' AND retailer = 'woolworths'").all();
  const { lists } = await call('/api/lists');
  await call(`/api/lists/${lists[0].id}/items`, { product_id: w.id, alert_mode: 'any' });
  const d = await call('/api/digest');
  const mine = d.byStore.filter((o) => o.canonical === 'canon:test' || o.itemId);
  assert.equal(d.fromYourList.length, 1, 'one card per list item when both stores are shown');
  assert.deepEqual([...new Set(mine.map((o) => o.retailer))].sort(), ['coles', 'woolworths'], 'one offer per store for the toggles');
  assert.ok(mine.every((o) => o.itemId));
});

test('barcode forms cover EAN-13, UPC-A and GTIN-14', () => {
  assert.deepEqual(barcodeForms('036000291452').sort(), ['00036000291452', '0036000291452', '036000291452', '36000291452'].sort());
  assert.ok(barcodeForms('9300605000032').includes('09300605000032'));
  assert.deepEqual(barcodeForms('123'), []);
});

test('barcode lookup finds a product by GTIN, in any leading-zero form', async () => {
  const file = seededDb();
  const { env, call } = await client(file);
  const [p] = env.DB.raw.prepare("SELECT id FROM retailer_product WHERE retailer = 'coles' AND cur_price_cents IS NOT NULL LIMIT 1").all();
  env.DB.raw.prepare('UPDATE retailer_product SET gtin = ? WHERE id = ?').run('09300605000032', p.id);
  const r = await call('/api/search/barcode?code=9300605000032');
  assert.equal(r.found, true);
  assert.equal(r.productId, p.id);
  assert.equal((await call('/api/search/barcode?code=12')).status, 400);
});

test('photo search turns what the model reads into a query that finds products', async () => {
  const file = seededDb();
  const [row] = (await (async () => { const { env } = await client(file); return env.DB.raw.prepare("SELECT name, brand FROM retailer_product WHERE brand IS NOT NULL AND cur_price_cents IS NOT NULL AND retailer IN ('woolworths','coles') LIMIT 1").all(); })());
  const seen = [];
  const AI = { run: async (model, input) => { seen.push(model); return { response: `Sure: {"brand": "${row.brand}", "product": "${row.name} Extra Words Nobody Sells", "size": "999g"}` }; } };
  const { call } = await client(file, { AI });
  const tiny = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const r = await call('/api/search/photo', { image: tiny });
  assert.equal(r.found, true, JSON.stringify(r));
  assert.ok(r.query.length > 0);
  const s = await call(`/api/search?q=${encodeURIComponent(r.query)}&log=0`);
  assert.ok(s.groups.length > 0, 'the returned query finds products');
  assert.equal(seen[0], '@cf/meta/llama-3.2-11b-vision-instruct');
});

test('photo search: licence acceptance, nothing recognised, and no AI binding', async () => {
  const file = seededDb();
  let agreed = false;
  const AI = { run: async (model, input) => {
    if (input.prompt === 'agree') { agreed = true; return { response: 'ok' }; }
    if (!agreed) throw new Error('5016: Prior to using this model, you must submit the prompt "agree"');
    return { response: '{"brand": "", "product": "", "size": ""}' };
  } };
  const img = 'data:image/jpeg;base64,/9j/2Q==';
  const r = await (await client(file, { AI })).call('/api/search/photo', { image: img });
  assert.ok(agreed);
  assert.equal(r.found, false);
  const off = await (await client(file)).call('/api/search/photo', { image: img });
  assert.equal(off.status, 503);
});
