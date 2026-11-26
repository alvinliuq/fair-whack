// Google Shopping on the product page: keep only rows that look like the same product, drop used items, multipacks
// and prices far from ours, and drop stores we already read ourselves for this product (our data is fresher).
// One row per shop, cheapest first. A row whose title gives no pack size is kept and marked sizeUnknown
// ("Size not shown" on the page; it still counts for "Lowest").
import { normText } from './normalize.js';
import { RETAILER_INFO } from './retailers.js';

const STOP = new Set(['and', 'the', 'with', 'for', 'of', 'in', 'a', 'pack', 'x', 'new', 'buy', 'by', 'to', 'on']);
// Category words Google titles often leave out or write differently ("Smart Watch" / "Smartwatch"): not counted.
const GENERIC = new Set(['smart', 'watch', 'smartwatch', 'gps', 'fitness', 'tracker', 'wireless', 'bluetooth', 'headphones', 'earbuds',
  'speaker', 'phone', 'mobile', 'tablet', 'laptop', 'notebook', 'tv', 'television', 'console', 'game', 'version', 'device', 'unit',
  'powder', 'supplement', 'supplements', 'vege', 'veg', 'vegan', 'vc', 'oral', 'sports', 'health', 'support']);
// Words that make a different product: if one side has it, the other must too.
const VARIANT = new Set(['advanced', 'plus', 'max', 'ultra', 'extra', 'forte', 'double', 'triple', 'kids', 'children',
  'junior', 'baby', 'women', 'men', 'senior', 'pro', 'mini', 'lite', 'slim', 'digital', 'disc', 'deluxe', 'ultimate',
  'bundle', 'refill', 'sample', 'trial', 'album', 'vinyl', 'cd', 'lp', 'soundtrack', 'key', 'code', 'gift', 'account', 'prune',
  'gummies', 'liquid', 'spray', 'chewable', 'effervescent']);
const VARIANT_OF = { advance: 'advanced', kid: 'kids', womens: 'women', mens: 'men', prunes: 'prune', gummy: 'gummies' };
const vNorm = (w) => VARIANT_OF[w] || w;
// Model versions a store may leave out of its own name ("PS5 Console" without Disc/Digital/Slim): required in the
// title only when our product names one.
const ONE_WAY = new Set(['digital', 'disc', 'slim']);
// Short names Google titles spell out.
const SYN = [[/\bps5\b/g, 'playstation 5'], [/\bps4\b/g, 'playstation 4'], [/\bxsx\b/g, 'xbox series x']];
// Words for the same unit, so "90 Capsules" matches "90 caps".
const UNIT = { capsules: 'cap', capsule: 'cap', caps: 'cap', cap: 'cap', tablets: 'tab', tablet: 'tab', tabs: 'tab', tab: 'tab', t: 'tab', c: 'cap',
  softgels: 'cap', softgel: 'cap', grams: 'g', gram: 'g', litre: 'l', litres: 'l', liter: 'l', ml: 'ml', kg: 'kg', g: 'g', l: 'l', pk: 'pk', pc: 'pk' };
const UNITS = new Set(['cap', 'tab', 'g', 'kg', 'ml', 'l', 'pk']);
const words = (s) => SYN.reduce((x, [re, to]) => x.replace(re, to), normText(s)).replace(/(\d)([a-z])/g, '$1 $2').split(' ').filter(Boolean).map((w) => UNIT[w] || w);
/** Pack numbers ("90", "500 g" → "500g"). */
function numbers(ws) {
  const out = new Set();
  ws.forEach((w, i) => { if (/^\d+(\.\d+)?$/.test(w)) out.add(w + (['g', 'kg', 'ml', 'l'].includes(ws[i + 1]) ? ws[i + 1] : '')); });
  return out;
}
const MULTI = /(^|[\s^])\d+\s*x\s|\bx\s*\d+\s*(pack|pk)\b|\b(duo|twin)\s*(pack|set)\b/i;
export const storeKey = (s) => normText(s).replace(/\b(pty|ltd|au|australia|online|com)\b/g, '').replace(/\s+/g, '');
const OURS = Object.entries(RETAILER_INFO).map(([id, r]) => [id, storeKey(r.name)]);
export const ourRetailer = (store) => { const k = storeKey(store || ''); return k ? (OURS.find(([, n]) => k === n || k.startsWith(n))?.[0] || null) : null; };

/** The words to look the product up by on Google Shopping. */
export function webQuery(p) {
  const name = String(p.name || '');
  const size = p.size && !normText(name).includes(normText(p.size)) ? ` ${p.size}` : '';
  return `${name}${size}`.trim();
}

