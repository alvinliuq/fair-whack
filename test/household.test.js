// FW2.0 household profile: saving, validation, sync with sign-up answers, progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';
import { SECTIONS, progress, cleanSection } from '../public/household.js';

async function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-house-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name: 'Ann Lee', code: 'beta' }) }), env);
  const cookie = res.headers.get('Set-Cookie').split(';')[0];
  const call = async (method, p, b) => {
    const r = await handle(new Request(`http://x${p}`, { method, headers: { Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }), env);
    return { status: r.status, ...(await r.json()) };
  };
  await call('POST', '/api/profile', { ageRange: '35-44', gender: 'female', household: '4', favCategories: ['Pantry'] });
  return { env, call };
}

test('member 1 comes from sign-up; saving members updates household size', async () => {
  const { env, call } = await setup();
  let r = await call('GET', '/api/household');
  assert.equal(r.status, 200);
  assert.deepEqual(r.answers.members, [{ gender: 'female', age: '35-44' }]);
  assert.equal(r.household, '4');
  r = await call('PUT', '/api/household/about', { answers: {
    members: [{ gender: 'female', age: '45-54' }, { gender: 'male', age: '45-54' }, { gender: 'na', age: '5-12' }],
    pets: ['dog', 'none'], address: { line: '1 Main St', suburb: 'Bentleigh East', postcode: '3165' }, junk: 1,
  } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.answers.pets, ['none'], 'No pets clears the others');
  assert.equal(r.answers.junk, undefined);
  const u = env.DB.raw.prepare("SELECT age_range, household_size FROM users WHERE id = 'u:ann-lee'").get();
  assert.equal(u.age_range, '45-54');
  assert.equal(u.household_size, '3');
});

test('child age bands are refused for member 1', () => {
  const c = cleanSection('about', { members: [{ gender: 'male', age: '5-12' }] });
  assert.equal(c.members[0].age, '');
});

test('bills: hidden follow-ups and bad values are dropped', async () => {
  const { call } = await setup();
  const r = await call('PUT', '/api/household/bills', { answers: {
    home_type: 'house', bedrooms: '3', elec_retailer: 'AGL', ac_type: 'split', ac_units: { indoor: 3, outdoor: 'x' },
    ev: { has: 'no', count: 2 }, home_office: { has: 'yes', people: '2', days: '3' }, elec_bill: { amount: '412.5', days: 91 },
    has_gas: 'no', gas_retailer: 'Origin',
  } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.answers.ac_units, { indoor: 3 });
  assert.deepEqual(r.answers.ev, { has: 'no' });
  assert.deepEqual(r.answers.home_office, { has: 'yes', people: '2', days: '3' });
  assert.deepEqual(r.answers.elec_bill, { amount: 412.5, days: 91 });
  const bills = SECTIONS.find((s) => s.id === 'bills');
  const p = progress(bills, r.answers);
  assert.ok(p.total < bills.questions.length, 'gas follow-ups are not counted without gas');
});

test('progress counts shown questions and stars', () => {
  const about = SECTIONS.find((s) => s.id === 'about');
  const empty = progress(about, {});
  assert.equal(empty.total, 8);
  assert.equal(empty.starsLeft, 3);
  const full = progress(about, { members: [{ gender: 'male', age: '25-34' }], daytime: 'rarely', address: { line: 'x', postcode: '3000' } });
  assert.equal(full.unlocked, true);
});

test('clearing a section keeps sign-up answers', async () => {
  const { call } = await setup();
  await call('PUT', '/api/household/fuel', { answers: { vehicles: [{ name: 'Car', fuel: 'u91', tank: '55', freq: '1w' }] } });
  const r = await call('DELETE', '/api/household/fuel');
  assert.equal(r.answers.vehicles, undefined);
  assert.equal(r.answers.members[0].gender, 'female');
});

test('address keeps a map position only inside Victoria', () => {
  const ok = cleanSection('about', { address: { line: '1 Main St', postcode: '3165', lat: -37.92, lng: 145.08, placeId: 'ChIJabcdefghij' } });
  assert.deepEqual(ok.address, { line: '1 Main St', suburb: '', postcode: '3165', lat: -37.92, lng: 145.08, placeId: 'ChIJabcdefghij' });
  const far = cleanSection('about', { address: { line: '1 George St', postcode: '2000', lat: -33.86, lng: 151.2 } });
  assert.equal(far.address.lat, undefined);
});

test('pet counts and an other food preference are kept only for chosen options', () => {
  const c = cleanSection('about', { pets: ['dog', 'cat'], pets_count: { dog: '2', cat: '9', fish: '1' }, diet: ['other'], diet_other: '  Halal  ' });
  assert.deepEqual(c.pets_count, { dog: '2', cat: '1' });
  assert.equal(c.diet_other, 'Halal');
  assert.equal(cleanSection('about', { diet: ['none'], diet_other: 'x' }).diet_other, undefined);
});
