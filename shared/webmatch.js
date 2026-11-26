// Google Shopping on the product page: keep only rows that look like the same product (same brand, nearly all
// the name's words, the same pack numbers), drop used items and prices far from ours, and drop stores we already
// read ourselves for this product (our own data is fresher). One row per shop, cheapest first.
import { normText } from './normalize.js';
import { RETAILER_INFO } from './retailers.js';

const STOP = new Set(['and', 'the', 'with', 'for', 'of', 'in', 'a', 'pack', 'x', 'new']);
// Category words Google titles often leave out or write differently ("Smart Watch" / "Smartwatch"): not required.
const GENERIC = new Set(['smart', 'watch', 'smartwatch', 'gps', 'fitness', 'tracker', 'wireless', 'bluetooth', 'headphones', 'earbuds',
  'speaker', 'phone', 'mobile', 'tablet', 'laptop', 'notebook', 'tv', 'television', 'console', 'game', 'edition', 'version', 'device', 'unit']);
// Words for the same unit, so "90 Capsules" matches "90 caps".
const UNIT = { capsules: 'cap', capsule: 'cap', caps: 'cap', cap: 'cap', tablets: 'tab', tablet: 'tab', tabs: 'tab', tab: 'tab',
  softgels: 'cap', softgel: 'cap', grams: 'g', gram: 'g', litre: 'l', litres: 'l', liter: 'l', ml: 'ml', kg: 'kg', g: 'g', l: 'l', pk: 'pk' };
const words = (s) => normText(s).replace(/(\d)([a-z])/g, '$1 $2').split(' ').filter(Boolean).map((w) => UNIT[w] || w);
/** Pack numbers ("90", "500 g" → "500g") that must also appear in a matching title. */
function numbers(ws) {
  const out = new Set();
  ws.forEach((w, i) => { if (/^\d+(\.\d+)?$/.test(w)) out.add(w + (['g', 'kg', 'ml', 'l'].includes(ws[i + 1]) ? ws[i + 1] : '')); });
  return out;
}
export const storeKey = (s) => normText(s).replace(/\b(pty|ltd|au|australia|online|com)\b/g, '').replace(/\s+/g, '');
const OURS = Object.entries(RETAILER_INFO).map(([id, r]) => [id, storeKey(r.name)]);
export const ourRetailer = (store) => { const k = storeKey(store || ''); return k ? (OURS.find(([, n]) => k === n || k.startsWith(n))?.[0] || null) : null; };

/** The words to look the product up by on Google Shopping. */
export function webQuery(p) {
  const name = String(p.name || '');
  const size = p.size && !normText(name).includes(normText(p.size)) ? ` ${p.size}` : '';
  return `${name}${size}`.trim();
}

export function sameOnline(p, results, haveRetailers = []) {
  const want = words(`${p.name} ${p.size || ''}`);
  const nums = numbers(want);
  const brand = words(p.brand || '').filter((w) => !STOP.has(w));
  // Words in brackets are usually the colour or style ("(Blue/Blue Metallic)"): not required either.
  const core = words(String(p.name || '').replace(/\([^)]*\)/g, ' '));
  const key = [...new Set(core.filter((w) => !STOP.has(w) && !GENERIC.has(w) && !/^\d/.test(w) && !['cap', 'tab', 'g', 'kg', 'ml', 'l', 'pk'].includes(w)))];
  const price = p.effective || p.price || 0;
  const best = new Map();
  for (const r of results || []) {
    if (r.used || !r.priceCents) continue;
    const mine = ourRetailer(r.store);
    if (mine && haveRetailers.includes(mine)) continue;
    const t = words(r.title);
    const ts = new Set(t);
    if (brand.length && !brand.every((w) => ts.has(w))) continue;
    // Every other word of the name: one missing word is often the variant ("Advanced", "Kids", "Plus").
    // A word may also sit joined to the next one in the title ("vivoactive" in "vivoactive5").
    const joined = t.join('');
    if (!key.every((w) => ts.has(w) || (w.length >= 5 && joined.includes(w)))) continue;
    const tn = numbers(t);
    if ([...nums].some((n) => !tn.has(n))) continue;
    if (price && (r.priceCents < price * 0.4 || r.priceCents > price * 2.5)) continue;
    const k = storeKey(r.store || r.title);
    if (!best.has(k) || r.priceCents < best.get(k).priceCents) best.set(k, { ...r, retailer: mine, storeKey: k });
  }
  return [...best.values()].sort((a, b) => a.priceCents - b.priceCents).slice(0, 8);
}
