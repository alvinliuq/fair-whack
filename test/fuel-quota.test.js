// FW2.0c: paid Google fuel searches are counted and capped (monthly for everyone, daily per tester).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';

test('fuel search allowance: daily per tester, monthly for all', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-quota-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's', FUEL_DAILY_LIMIT: '3', FUEL_MONTHLY_LIMIT: '5' };
  const who = async (name) => {
    const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code: 'beta' }) }), env);
    const cookie = res.headers.get('Set-Cookie').split(';')[0];
    return async (m, b) => { const r = await handle(new Request('http://x/api/fuel/quota', { method: m, headers: { Cookie: cookie }, body: b && JSON.stringify(b) }), env); return { status: r.status, ...(await r.json()) }; };
  };
  const ann = await who('Ann'), bob = await who('Bob');
  for (let i = 0; i < 3; i++) assert.equal((await ann('POST', { calls: 1 })).status, 200);
  assert.equal((await ann('POST', { calls: 1 })).status, 429, 'Ann hits her daily limit');
  assert.equal((await bob('POST', { calls: 2 })).status, 200);
  const r = await bob('POST', { calls: 1 });
  assert.equal(r.status, 429, 'month is used up');
  assert.match(r.error, /month/);
  assert.equal((await bob('GET')).usedMonth, 5);
});
