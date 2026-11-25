// Stage 6: the first-batch scrapers' items turn into products.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptItem, SOURCES } from '../pipeline/sources.js';
import { prepare } from '../pipeline/ingest.js';
import { ACTIVE_RETAILERS } from '../shared/normalize.js';

test('every first-batch retailer has a source and is shown in the app', () => {
  for (const r of ['aldi', 'jbhifi', 'costco', 'bunnings', 'kmart', 'bigw', 'officeworks', 'chemistwarehouse']) {
    assert.ok(SOURCES[r]?.actor, r);
    assert.ok(SOURCES[r].catalogue.length, `${r} catalogue`);
    assert.ok(SOURCES[r].refresh(['https://x/p/1']).length, `${r} refresh`);
    assert.ok(ACTIVE_RETAILERS.includes(r), `${r} active`);
  }
});

test('Kmart item: payable price, was price, barcode, image array', () => {
  const x = adaptItem('kmart', { id: '43123', name: 'Cotton Bath Towel', brand: 'Anko', url: 'https://www.kmart.com.au/product/x-43123/', price: 12, currentPrice: 8, wasPrice: 12, isOnSpecial: true, promoLabel: 'Catalogue', apn: '9341234567890', images: ['https://img/1.jpg'], merchDepartment: 'Home', inStockNationally: true });
  assert.equal(x.productId, '43123'); assert.equal(x.price, 8); assert.equal(x.wasPrice, 12); assert.equal(x.isOnSpecial, true);
  assert.equal(x.barcode, '9341234567890'); assert.equal(x.image, 'https://img/1.jpg'); assert.equal(x.category, 'Home');
});

test('Bunnings item: no was price, category path array', () => {
  const x = adaptItem('bunnings', { code: '0299323', name: 'XU1 18V Brushless Drill Driver Kit', brand: 'Ozito', url: 'https://www.bunnings.com.au/x_p0299323', price: 49.98, wasPrice: null, isOnSpecial: false, images: ['https://b/1.jpg'], categoryPath: ['Tools', 'Power Tools', 'Drills'] });
  assert.equal(x.productId, '0299323'); assert.equal(x.wasPrice, null); assert.equal(x.isOnSpecial, false);
  assert.equal(x.category, 'Tools > Power Tools > Drills');
  const { records } = prepare('bunnings', [{ code: '0299323', name: 'XU1 18V Drill', brand: 'Ozito', price: 49.98, categoryPath: ['Tools', 'Power Tools'] }], '2026-11-25T00:00:00Z');
  assert.equal(records[0].product.id, 'bunnings:0299323');
  assert.equal(records[0].product.category, 'Home & Hardware');
});

test('JB Hi-Fi item (dromb): discount price is the price, list price the was price', () => {
  const x = adaptItem('jbhifi', { id: '804803', sku: '804803', name: 'Sony 65" Bravia TV', brand: 'Sony', price: 2495, discount_price: 1995, current_price: 1995, image: 'https://jb/i.jpg', url: '/products/sony-65', category: 'TVs', in_stock: true });
  assert.equal(x.price, 1995); assert.equal(x.wasPrice, 2495); assert.equal(x.url, 'https://www.jbhifi.com.au/products/sony-65');
  const { records } = prepare('jbhifi', [{ id: '1', sku: '804803', name: 'Sony 65" Bravia TV', price: 2495, current_price: 1995, category: 'TVs' }], '2026-11-25T00:00:00Z');
  assert.equal(records[0].product.category, 'Electronics');
  assert.equal(records[0].snapshot.is_special, 1);
});

test('Costco members-only prices and Chemist Warehouse prescription medicines are left out', () => {
  assert.match(adaptItem('costco', { code: '1', name: 'Coffee beans', price: null, priceHidden: true }).error, /members-only/);
  assert.match(adaptItem('chemistwarehouse', { productId: 2, sku: '2', name: 'Script med', price: 10, prescriptionType: 'Prescription' }).error, /prescription/);
  const ok = adaptItem('chemistwarehouse', { productId: 3, sku: '3', name: 'Swisse Vitamin C', price: 15, rrp: 30, wasPrice: 30, isOnSpecial: true, categories: ['Vitamins', 'Vitamin C'] });
  assert.equal(ok.error, undefined); assert.equal(ok.wasPrice, 30);
});

test('Woolworths and Coles items pass through unchanged', () => {
  const it = { productId: '1', name: 'Milk', price: 3 };
  assert.equal(adaptItem('woolworths', it), it);
});
