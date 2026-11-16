// Automatic review of possible matches: name similarity, photo comparison, one partner per product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nameSimilarity, sameSize, decide } from '../pipeline/review.js';
import { describe, compare } from '../pipeline/image-sim.js';

const P = (id, name, brand = 'Acme', size = 500, extra = {}) => ({ id, retailer: id.split(':')[0], name, brand, size_value: size, size_unit: 'g', linkedTo: new Set(), ...extra });

test('name similarity: spelling variants pass 90%, different flavours do not', () => {
  const sim = (a, b) => nameSimilarity(P('woolworths:1', a), P('coles:1', b));
  assert.ok(sim('Acme Greek Style Yoghurt Vanilla 500g', 'Acme Greek Style Yogurt Vanilla') > 0.9);
  assert.ok(sim('Acme Diced Tomatoes Italian', 'Acme Italian Diced Tomato') > 0.9);
  assert.ok(sim('Acme Dishwashing Liquid Lemon', 'Acme Dishwashing Liquid Lime') <= 0.9);
  assert.ok(sim('Acme Crunchy Peanut Butter', 'Acme Smooth Peanut Butter') <= 0.9);
  assert.ok(sim('Acme Chicken Noodle Soup', 'Acme Chicken Soup With Vegetables') <= 0.9);
  assert.equal(sim('Acme Sliced Peach', 'Acme Sliced Peaches'), 1);
  assert.equal(sim('Acme Rice Crackers Original', 'Acme Original Rice Cracker'), 1);
  assert.ok(sim('Acme Tim Tam Original', 'Acme Tim Tam Original Double Coat') <= 0.9);
  assert.ok(sim('Acme Shampoo Dry Hair', 'Acme Shampoo Oily Hair') <= 0.9);
  assert.equal(sameSize(P('woolworths:1', 'x', 'Acme', 500), P('coles:1', 'x', 'Acme', 503)), true);
  assert.equal(sameSize(P('woolworths:1', 'x', 'Acme', 500), P('coles:1', 'x', 'Acme', 750)), false);
});

// A 32x32 "pack shot": white background, coloured body, a darker label band, optional shift and lighting change.
function photo({ body = [200, 30, 40], label = [250, 220, 60], shift = 0, gain = 1, wide = false } = {}) {
  const rgb = Buffer.alloc(32 * 32 * 3, 255);
  const [x0, x1] = wide ? [3, 29] : [9, 23];
  for (let y = 3; y < 30; y++) for (let x = x0 + shift; x < x1 + shift; x++) {
    const c = y > 12 && y < 20 ? label : body;
    for (let k = 0; k < 3; k++) rgb[(y * 32 + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k] * gain + ((x * 7 + y * 13) % 9) - 4)));
  }
  return describe(rgb);
}

test('photos: same pack is alike, another colour or another shape is not', () => {
  const base = photo();
  const same = compare(base, photo({ shift: 1, gain: 0.93 }));
  const flavour = compare(base, photo({ body: [40, 120, 200] }));
  const shape = compare(base, photo({ wide: true, label: [40, 40, 40] }));
  assert.ok(same.colour >= 0.85, JSON.stringify(same));
  assert.ok(flavour.colour < 0.8, JSON.stringify(flavour));
  assert.ok(shape.shape < same.shape, JSON.stringify(shape));
  assert.deepEqual(compare(base, base), { shape: 1, colour: 1 });
});

test('decide: all three checks, and one new partner per product', () => {
  const good = { shape: 0.9, colour: 0.95 }, bad = { shape: 0.9, colour: 0.5 };
  const w1 = P('woolworths:1', 'Acme Greek Style Yoghurt Vanilla'), c1 = P('coles:1', 'Acme Greek Style Yogurt Vanilla'), c2 = P('coles:2', 'Acme Greek Style Yoghurts Vanilla');
  const w2 = P('woolworths:2', 'Acme Diced Tomatoes Italian'), c3 = P('coles:3', 'Acme Italian Diced Tomato');
  const w3 = P('woolworths:3', 'Acme Sliced Beetroot'), c4 = P('coles:4', 'Acme Sliced Beetroots', 'Acme', 500, { linkedTo: new Set(['woolworths']) });
  const w4 = P('woolworths:4', 'Acme Corn Kernel'), c5 = P('coles:5', 'Acme Corn Kernels', 'Acme', 420);
  const { approve, reasons } = decide([
    { id: 1, a: w1, b: c1, sim: good },
    { id: 2, a: w1, b: c2, sim: { shape: 0.8, colour: 0.9 } },   // w1 again, weaker
    { id: 3, a: w2, b: c3, sim: bad },                             // colours differ
    { id: 4, a: w3, b: c4, sim: good },                            // c4 already has a Woolworths twin
    { id: 5, a: w4, b: c5, sim: good },                            // size differs
    { id: 6, a: P('woolworths:6', 'Acme Lemon Dish Liquid'), b: P('coles:6', 'Acme Lime Dish Liquid'), sim: good },
    { id: 7, a: P('woolworths:7', 'Acme Sliced Peach'), b: P('coles:7', 'Acme Sliced Peaches'), sim: null },
  ], { nameMin: 0.9, shapeMin: 0.7, colourMin: 0.85 });
  assert.deepEqual(approve.map((r) => r.id), [1]);
  assert.deepEqual(Object.fromEntries(reasons), {
    2: 'a better pair uses one of these products', 3: 'photos differ', 4: 'already linked to another product',
    5: 'size differs', 6: 'name not alike enough', 7: 'photo missing',
  });
});

