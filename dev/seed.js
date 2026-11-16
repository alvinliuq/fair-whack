// Builds Apify-shaped sample data, runs the real pipeline on it against a local DB,
// and adds 8 weeks of back-dated price history so discount flags can be tested.
// Usage: node --experimental-sqlite dev/seed.js   (writes dev/local.db)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { migrate } from './d1shim.js';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dbFile = process.env.LOCAL_DB || path.join(root, 'dev', 'local.db');
const fx = process.env.SEED_FIXTURE_DIR || path.join(root, 'dev', 'fixtures'); // tests point this at a temp folder
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
fs.mkdirSync(fx, { recursive: true });
migrate(dbFile);

// [brand, name, size, wooliesPrice, colesPrice, category]
const BASE = [
  ['Arnott\'s', 'Tim Tam Original Chocolate Biscuits', '200g', 5.5, 5.5, 'Snacks & Confectionery'],
  ['Arnott\'s', 'Tim Tam Double Coat Chocolate Biscuits', '200g', 5.5, 5.5, 'Snacks & Confectionery'],
  ['Cadbury', 'Dairy Milk Chocolate Block', '180g', 6.5, 6.5, 'Snacks & Confectionery'],
  ['Smith\'s', 'Crinkle Cut Potato Chips Original', '170g', 4.95, 4.95, 'Snacks & Confectionery'],
  ['a2', 'Full Cream Milk', '2L', 6.1, 6.1, 'Dairy, Eggs & Fridge'],
  ['Pauls', 'Full Cream Milk', '2L', 4.6, 4.6, 'Dairy, Eggs & Fridge'],
  ['Devondale', 'Long Life Full Cream Milk', '1L', 2.2, 2.2, 'Pantry'],
  ['Western Star', 'Original Salted Butter', '500g', 7.0, 7.2, 'Dairy, Eggs & Fridge'],
  ['Mainland', 'Tasty Cheese Block', '500g', 9.5, 9.5, 'Dairy, Eggs & Fridge'],
  ['Chobani', 'Greek Yogurt Plain', '907g', 8.0, 8.0, 'Dairy, Eggs & Fridge'],
  ['Sunny Queen', 'Free Range Eggs 12 Pack', '700g', 7.4, 7.4, 'Dairy, Eggs & Fridge'],
  ['Tip Top', 'The One White Sandwich Bread', '700g', 4.3, 4.3, 'Bakery'],
  ['Helga\'s', 'Wholemeal Bread', '750g', 5.6, 5.6, 'Bakery'],
  ['Sanitarium', 'Weet-Bix Wheat Biscuits', '1.2kg', 7.4, 7.4, 'Pantry'],
  ['Uncle Tobys', 'Traditional Rolled Oats', '1kg', 5.0, 5.0, 'Pantry'],
  ['Barilla', 'Spaghetti No.5 Pasta', '500g', 3.3, 3.3, 'Pantry'],
  ['SunRice', 'Jasmine Rice', '5kg', 17.0, 17.5, 'Pantry'],
  ['Moccona', 'Classic Medium Roast Instant Coffee', '400g', 30.0, 30.0, 'Pantry'],
  ['Nescafe', 'Blend 43 Instant Coffee', '500g', 27.0, 27.0, 'Pantry'],
  ['Lipton', 'Quality Black Tea Bags 100 Pack', '200g', 6.0, 6.0, 'Drinks'],
  ['Coca-Cola', 'Classic Soft Drink Cans 10x375ml', '10 x 375ml', 21.0, 21.0, 'Drinks'],
  ['Mount Franklin', 'Sparkling Mineral Water', '1.25L', 2.3, 2.3, 'Drinks'],
  ['Heinz', 'Baked Beans in Tomato Sauce', '420g', 2.2, 2.25, 'Pantry'],
  ['John West', 'Tuna in Springwater', '95g', 2.5, 2.5, 'Pantry'],
  ['Kraft', 'Smooth Peanut Butter', '375g', 5.0, 5.0, 'Pantry'],
  ['Cobram Estate', 'Extra Virgin Olive Oil', '750ml', 18.0, 18.0, 'Pantry'],
  ['Birds Eye', 'Garden Peas Frozen', '1kg', 4.5, 4.5, 'Freezer'],
  ['Streets', 'Blue Ribbon Vanilla Ice Cream', '2L', 8.0, 8.0, 'Freezer'],
  ['Quilton', '3 Ply Toilet Tissue 18 Pack', '18 pack', 15.0, 15.0, 'Household'],
  ['Sorbent', 'Toilet Tissue 2 Ply 12 Pack', '12 pack', 9.0, 9.0, 'Household'],
  ['OMO', 'Active Clean Front & Top Loader Laundry Liquid 2L 40 Washes', '2L', 22.0, 22.0, 'Household'],
  ['Finish', 'Quantum Dishwasher Tablets 60 Pack', '60 pack', 39.0, 39.0, 'Household'],
  ['Morning Fresh', 'Dishwashing Liquid Original', '900ml', 6.0, 6.0, 'Household'],
  ['Colgate', 'Total Original Toothpaste', '200g', 9.0, 9.0, 'Health & Beauty'],
  ['Huggies', 'Ultra Dry Nappies Size 4 Boy 50 Pack', '50 pack', 30.0, 30.0, 'Baby'],
  ['Bega', 'Smooth Peanut Butter', '470g', 6.5, 6.5, 'Pantry'],
];
const HOUSE = {
  woolworths: [
    ['Woolworths', 'Full Cream Milk', '2L', 3.1, 'Dairy, Eggs & Fridge'],
    ['Woolworths', 'Free Range Eggs 12 Pack', '600g', 5.5, 'Dairy, Eggs & Fridge'],
    ['Woolworths', 'White Sandwich Bread', '650g', 2.5, 'Bakery'],
    ['Woolworths', 'Smooth Peanut Butter', '375g', 2.9, 'Pantry'],
    ['Woolworths', 'Toilet Tissue 3 Ply 18 Pack', '18 pack', 9.5, 'Household'],
    ['Woolworths', 'Spaghetti Pasta', '500g', 1.1, 'Pantry'],
  ],
  coles: [
    ['Coles', 'Full Cream Milk', '2L', 3.1, 'Dairy, Eggs & Fridge'],
    ['Coles', 'Australian Free Range Eggs 12 Pack', '600g', 5.5, 'Dairy, Eggs & Fridge'],
    ['Coles', 'White Sandwich Bread', '650g', 2.5, 'Bakery'],
    ['Coles', 'Crunchy Peanut Butter', '375g', 2.9, 'Pantry'],
    ['Coles', '3 Ply Toilet Tissue 18 Pack', '18 pack', 9.0, 'Household'],
    ['Coles', 'Spaghetti Pasta', '500g', 1.1, 'Pantry'],
  ],
};
const FRESH = [
  ['', 'Cavendish Bananas', 'per kg', 3.9, 4.0, 'Fruit & Veg'],
  ['', 'Pink Lady Apples', 'per kg', 6.9, 6.5, 'Fruit & Veg'],
  ['', 'Brushed Potatoes', '2kg', 5.5, 5.0, 'Fruit & Veg'],
  ['', 'RSPCA Approved Chicken Breast Fillets', '1kg', 13.0, 13.0, 'Meat, Seafood & Deli'],
  ['', 'Beef Mince 3 Star', '500g', 7.0, 7.0, 'Meat, Seafood & Deli'],
];

