// Product page: Google Shopping rows kept only when they are the same product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOnline, webQuery, ourRetailer } from '../shared/webmatch.js';

const p = { name: 'Life Space Broad Spectrum Probiotic Advanced 90 Capsules', brand: 'Life Space', size: '90 pack', effective: 3700 };
const r = (title, store, priceCents, extra = {}) => ({ title, store, priceCents, ...extra });

test('keeps the same product, drops other sizes, used, odd prices and our own stores', () => {
  const out = sameOnline(p, [
    r('Life-Space Broad Spectrum Probiotic Advanced 90 Caps', 'Amazon.com.au', 3495),
    r('Life Space Broad Spectrum Probiotic Advanced 90 Capsules', 'Priceline', 3999),
    r('Life Space Broad Spectrum Probiotic Advanced 90 Capsules', 'Priceline', 4199),
    r('Life Space Broad Spectrum Probiotic Advanced 30 Capsules', 'Amcal', 1999),
    r('Life Space Probiotic for Kids 90 caps', 'Amcal', 3000),
    r('Life Space Broad Spectrum Probiotic Advanced 90 Capsules', 'eBay', 2000, { used: true }),
    r('Life Space Broad Spectrum Probiotic Advanced 90 Capsules', 'Chemist Warehouse', 3299),
    r('Life Space Broad Spectrum Probiotic Advanced 90 Capsules', 'Coles', 3700),
    r('Life Space Broad Spectrum Probiotic Advanced 90 Capsules', 'Wholesale', 900),
    r('Swisse Probiotic Advanced 90 Capsules', 'Amazon.com.au', 3000),
    r('Life Space Broad Spectrum Probiotic 90 Capsules', 'eBay', 3195),
  ], ['coles']);
  assert.deepEqual(out.map((x) => [x.store, x.priceCents]), [['Chemist Warehouse', 3299], ['Amazon.com.au', 3495], ['Priceline', 3999]]);
  assert.equal(out[0].retailer, 'chemistwarehouse');
});

test('query and store names', () => {
  assert.equal(webQuery({ name: 'Bone Matrix', size: '120 Capsules' }), 'Bone Matrix 120 Capsules');
  assert.equal(webQuery({ name: 'Bone Matrix 120 Capsules', size: '120 capsules' }), 'Bone Matrix 120 Capsules');
  assert.equal(ourRetailer('JB Hi-Fi'), 'jbhifi');
  assert.equal(ourRetailer('Woolworths Online'), 'woolworths');
  assert.equal(ourRetailer('Amazon.com.au'), null);
});
