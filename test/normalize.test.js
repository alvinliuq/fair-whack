import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSize, unitPriceCents, parseMultibuy, comparableGroup, discountFlag, normaliseScraped, parseUses } from '../shared/normalize.js';
import { scorePair, computeMatches } from '../pipeline/match.js';
import { itemTriggered } from '../pipeline/alerts.js';
import { parseCsv } from '../shared/api.js';

test('sizes', () => {
  assert.deepEqual(parseSize('10 x 375ml'), { pack_count: 10, size_value: 3750, size_unit: 'ml' });
  assert.deepEqual(parseSize('1.2kg'), { pack_count: 1, size_value: 1200, size_unit: 'g' });
  assert.deepEqual(parseSize('2L'), { pack_count: 1, size_value: 2000, size_unit: 'ml' });
  assert.equal(parseSize('18 pack').size_unit, 'each');
  assert.equal(parseSize(null, 'Bananas per kg').size_value, 1000);
  assert.equal(unitPriceCents(310, 2000, 'ml'), 155);
  assert.equal(unitPriceCents(550, 200, 'g'), 275);
  assert.equal(parseUses('OMO Laundry Liquid 2L 40 Washes'), 40);
});

test('promotions', () => {
  assert.deepEqual(parseMultibuy('2 for $10'), { qty: 2, cents: 1000 });
  assert.deepEqual(parseMultibuy('Any 3 for $12.50'), { qty: 3, cents: 1250 });
  const r = normaliseScraped('coles', { productId: '1', name: 'X', price: 5, wasPrice: 10, isOnSpecial: true, isHalfPrice: true, size: '500g' });
  assert.equal(r.snapshot.promo_type, 'half_price');
  assert.equal(normaliseScraped('coles', { error: 'blocked' }), null);
});

test('comparable groups', () => {
  assert.equal(comparableGroup('Bega Smooth Peanut Butter', 'Bega', 'g'), 'peanut-butter');
  assert.equal(comparableGroup('Western Star Original Salted Butter', '', 'g'), 'butter');
  assert.equal(comparableGroup('Morning Fresh Dishwashing Liquid', '', 'ml'), 'dish-liquid');
});

test('discount flags', () => {
  const hist = [1, 2, 3, 4, 5].map((w) => ({ price_cents: 500, captured_at: new Date(Date.now() - w * 7 * 864e5).toISOString() }));
  assert.equal(discountFlag({ price_cents: 250, was_cents: 500 }, hist).flag, 'low12');
  assert.equal(discountFlag({ price_cents: 450, was_cents: 700 }, hist).flag, 'inflated');
  assert.equal(discountFlag({ price_cents: 250, was_cents: 500 }, hist.slice(0, 2)).flag, null);
});

test('matching', () => {
  const a = { id: 'coles:1', retailer: 'coles', brand: "Arnott's", name: "Arnott's Tim Tam Original", size_value: 200, size_unit: 'g' };
  const b = { id: 'woolworths:9', retailer: 'woolworths', brand: "Arnott's", name: "Arnott's Tim Tam Original 200g", size_value: 200, size_unit: 'g' };
  const c = { id: 'woolworths:10', retailer: 'woolworths', brand: "Arnott's", name: "Arnott's Tim Tam Double Coat 200g", size_value: 200, size_unit: 'g' };
  assert.equal(scorePair(a, b), 1);
  assert.ok(scorePair(a, c) < 0.9);
  const { assignments } = computeMatches([a, b, c]);
  const canon = Object.fromEntries(assignments.map((x) => [x.id, x.canonical_product_id]));
  assert.equal(canon['coles:1'], canon['woolworths:9']);
  assert.notEqual(canon['coles:1'], canon['woolworths:10']);
});

test('alert rules', () => {
  const offer = { cur_is_special: 1, cur_price_cents: 300, cur_promo_type: 'price_dropped' };
  assert.ok(itemTriggered({ alert_mode: 'any' }, offer));
  assert.ok(!itemTriggered({ alert_mode: 'half' }, offer));
  assert.ok(itemTriggered({ alert_mode: 'target', target_cents: 300 }, offer));
  assert.ok(!itemTriggered({ alert_mode: 'target', target_cents: 299 }, offer));
});

test('csv', () => {
  assert.deepEqual(parseCsv('a,"b, c",d\n1,2,3'), [['a', 'b, c', 'd'], ['1', '2', '3']]);
});
