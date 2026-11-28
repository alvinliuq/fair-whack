// Every store page filter must load, whatever shape the store's categories come in (29 Nov: Bunnings "All products" failed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeD1 } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';
import { splitCategory, mapCategory, categoryLevels } from '../shared/normalize.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function seededDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-'));
  const file = path.join(dir, 'test.db');
  execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', path.join(root, 'dev', 'seed.js')], { env: { ...process.env, LOCAL_DB: file, SEED_FIXTURE_DIR: path.join(dir, 'fixtures') }, stdio: 'pipe' });
  return file;
}

test('Bunnings-style category paths become readable aisles and the right merged category', () => {
  assert.deepEqual(splitCategory('|tools|power-tools|drills|cordless-drill-kits|'), { cat1: 'Tools', cat2: 'Power Tools' });
  assert.deepEqual(categoryLevels('|outdoor-living|barbecue|bbq-accessories|'), ['Outdoor Living', 'Barbecue', 'BBQ Accessories']);
  // "bbq-accessories" once matched Clothing & Shoes ("accessories") because the whole path was read as one level.
  assert.equal(mapCategory('|outdoor-living|barbecue|bbq-accessories|bbq-cooking-utensils|', 'Jumbuck 7kg Lumpwood Charcoal BBQ Fuel', 'bunnings'), 'Home & Hardware');
  assert.deepEqual(categoryLevels('technology/office-supplies'), ['Technology', 'Office Supplies']);
  // Ordinary names are left exactly as they were.
  assert.deepEqual(splitCategory('Pantry > Breakfast > Cereal'), { cat1: 'Pantry', cat2: 'Breakfast' });
  assert.deepEqual(categoryLevels('Cards/Gift Wrap'), ['Cards/Gift Wrap']);
  assert.deepEqual(splitCategory(null), { cat1: 'Other', cat2: null });
});

test('a store with hundreds of aisles still loads every filter (D1: at most 100 bound values a query)', async () => {
  const file = seededDb();
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const login = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Aisle Tester', code: 'beta' }) }), env);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const call = async (p) => { const r = await handle(new Request(`http://x${p}`, { headers: { Cookie: cookie } }), env); return { status: r.status, ...(await r.json()) }; };
  // Give every Woolworths product its own aisle, like Bunnings' raw paths did (370 aisles).
  env.DB.raw.exec("UPDATE retailer_product SET retailer = 'woolworths', cat1 = 'Aisle ' || rowid");
  const aisles = (await call('/api/categories?retailer=woolworths')).categories.length;
  assert.ok(aisles > 50, `test needs more than 50 aisles, has ${aisles}`);
  for (const sort of ['all', 'special', 'half', 'popular', 'new', 'mine']) {
    const r = await call(`/api/browse?retailer=woolworths&sort=${sort}`);
    assert.equal(r.status, 200, `sort=${sort}: ${r.error || ''}`);
  }
});
