// Design review code: separate accounts, not admin, ends when the secret is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-design-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', DESIGN_CODE: 'look', SESSION_SECRET: 's' };
  const login = async (name, code) => {
    const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code }) }), env);
    const cookie = res.headers.get('Set-Cookie')?.split(';')[0];
    const call = async (p) => { const r = await handle(new Request(`http://x${p}`, { headers: { Cookie: cookie } }), env); return { status: r.status, ...(await r.json()) }; };
    return { status: res.status, body: await res.json(), call };
  };
  return { env, login };
}

test('design code signs in to its own non-admin account', async () => {
  const { env, login } = setup();
  const sam = await login('Sam Nguyen', 'beta');
  const d = await login('Sam Nguyen', 'look');
  assert.equal(d.status, 200);
  assert.equal(d.body.user.id, 'd:sam-nguyen');
  assert.notEqual(d.body.user.id, sam.body.user.id);
  assert.equal(d.body.user.isAdmin, false);
  assert.equal(env.DB.raw.prepare("SELECT is_design FROM users WHERE id = 'd:sam-nguyen'").get().is_design, 1);
  assert.equal(env.DB.raw.prepare("SELECT is_design FROM users WHERE id = 'u:sam-nguyen'").get().is_design, 0);
  assert.equal((await d.call('/api/admin/overview')).status, 403);
});

test('removing the design code ends design sessions but not testers', async () => {
  const { env, login } = setup();
  const sam = await login('Sam Nguyen', 'beta');
  const d = await login('Design Review', 'look');
  assert.equal((await d.call('/api/me')).status, 200);
  delete env.DESIGN_CODE;
  assert.equal((await d.call('/api/me')).status, 401);
  assert.equal((await sam.call('/api/me')).status, 200);
  assert.equal((await login('Design Review', 'look')).status, 401);
});
