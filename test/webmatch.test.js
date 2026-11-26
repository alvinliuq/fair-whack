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

test('electronics: colour in brackets and category words are optional, the model number is not', () => {
  const g = { name: 'Garmin VivoActive 5 Smart Watch (Blue/Blue Metallic)', brand: 'GARMIN', effective: 24800 };
  const out = sameOnline(g, [
    r('Garmin Vivoactive 5', 'RYDA', 24885),
    r('Garmin Vivoactive 5 GPS Smartwatch - Blue/Blue Metallic, A', 'CeX', 21000, { used: true }),
    r('Garmin Vivoactive 5 GPS Smartwatch', 'Harvey Store', 36224),
    r('Garmin Vivoactive 6 GPS Smartwatch', 'Shop Six', 30000),
    r('Garmin Fenix 5 Blue Smartwatch', 'Cash Converters', 14900),
    r('Garmin vivoactive 5 Power Bundle', 'Amazon', 180000),
  ], ['jbhifi']);
  assert.deepEqual(out.map((x) => x.store), ['RYDA', 'Harvey Store']);
});

test('query and store names', () => {
  assert.equal(webQuery({ name: 'Bone Matrix', size: '120 Capsules' }), 'Bone Matrix 120 Capsules');
  assert.equal(webQuery({ name: 'Bone Matrix 120 Capsules', size: '120 capsules' }), 'Bone Matrix 120 Capsules');
  assert.equal(ourRetailer('JB Hi-Fi'), 'jbhifi');
  assert.equal(ourRetailer('Woolworths Online'), 'woolworths');
  assert.equal(ourRetailer('Amazon.com.au'), null);
});

test('real Google titles: brand spelling, sub-range names, sizes not shown, editions', () => {
  const pick = (p, rows, have = []) => sameOnline(p, rows.map(([store, title, priceCents]) => ({ store, title, priceCents })), have).map((x) => `${x.sizeUnknown ? '?' : ''}${x.store}`);
  assert.deepEqual(pick({ name: 'Melrose FutureLab Bone Matrix 120 Capsules', brand: 'Melrose', effective: 2500 }, [
    ['Nourishing Apothecary', 'Melrose FutureLab Bone Matrix', 4995], ['AV', 'Melrose FutureLab | Testosterone Matrix', 4395], ['SM', "Melrose Origins Men's Optimal 120c", 3821]]), ['?Nourishing Apothecary']);
  assert.deepEqual(pick({ name: 'Nulax Natural Laxative Tablets With Prebiotic Senna + Aloe 40 Tablets', brand: 'Nu-Lax', effective: 699 }, [
    ['BVP', 'Nulax Natural Laxative with Prebiotic 40 Tablets', 650], ['K', 'Nu-Lax Natural Laxative Tablets with Senna & Prunes 40 Tablets', 780],
    ['E', '3 X Nu-lax Natural Laxative Tablets With Prebiotic 40 Tablets', 2000], ['N', 'Nu-Lax Natural Laxative With Prebiotic 180 Tablets', 1999]]), ['BVP']);
  assert.deepEqual(pick({ name: 'Grand Theft Auto VI', brand: 'GTA VI', effective: 12500 }, [
    ['EB Games Australia', 'Grand Theft Auto VI', 12995], ['JB', 'Grand Theft Auto VI - The Album', 9000], ['PS', 'Grand Theft Auto VI: Ultimate Edition - Sony PlayStation 5', 15995]], ['jbhifi']), ['EB Games Australia']);
});

test('a store name without Disc/Digital/Slim matches either; PS5 = PlayStation 5', () => {
  const out = sameOnline({ name: 'PS5 PlayStation 5 Console', brand: 'SONY COMP', effective: 49900 }, [
    { store: 'u-buy.com.au', title: 'Sony PlayStation 5 Console Digital Edition', priceCents: 76500 },
    { store: 'K', title: 'PlayStation 5 Digital Edition – 30th Anniversary Limited Edition Bundle', priceCents: 99900 },
  ], ['jbhifi']);
  assert.deepEqual(out.map((x) => x.store), ['u-buy.com.au']);
  assert.equal(sameOnline({ name: 'PlayStation 5 Slim Digital Console', effective: 70000 }, [{ store: 'X', title: 'PlayStation 5 Slim Disc Console', priceCents: 80000 }]).length, 0);
});