/** A shorter search for when the first one finds too few: no colour/style in brackets, no pack size. */
export function webQueryLoose(p) {
  return String(p.name || '').replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(capsules?|caps|tablets?|tabs|softgels?|pack|pk|g|kg|ml|l|grams?|litres?)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Is a Google title the same product? null = no; else { sizeUnknown }.
 *  relax (used only when the strict rules find fewer than 5): a title may leave out our variant words, up to 70%
 *  of the naming words may differ (at least 2). Brand, pack size, multipacks and the title's own variant words still apply. */
export function matchRow(p, title, relax = false) {
  const full = `${p.name} ${p.size || ''}`;
  const want = words(full);
  const nums = numbers(want);
  const t = words(title);
  const ts = new Set(t);
  const joined = t.join('');
  const has = (w) => ts.has(w) || (w.length >= 4 && joined.includes(w));
  // Brand: only when it is in the product's own name (some stores fill it in oddly: "SONY COMP", "GTA VI").
  // Compared without spaces, so "Nu-Lax" = "Nulax" and "Life-Space" = "Lifespace".
  const b = words(p.brand || '').filter((w) => !STOP.has(w)).join('');
  if (b && words(p.name).join('').includes(b) && !joined.includes(b)) return null;
  // Variant words must agree both ways ("Advanced", "Kids", "Digital", "Ultimate", "Album").
  const vWant = new Set(want.map(vNorm).filter((w) => VARIANT.has(w)));
  const vHave = new Set(t.map(vNorm).filter((w) => VARIANT.has(w)));
  if ((!relax && [...vWant].some((w) => !vHave.has(w))) || [...vHave].some((w) => !vWant.has(w) && !ONE_WAY.has(w))) return null;
  if (MULTI.test(title) && !MULTI.test(full)) return null;
  // The words that name the product, brand left out (it was checked above). Count the differences both ways:
  // product words missing from the title + other naming words in the title. Allowed: 40% of the product's words, at least 1.
  // Colour or style in brackets doesn't have to be in the title, but isn't an extra word when it is.
  const naming = (ws) => [...new Set(ws.filter((w) => w.length > 1 && !STOP.has(w) && !GENERIC.has(w) && !VARIANT.has(vNorm(w)) && !/^\d/.test(w) && !UNITS.has(w) && !(b && b.includes(w))))];
  const key = naming(words(String(p.name || '').replace(/\([^)]*\)/g, ' ')));
  const nameAll = new Set(words(full)), nameJoin = words(full).join('');
  const extra = naming(t).filter((w) => !nameAll.has(w) && !(w.length >= 4 && nameJoin.includes(w)) && !(b && w.length >= 3 && b.includes(w)));
  const missing = key.filter((w) => !has(w));
  if (missing.length + extra.length > (relax ? Math.max(2, Math.floor(key.length * 0.7)) : Math.max(1, Math.floor(key.length * 0.4)))) return null;
  // Pack size: the same numbers; a different number is another size; no number at all is unknown.
  const tn = numbers(t);
  if ([...nums].every((n) => tn.has(n))) return { sizeUnknown: false };
  if ([...tn].some((n) => !nums.has(n))) return null;
  return { sizeUnknown: true };
}

/** The minimum the page aims for: below it, close matches are added (marked match: 'close', not counted for Lowest). */
export const WEB_MIN = 5;

export function sameOnline(p, results, haveRetailers = [], { min = WEB_MIN } = {}) {
  const price = p.effective || p.price || 0;
  const pass = (relax, best) => {
    for (const r of results || []) {
      if (r.used || !r.priceCents) continue;
      const mine = ourRetailer(r.store);
      if (mine && haveRetailers.includes(mine)) continue;
      const [lo, hi] = relax ? [0.3, 3.5] : [0.4, 2.5];
      if (price && (r.priceCents < price * lo || r.priceCents > price * hi)) continue;
      const k = storeKey(r.store || r.title);
      if (relax && best.has(k)) continue; // this shop already has a same-product row
      const m = matchRow(p, r.title, relax);
      if (!m) continue;
      const row = { ...r, retailer: mine, storeKey: k, sizeUnknown: m.sizeUnknown, match: relax ? 'close' : 'same' };
      const prev = best.get(k);
      // Per shop: a row with a known size beats one without; then the cheaper.
      if (!prev || (prev.sizeUnknown && !row.sizeUnknown) || (prev.sizeUnknown === row.sizeUnknown && row.priceCents < prev.priceCents)) best.set(k, row);
    }
    return best;
  };
  const best = pass(false, new Map());
  if (best.size < min) pass(true, best);
  return [...best.values()].sort((a, b) => a.priceCents - b.priceCents).slice(0, 8);
}