// Deterministic weekly promotions.
const PROMO = {
  'Tim Tam Original Chocolate Biscuits': { woolworths: 'half', coles: null },
  'Tim Tam Double Coat Chocolate Biscuits': { woolworths: 'half', coles: 'half' },
  'Dairy Milk Chocolate Block': { woolworths: null, coles: 'half' },
  'Crinkle Cut Potato Chips Original': { woolworths: 'multi', coles: 'half' },
  'Traditional Rolled Oats': { woolworths: 'drop', coles: null },
  'Classic Medium Roast Instant Coffee': { woolworths: 'half', coles: null },
  'Blend 43 Instant Coffee': { woolworths: null, coles: 'drop' },
  'Classic Soft Drink Cans 10x375ml': { woolworths: 'drop', coles: 'drop' },
  'Active Clean Front & Top Loader Laundry Liquid 2L 40 Washes': { woolworths: 'half', coles: null },
  'Quantum Dishwasher Tablets 60 Pack': { woolworths: null, coles: 'half' },
  'Ultra Dry Nappies Size 4 Boy 50 Pack': { woolworths: 'drop', coles: null },
  'Extra Virgin Olive Oil': { woolworths: null, coles: 'drop' },
  'Blue Ribbon Vanilla Ice Cream': { woolworths: 'half', coles: 'half' },
  'Total Original Toothpaste': { woolworths: 'half', coles: null },
  'Greek Yogurt Plain': { woolworths: null, coles: 'multi' },
  '3 Ply Toilet Tissue 18 Pack': { woolworths: 'drop', coles: null },
};

