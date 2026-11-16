// Search index: same answers as the old full scan, and the cheap paths stay cheap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeD1 } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';
import { indexWords, searchTokens, packId, unpackId, buildIndexRows, pickIds, PART_SIZE } from '../shared/search-index.js';
import { localDb } from '../pipeline/d1.js';
import { syncWordIndex, loadIndexProducts, indexIsCurrent } from '../pipeline/search-index.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function seededDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-'));
  const file = path.join(dir, 'test.db');
  execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', path.join(root, 'dev', 'seed.js')], { env: { ...process.env, LOCAL_DB: file, SEED_FIXTURE_DIR: path.join(dir, 'fixtures') }, stdio: 'pipe' });
  return file;
}

async function client(file) {
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const login = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Index Tester', code: 'beta' }) }), env);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const get = async (p) => (await handle(new Request(`http://x${p}`, { headers: { Cookie: cookie } }), env)).json();
  const post = async (p, body) => (await handle(new Request(`http://x${p}`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(body) }), env)).json();
  return { env, get, post };
}

test('words and ids', () => {
  assert.deepEqual([...indexWords("Tim Tam Original 200g", "Arnott's")].sort(), ['200g', 'arnott', 'arnotts', 'original', 'tam', 'tim']);
  assert.deepEqual(searchTokens('  Tim  t TIM '), ['tim']);
  for (const id of ['woolworths:123456', 'coles:9876543', 'aldi:some-slug-500g', 'costco:x', 'other:1']) assert.equal(unpackId(packId(id)), id);
  assert.equal(packId('woolworths:123456'), 'w123456');
});

test('long word lists are split into parts and found again', () => {
  const products = Array.from({ length: PART_SIZE + 5 }, (_, i) => ({ id: `coles:${i}`, name: `Milk ${i % 2 ? 'Chocolate' : 'Plain'}`, brand: null }));
  const rows = [...buildIndexRows(products).values()];
  assert.equal(rows.filter((r) => r.word === 'milk').length, 2);
  const per = (t) => rows.filter((r) => r.word.startsWith(t));
  assert.equal(pickIds(['mil'], [per('mil')], 1e6).length, PART_SIZE + 5);
  assert.equal(pickIds(['mil', 'choc'], [per('mil'), per('choc')], 1e6).length, Math.floor((PART_SIZE + 5) / 2));
  assert.deepEqual(pickIds(['mil', 'zzz'], [per('mil'), []], 10), []);
});

test('index search returns the same products as the full scan', async () => {
  const file = seededDb();
  const { env, get } = await client(file);
  const db = await localDb(file);
  assert.equal(await indexIsCurrent(db), true, 'seed (pipeline match) builds the index');
  const queries = ['milk', 'tim tam', 'tim ta', 'full cream milk', 'woolworths', 'coles bread', 'peanut', 'toilet tissue', 'a2', 'arnotts', 'zzzz', 'ch', 'co mi', 'nappies size 4'];
  const ids = (d) => (d.groups || []).flatMap((g) => g.offers.map((o) => o.id)).sort();
  const sugg = (d) => d.suggestions.map((s) => `${s.kind}:${s.text}`);
  const withIndex = {};
  for (const q of queries) withIndex[q] = { s: await get(`/api/search?q=${encodeURIComponent(q)}&log=0`), g: await get(`/api/suggest?q=${encodeURIComponent(q)}`) };
  assert.ok(ids(withIndex.milk.s).length > 3);
  assert.ok(ids(withIndex.arnotts.s).length > 0, '"arnotts" finds Arnott\'s');
  // Remove the index: the API falls back to the scan.
  env.DB.raw.exec("DELETE FROM word_index; DELETE FROM app_meta WHERE key = 'search_index_at'");
  for (const q of queries) {
    if (q === 'arnotts') continue; // new behaviour, the scan never matched this
    const s = await get(`/api/search?q=${encodeURIComponent(q)}&log=0`);
    assert.deepEqual(ids(withIndex[q].s), ids(s), `search "${q}"`);
    assert.deepEqual(withIndex[q].s.groups.map((g) => g.id), s.groups.map((g) => g.id), `order "${q}"`);
    assert.deepEqual(new Set(sugg(withIndex[q].g)), new Set(sugg(await get(`/api/suggest?q=${encodeURIComponent(q)}`))), `suggest "${q}"`);
  }
});

test('sync only writes what changed', async () => {
  const file = seededDb();
  const db = await localDb(file);
  const products = await loadIndexProducts(db);
  assert.deepEqual((({ written, removed }) => ({ written, removed }))(await syncWordIndex(db, products)), { written: 0, removed: 0 });
  products[0] = { ...products[0], name: `${products[0].name} Zebracake` };
  const r = await syncWordIndex(db, products);
  assert.equal(r.written, 1);
  const back = await syncWordIndex(db, await loadIndexProducts(db));
  assert.deepEqual({ written: back.written, removed: back.removed }, { written: 0, removed: 1 });
});

test('heavy screens are answered from the cache, and the digest matches list items', async () => {
  const file = seededDb();
  const { env, get, post } = await client(file);
  const first = await get('/api/deals');
  assert.ok(first.items.length > 0);
  // Prove the second answer comes from api_cache: wipe the specials and ask again.
  env.DB.raw.exec('UPDATE retailer_product SET cur_is_special = 0');
  assert.deepEqual(await get('/api/deals'), first);
  assert.deepEqual((await get('/api/meta')).retailers.map((r) => r.specials), [0, 0]);
  env.DB.raw.exec('DELETE FROM api_cache');
  assert.equal((await get('/api/deals')).items.length, 0);

  // Digest: put every Woolworths product on a list, then compare with the original one-query version.
  const f2 = seededDb();
  const c2 = await client(f2);
  const raw = c2.env.DB.raw;
  const { lists } = await c2.get('/api/lists');
  for (const p of raw.prepare("SELECT id FROM retailer_product WHERE retailer = 'woolworths'").all()) await c2.post(`/api/lists/${lists[0].id}/items`, { product_id: p.id });
  const old = raw.prepare(`
    SELECT DISTINCT li.id AS item_id, o.id AS offer_id
      FROM list_items li JOIN lists l ON l.id = li.list_id
      JOIN retailer_product p ON p.id = li.product_id
      JOIN retailer_product o ON (o.id = p.id OR (p.canonical_product_id IS NOT NULL AND o.canonical_product_id = p.canonical_product_id))
     WHERE o.cur_is_special = 1 AND o.retailer IN ('woolworths','coles') AND (l.retailer IS NULL OR l.retailer = o.retailer)`).all();
  const d = await c2.get('/api/digest');
  assert.ok(old.length > 10);
  assert.equal(d.fromYourList.length, new Set(old.map((r) => r.item_id)).size, 'one best offer per list item on special');
  for (const o of d.fromYourList) assert.ok(old.some((r) => r.offer_id === o.id));
  assert.ok(d.fromYourList.some((o) => o.retailer === 'coles'), 'a matched Coles special beats the Woolworths price');
  assert.equal(d.topHalfPrice.length > 0, true);
});
