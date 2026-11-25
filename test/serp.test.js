// Stage 6: Google Shopping comparison — one lookup per keyword per 24 hours, capped, stopped at the hard budget limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';
import { BUDGET } from '../shared/budget.js';

test('Google Shopping lookups are cached per keyword and stop at the limits', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-serp-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's', SERPAPI_KEY: 'k' };
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    assert.match(String(u), /^https:\/\/serpapi\.com\/search\.json\?engine=google_shopping/);
    calls++;
    return new Response(JSON.stringify({ shopping_results: [
      { title: 'Dyson V8', source: 'Amazon.com.au', extracted_price: 499, extracted_old_price: 649, product_link: 'https://www.google.com/shopping/product/1' },
      { title: 'Dyson V8', source: 'The Good Guys', price: '$529.00', link: 'javascript:alert(1)' },
    ] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const login = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Ann', code: 'beta' }) }), env);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const get = async (q) => (await handle(new Request(`http://x/api/search/web?q=${encodeURIComponent(q)}`, { headers: { Cookie: cookie } }), env)).json();

  const a = await get('Dyson V8');
  assert.equal(a.cached, false);
  assert.equal(a.results.length, 2);
  assert.equal(a.results[0].priceCents, 49900);
  assert.equal(a.results[0].wasCents, 64900);
  assert.equal(a.results[1].link, null, 'only https links are kept');
  const b = await get('  dyson v8 ');
  assert.equal(b.cached, true, 'same keyword within 24 hours is not looked up again');
  assert.equal(calls, 1);

  // Hard budget stop: no new lookup; saved results still shown.
  env.DB.raw.prepare("INSERT INTO pipeline_runs (mode, started_at, status, cost_usd) VALUES ('catalogue', ?, 'ok', ?)").run(new Date().toISOString(), BUDGET.hardUsd);
  env.DB.raw.prepare("UPDATE serp_cache SET fetched_at = '2026-01-01T00:00:00Z'").run();
  const c = await get('dyson v8');
  assert.equal(c.stale, 'budget');
  assert.equal(c.results.length, 2);
  const d = await get('air fryer');
  assert.equal(d.unavailable, 'budget');
  assert.equal(calls, 1);
});