let pid = 1000;
const idOf = new Map();
function item(retailer, [brand, name, size, price, category], promo) {
  const key = `${retailer}|${brand}|${name}|${size}`;
  if (!idOf.has(key)) idOf.set(key, String(++pid));
  const productId = idOf.get(key);
  const full = brand ? `${brand} ${name} | ${size}` : `${name} | ${size}`;
  const it = {
    productId, name: retailer === 'coles' ? (brand ? `${brand} ${name}` : name) : full.replace(' | ', ' '), brand: brand || null, size,
    url: retailer === 'coles' ? `https://www.coles.com.au/product/${productId}` : `https://www.woolworths.com.au/shop/productdetails/${productId}`,
    image: null, price, wasPrice: null, isOnSpecial: false, isHalfPrice: false, promotionType: null, promotionText: null,
    unitPrice: null, unitPriceText: null, isAvailable: true, category: `${category} > Sample`, barcode: null,
    source: 'category', scrapedAt: new Date().toISOString(),
  };
  if (promo === 'half') Object.assign(it, { wasPrice: price, price: Math.round(price * 50) / 100, isOnSpecial: true, isHalfPrice: true, promotionType: 'Half Price', promotionText: '1/2 Price' });
  if (promo === 'drop') Object.assign(it, { wasPrice: price, price: Math.round(price * 80) / 100, isOnSpecial: true, promotionType: retailer === 'coles' ? 'Down Down' : 'Prices Dropped', promotionText: retailer === 'coles' ? 'Down Down' : 'Prices Dropped' });
  if (promo === 'multi') {
    const two = Math.round(price * 2 * 0.7);
    Object.assign(it, { isOnSpecial: true, promotionType: 'Multi Buy', promotionText: `2 for $${two}` });
  }
  return it;
}

function catalogue(retailer) {
  const r = retailer === 'woolworths' ? 3 : 4;
  return [
    ...BASE.map((b) => item(retailer, [b[0], b[1], b[2], b[r], b[5]], PROMO[b[1]]?.[retailer] || null)),
    ...HOUSE[retailer].map((h) => item(retailer, h, PROMO[h[1]]?.[retailer] || null)),
    ...FRESH.map((f) => item(retailer, [f[0], f[1], f[2], f[r], f[5]], null)),
  ];
}
for (const r of ['woolworths', 'coles']) {
  const all = catalogue(r);
  fs.writeFileSync(path.join(fx, `catalogue_${r}_0.json`), JSON.stringify(all, null, 1));
  const specials = all.filter((x) => x.isOnSpecial);
  fs.writeFileSync(path.join(fx, `specials_${r}_0.json`), JSON.stringify(specials.filter((x) => x.isHalfPrice)));
  fs.writeFileSync(path.join(fx, `specials_${r}_1.json`), JSON.stringify(specials));
}

const run = (...a) => execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', path.join(root, 'pipeline', 'run.js'), ...a], {
  env: { ...process.env, LOCAL_DB: dbFile, APIFY_FIXTURE_DIR: fx }, stdio: 'inherit',
});
run('first');

// Back-dated history: 8 weekly snapshots at regular price (+ a fake "was" inflation for one item).
const db = new DatabaseSync(dbFile);
const products = db.prepare('SELECT id, name, cur_price_cents, cur_was_cents, cur_unit_cents, cur_unit_basis FROM retailer_product').all();
const ins = db.prepare('INSERT INTO price_snapshot (product_id, price_cents, was_cents, unit_cents, unit_basis, is_special, in_stock, price_context, source, captured_at) VALUES (?, ?, NULL, ?, ?, 0, 1, ?, ?, ?)');
for (const p of products) {
  const regular = p.cur_was_cents || p.cur_price_cents;
  for (let w = 1; w <= 8; w++) {
    const t = new Date(Date.now() - w * 7 * 86400000).toISOString();
    // Olive oil "was" price is inflated: it really sold at 14.00 for weeks.
    const price = /Olive Oil/.test(p.name) && p.id.startsWith('coles') ? 1400 : regular;
    ins.run(p.id, price, p.cur_unit_cents, p.cur_unit_basis, 'default', 'scraper', t);
  }
}
// Aldi sample (as if imported from the admin CSV) and one Costco report.
db.close();
run('specials'); // re-run so flags see the history
console.log('Seeded', dbFile);
