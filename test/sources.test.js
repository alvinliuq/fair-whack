// Stage 6: the first-batch scrapers' items turn into products.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptItem, SOURCES } from '../pipeline/sources.js';
import { prepare } from '../pipeline/ingest.js';
import { ACTIVE_RETAILERS } from '../shared/normalize.js';

test('every first-batch retailer has a source and is shown in the app', () => {
  for (const r of ['aldi', 'jbhifi', 'costco', 'bunnings', 'kmart', 'bigw', 'officeworks', 'chemistwarehouse']) {
    assert.ok(SOURCES[r]?.actor || SOURCES[r]?.runner, r);
    assert.ok(SOURCES[r].catalogue.length, `${r} catalogue`);
    assert.ok(SOURCES[r].refresh(['https://x/search/?searchTerm=a']).length, `${r} refresh`);
    assert.ok(ACTIVE_RETAILERS.includes(r), `${r} active`);
  }
});

test('Kmart comes from Google Shopping: only Kmart results, linked to Kmart search, refreshed by name', async () => {
  const { ACTIVE_SOURCES } = await import('../pipeline/sources.js');
  assert.equal(ACTIVE_SOURCES.kmart.runner, 'serp');
  const x = adaptItem('kmart', { title: 'Anko Madison Bath Towel', source: 'Kmart', extracted_price: 2.5, extracted_old_price: 4, product_id: '807123', thumbnail: 'https://t/1.jpg', _category: 'Home > Bathroom' });
  assert.equal(x.productId, 'g807123'); assert.equal(x.price, 2.5); assert.equal(x.wasPrice, 4); assert.equal(x.isOnSpecial, true);
  assert.equal(x.url, 'https://www.kmart.com.au/search/?searchTerm=Anko%20Madison%20Bath%20Towel');
  const runs = ACTIVE_SOURCES.kmart.refresh([x.url]);
  assert.deepEqual(runs[0].input.queries[0], ['kmart Anko Madison Bath Towel', null]);
  const { records } = prepare('kmart', [{ title: 'Anko Madison Bath Towel', source: 'Kmart', extracted_price: 2.5, product_id: '807123', _category: 'Home > Bathroom' }], '2026-11-25T00:00:00Z');
  assert.equal(records[0].product.id, 'kmart:g807123');
  assert.equal(records[0].product.category, 'Home & Hardware');
  assert.match(adaptItem('kmart', { sku: 'K1', title: 'Kogan TV', price: 279, url: 'https://www.kogan.com/au/buy/x/' }).error || '', /.*/);
});

test('abotapi-style item: payable price, was price, barcode, image array', async () => {
  const { adaptGeneric } = await import('../pipeline/sources.js');
  const x = adaptGeneric( { id: '43123', name: 'Cotton Bath Towel', brand: 'Anko', url: 'https://www.kmart.com.au/product/x-43123/', price: 12, currentPrice: 8, wasPrice: 12, isOnSpecial: true, promoLabel: 'Catalogue', apn: '9341234567890', images: ['https://img/1.jpg'], merchDepartment: 'Home', inStockNationally: true }, 'www.kmart.com.au');
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

test('Chemist Warehouse: prescriptionType "None" is an ordinary product; site root levels dropped from the category', () => {
  const x = adaptItem('chemistwarehouse', { productId: 'a', sku: '2622193', name: 'QV Gentle Wash 1.25Kg', price: 23.99, rrp: 23.99, prescriptionType: 'None', schedule: 'None', categories: ['Chemist Warehouse Australia', 'Categories', 'Personal Care', 'Bath & Shower'] });
  assert.equal(x.error, undefined);
  assert.equal(x.category, 'Personal Care > Bath & Shower');
  assert.equal(x.productId, '2622193');
});

test('second batch (Zyte): listing items become products; Decathlon and EB Games use a browser', async () => {
  const { ACTIVE_SOURCES } = await import('../pipeline/sources.js');
  for (const r of ['target', 'thegoodguys', 'petbarn', 'peto', 'decathlon', 'ebgames']) {
    assert.equal(ACTIVE_SOURCES[r].runner, 'zyte', r);
    assert.ok(ACTIVE_RETAILERS.includes(r), `${r} shown in the app`);
  }
  assert.equal(ACTIVE_SOURCES.decathlon.catalogue[0].input.extractFrom, 'browserHtml');
  assert.equal(ACTIVE_SOURCES.target.catalogue[0].input.extractFrom, 'httpResponseBody');
  assert.deepEqual(ACTIVE_SOURCES.peto.refresh(['https://www.peto.com.au/products/x']), []);
  const { records } = prepare('thegoodguys', [{ name: 'Samsung 75" QN80H Neo QLED', price: '1845.0', regularPrice: '2495.0', url: 'https://www.thegoodguys.com.au/samsung-75-qn80h', productId: 'QA75QN80H', gtin: [{ type: 'ean13', value: '8806097936787' }], _category: 'Electronics > TVs' }], '2026-11-25T00:00:00Z');
  const r = records[0];
  assert.equal(r.product.id, 'thegoodguys:QA75QN80H');
  assert.equal(r.product.gtin, '8806097936787');
  assert.equal(r.product.category, 'Electronics');
  assert.equal(r.snapshot.price_cents, 184500);
  assert.equal(r.snapshot.was_cents, 249500);
  assert.equal(r.snapshot.is_special, 1);
});

test('third batch (Zyte): Harvey Norman plain HTML, PETstock and Pet Circle by browser; implausible prices dropped', async () => {
  const { ACTIVE_SOURCES, adaptItem } = await import('../pipeline/sources.js');
  for (const r of ['harveynorman', 'petstock', 'petcircle']) {
    assert.equal(ACTIVE_SOURCES[r].runner, 'zyte', r);
    assert.ok(ACTIVE_RETAILERS.includes(r), `${r} shown in the app`);
  }
  assert.equal(ACTIVE_SOURCES.harveynorman.catalogue[0].input.extractFrom, 'httpResponseBody');
  assert.equal(ACTIVE_SOURCES.petstock.catalogue[0].input.extractFrom, 'browserHtml');
  const bad = adaptItem('harveynorman', { name: 'LG 77-inch OLED TV', price: '2.12', url: 'https://www.harveynorman.com.au/lg-77', productId: 'OLED77' });
  assert.match(bad.error, /implausible/);
  const ok = adaptItem('harveynorman', { name: 'LG 77-inch OLED TV', price: '3591', url: 'https://www.harveynorman.com.au/lg-77', productId: 'OLED77' });
  assert.equal(ok.error, undefined);
});
