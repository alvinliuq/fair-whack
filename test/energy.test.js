// FW2.0b Bills: plan normalisation, usage model, costs and the estimate endpoint, using real AER plan details as fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';
import { normalizePlan, electricityUsage, electricityGrid, electricityCost, gasUsage, gasMonthly, gasCost, eligible, compare } from '../shared/energy.js';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/energy-${n}.json`, import.meta.url))).data;
const AGL_E = normalizePlan(fx(3)), TOU_E = normalizePlan(fx(0)), AGL_G = normalizePlan(fx(4)), ALINTA_E = normalizePlan(fx(5));

test('normalises single rate, time of use, controlled load and seasonal gas blocks', () => {
  assert.equal(AGL_E.fuel, 'E');
  assert.equal(AGL_E.periods[0].supply, 1.08290909);
  assert.equal(AGL_E.clRate, 0.15690909);
  assert.equal(TOU_E.periods[0].tou.length, 3);
  assert.equal(AGL_G.periods.length, 2);
  assert.ok(AGL_G.periods[0].single.length > 2, 'gas block rates');
  assert.ok(Math.abs(AGL_G.periods[0].single[0].v - 3000 / 60.875) < 0.01, 'block volume per day from a 2-month period');
});

test('a flat plan costs supply plus usage, with GST', () => {
  const u = { loads: [{ kwh: 4000, months: Array(12).fill(1 / 12), shape: Array(48).fill(1 / 48), cl: false }], solarKwh: 0, batteryKwh: 0 };
  const c = electricityCost(ALINTA_E, electricityGrid(u));
  const rate = ALINTA_E.periods[0].single[0].p, sup = ALINTA_E.periods[0].supply;
  const expect = (4000 * rate + sup * 365.25) * 1.1;
  assert.ok(Math.abs(c.total - expect) < 2, `${c.total} vs ${expect}`);
});

test('time of use: evening-heavy use costs more than midday use', () => {
  const at = (h) => { const s = Array(48).fill(0); s[h * 2] = 1; return s; };
  const mk = (h) => ({ loads: [{ kwh: 3000, months: Array(12).fill(1 / 12), shape: at(h), cl: false }], solarKwh: 0 });
  assert.ok(electricityCost(TOU_E, electricityGrid(mk(18))).total > electricityCost(TOU_E, electricityGrid(mk(13))).total);
});

test('usage grows with people, air conditioning and an EV; solar lowers imports', () => {
  const base = { members: [{}, {}], home_type: 'house', bedrooms: '3', daytime: 'rarely' };
  const sum = (u) => u.loads.reduce((x, l) => x + l.kwh, 0);
  const two = sum(electricityUsage(base));
  assert.ok(sum(electricityUsage({ ...base, members: [{}, {}, {}, {}] })) > two);
  assert.ok(sum(electricityUsage({ ...base, ac_type: 'split', ac_units: { indoor: 3 } })) > two);
  assert.ok(sum(electricityUsage({ ...base, ev: { has: 'yes', km: 300 } })) > two + 2000);
  const g0 = electricityGrid(electricityUsage(base)), g1 = electricityGrid(electricityUsage({ ...base, solar: { has: 'yes', kw: 6.6 } }));
  const tot = (g) => g.grid.flat().reduce((a, b) => a + b, 0);
  assert.ok(tot(g1) < tot(g0) && g1.exp.flat().reduce((a, b) => a + b, 0) > 0);
});

test('gas: heating, hot water and cooking add up; no gas means no usage', () => {
  const a = { has_gas: 'yes', members: [{}, {}, {}], gas_heating: 'ducted', heating_use: { months: '3-4', hours: '4-6' }, gas_hot_water: 'instant', cooktop: 'gas', cooking: '6-10' };
  const mj = gasMonthly(gasUsage(a)).reduce((x, y) => x + y, 0);
  assert.ok(mj > 20000 && mj < 60000, String(mj));
  assert.equal(gasUsage({ has_gas: 'no' }).loads.length, 0);
  assert.ok(gasCost(AGL_G, gasMonthly(gasUsage(a))).total > 500);
});

test('eligibility: solar-only plans need solar', () => {
  assert.equal(eligible(AGL_E, { solar: false }), false, 'AGL Solar Savers asks for solar');
  assert.equal(eligible(AGL_E, { solar: true }), true);
});

test('a bill calibrates usage and becomes the current cost', () => {
  const a = { members: [{}, {}], home_type: 'house', bedrooms: '3', hot_water: 'heat_pump', elec_bill: { amount: 450, days: 90 } };
  const r = compare('E', [ALINTA_E, TOU_E], a, '2');
  assert.equal(r.current.basis, 'bill');
  assert.equal(r.current.total, Math.round((450 / 90) * 365));
  assert.ok(r.usage.fromBill && r.best.length >= 1);
});

test('estimate endpoint: needs an address, then compares plans for the postcode', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-energy-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Ann', code: 'beta' }) }), env);
  const cookie = res.headers.get('Set-Cookie').split(';')[0];
  const call = async (m, p, b) => { const r = await handle(new Request(`http://x${p}`, { method: m, headers: { Cookie: cookie }, body: b && JSON.stringify(b) }), env); return { status: r.status, ...(await r.json()) }; };
  await call('POST', '/api/profile', { ageRange: '35-44', gender: 'female', household: '3', favCategories: ['Pantry'] });
  assert.equal((await call('GET', '/api/bills/estimate')).needAddress, true);
  for (const n of [0, 3, 4, 5, 6]) {
    const d = fx(n), m = normalizePlan(d);
    env.DB.raw.prepare('INSERT INTO energy_plan (id, brand, fuel, networks, postcodes, model, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, d.brand, m.fuel, `|${d.geography.distributors.join('|')}|`, `,${d.geography.includedPostcodes.join(',')},`, JSON.stringify(m), 'x');
  }
  await call('PUT', '/api/household/about', { answers: { members: [{ gender: 'female', age: '35-44' }, {}, {}], address: { line: '1 A St', postcode: '3165' }, daytime: 'sometimes' } });
  await call('PUT', '/api/household/bills', { answers: { home_type: 'house', bedrooms: '3', elec_retailer: 'AGL', ac_type: 'split', hot_water: 'gas', has_gas: 'yes', gas_retailer: 'agl', gas_heating: 'ducted', gas_hot_water: 'instant' } });
  const h = await call('GET', '/api/household');
  assert.equal(h.answers.elec_retailer, 'agl', 'old retailer names map to AER codes');
  const e = await call('GET', '/api/bills/estimate?fuel=elec');
  assert.equal(e.status, 200);
  assert.ok(e.networks.length >= 1 && e.best.length >= 1, JSON.stringify(e).slice(0, 300));
  const g = await call('GET', '/api/bills/estimate?fuel=gas');
  assert.ok(g.best.length >= 1);
  if (e.networks.length > 1) {
    await call('POST', '/api/bills/network', { fuel: 'elec', network: e.networks[1] });
    assert.equal((await call('GET', '/api/bills/estimate?fuel=elec')).network, e.networks[1]);
  }
});

test('time-varying feed-in pays the high rate only in its window', () => {
  const plan = { ...ALINTA_E, fit: [{ b: [{ p: 0.45, v: null }], win: [[127, 18 * 60, 21 * 60]] }, { b: [{ p: 0.03, v: null }], win: [[127, 0, 18 * 60], [127, 21 * 60, 1440]] }] };
  const u = electricityUsage({ members: [{}], home_type: 'house', bedrooms: '3', daytime: 'rarely', solar: { has: 'yes', kw: 6.6 } });
  const c = electricityCost(plan, electricityGrid(u));
  const exported = electricityGrid(u).exp.flat().reduce((a, b) => a + b, 0);
  assert.ok(c.fit < exported * 0.05, `credit ${c.fit} for ${exported} kWh should be near the 3c rate`);
});

test('battery and EV plans need a battery or an EV', () => {
  const p = { ...ALINTA_E, elig: [] };
  assert.equal(eligible({ ...p, name: 'Battery Earner' }, {}), false);
  assert.equal(eligible({ ...p, name: 'Battery Earner' }, { battery: true }), true);
  assert.equal(eligible({ ...p, name: 'EV Plan' }, {}), false);
});
