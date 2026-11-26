// Home "On special from your list", All stores: an item on special somewhere shows at its lowest price anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';

test('digest returns the lowest current price for list items on special elsewhere', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-dig-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const now = new Date().toISOString(), old = new Date(Date.now() - 10 * 86400000).toISOString();
  const ins = env.DB.raw.prepare(`INSERT INTO retailer_product (id, retailer, retailer_product_id, name, cur_price_cents, cur_was_cents, cur_is_special, cur_captured_at, canonical_product_id) VALUES (?, ?, ?, 'Probiotic 90', ?, ?, ?, ?, 'c1')`);
  ins.run('chemistwarehouse:1', 'chemistwarehouse', '1', 4799, 7399, 1, now);
  ins.run('coles:1', 'coles', '1', 3700, null, 0, old);
  ins.run('woolworths:1', 'woolworths', '1', 3700, null, 0, old);
  // Older than 14 days: not used, even though cheaper.
  ins.run('aldi:1', 'aldi', '1', 2000, null, 0, new Date(Date.now() - 20 * 86400000).toISOString());
  const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Al', code: 'beta' }) }), env);
  const cookie = res.headers.get('Set-Cookie').split(';')[0];
  const call = async (p, body) => (await handle(new Request(`http://x${p}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env)).json();
  const list = (await call('/api/lists')).lists[0];
  const item = await call(`/api/lists/${list.id}/items`, { product_id: 'chemistwarehouse:1' });
  const d = await call('/api/digest');
  assert.equal(d.byStore.length, 1, 'only Chemist Warehouse is on special');
  const low = Object.values(d.lowest)[0];
  assert.equal(low.effective, 3700, 'lowest price anywhere');
  assert.ok(['coles', 'woolworths'].includes(low.retailer));
  assert.ok(item);
});