import { computeMatches, scorePair, linkChanges } from '../pipeline/match.js';

test('matching: exact twin wins over a near one, numbers must agree, queue skips products that have a twin', () => {
  const p = (id, name, size = 180, extra = {}) => ({ id, retailer: id.split(':')[0], name, brand: 'Cadbury', size_value: size, size_unit: 'g', gtin: null, canonical_product_id: `c:${id}`, match_method: 'self', ...extra });
  const products = [
    // Loaded in an order that used to link "Dairy Milk" to "Dairy Milk Snack" first.
    p('coles:1', 'Cadbury Dairy Milk Snack Chocolate Block 180g'),
    p('coles:2', 'Cadbury Dairy Milk Chocolate Block 180g'),
    p('woolworths:1', 'Cadbury Dairy Milk Chocolate Block'),
    p('woolworths:2', 'Cadbury Dairy Milk Snack Chocolate Block'),
    // Different numbers: never the same product.
    p('woolworths:3', 'Cadbury Old Gold 70% Cocoa Dark Chocolate', 100), p('coles:3', 'Cadbury Old Gold Dark Chocolate 45% Cocoa 100g', 100),
    // Nobody has a twin yet and the names are only fairly alike: goes to the queue.
    p('woolworths:4', 'Cadbury Roses Chocolate Gift Tin', 225), p('coles:4', 'Cadbury Roses Chocolate Gift Assorted', 225),
  ];
  assert.equal(scorePair(products[4], products[5]), 0);
  const r = computeMatches(products);
  assert.equal(r.canonOf.get('woolworths:1'), r.canonOf.get('coles:2'));
  assert.equal(r.canonOf.get('woolworths:2'), r.canonOf.get('coles:1'));
  assert.notEqual(r.canonOf.get('woolworths:1'), r.canonOf.get('coles:1'));
  assert.notEqual(r.canonOf.get('woolworths:3'), r.canonOf.get('coles:3'));
  assert.deepEqual(r.candidates.map((c) => `${c.product_a}|${c.product_b}`), ['coles:4|woolworths:4']);
  const ch = linkChanges({ products, canonOf: r.canonOf });
  assert.deepEqual([ch.linkedBefore, ch.linkedAfter, ch.gained.length], [0, 2, 2]);
  // A pair a person rejected stays apart, and one they approved stays together.
  const again = computeMatches(products, new Set(['coles:2|woolworths:1']), [['coles:4', 'woolworths:4']]);
  assert.notEqual(again.canonOf.get('woolworths:1'), again.canonOf.get('coles:2'));
  assert.equal(again.canonOf.get('woolworths:4'), again.canonOf.get('coles:4'));
});

test('decide: near-identical photos let names 60% alike pass; otherwise they wait for a person', () => {
  const t = { nameMin: 0.9, shapeMin: 0.7, colourMin: 0.85, near: { nameMin: 0.6, shapeMin: 0.94, colourMin: 0.97 } };
  const pair = (id, a, b, sim) => ({ id, a: P(`woolworths:${id}`, a), b: P(`coles:${id}`, b), sim });
  const { approve, reasons } = decide([
    pair(1, 'Acme Macaroni No 38', 'Acme Macaroni Pasta No 38', { shape: 0.97, colour: 0.99 }),
    pair(2, 'Acme Country Grains Bread', 'Acme Country Grains Sandwich Slice Bread Loaf', { shape: 0.9, colour: 0.99 }),
    pair(3, 'Acme Sliced Peach', 'Acme Sliced Peaches', { shape: 0.8, colour: 0.9 }),
    pair(4, 'Acme Lemon Dish Liquid Fresh', 'Acme Lime Dish Liquid Burst', { shape: 1, colour: 1 }),
    pair(5, 'Acme Dark Chocolate 70% Cocoa', 'Acme Dark Chocolate 85% Cocoa', { shape: 1, colour: 1 }),
  ], t);
  assert.deepEqual(approve.map((r) => [r.id, r.strict]), [[3, true], [1, false]]);
  assert.deepEqual(Object.fromEntries(reasons), { 2: 'name under 90% and photos not near-identical', 4: 'name not alike enough', 5: 'numbers in the names differ' });
});
