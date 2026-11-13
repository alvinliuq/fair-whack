// Shared normalisation helpers. Used by the data pipeline (Node) and the API (Cloudflare Workers).
// Pure functions only: no I/O.

export const RETAILERS = ['woolworths', 'coles', 'aldi', 'costco'];

export function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// ---------- size parsing ----------

const UNIT_MAP = {
  g: ['g', 1], gm: ['g', 1], gms: ['g', 1], gram: ['g', 1], grams: ['g', 1],
  kg: ['g', 1000], kgs: ['g', 1000], kilo: ['g', 1000],
  mg: ['g', 0.001],
  ml: ['ml', 1], mls: ['ml', 1],
  l: ['ml', 1000], lt: ['ml', 1000], ltr: ['ml', 1000], litre: ['ml', 1000], litres: ['ml', 1000], liter: ['ml', 1000],
  cl: ['ml', 10],
};
const COUNT_WORDS = 'pack|pk|each|ea|pieces|piece|pcs|pc|rolls|roll|sheets|bags|bag|tablets|tabs|capsules|caps|pods|sachets|bars|eggs|count|ct|cans|bottles|x';

function num(s) { return parseFloat(String(s).replace(',', '.')); }

/**
 * Parse a size string (falling back to the product name).
 * Returns { pack_count, size_value, size_unit } where size_value is the TOTAL
 * quantity in g / ml / each, or nulls when it cannot be parsed.
 */
export function parseSize(sizeText, name = '') {
  const tryParse = (raw) => {
    if (!raw) return null;
    const s = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
    if (/\bper\s*kg\b|\/\s*kg\b/.test(s)) return { pack_count: 1, size_value: 1000, size_unit: 'g', per_kg: true };
    let m = s.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gm|gms|mg|ml|mls|l|lt|ltr|litre|litres|cl)\b/);
    if (m) {
      const [unit, f] = UNIT_MAP[m[3]];
      return { pack_count: parseInt(m[1], 10), size_value: round(parseInt(m[1], 10) * num(m[2]) * f), size_unit: unit };
    }
    m = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gm|gms|mg|ml|mls|l|lt|ltr|litre|litres|cl)\s*[x×]\s*(\d+)\b/);
    if (m) {
      const [unit, f] = UNIT_MAP[m[2]];
      return { pack_count: parseInt(m[3], 10), size_value: round(parseInt(m[3], 10) * num(m[1]) * f), size_unit: unit };
    }
    m = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilo|g|gm|gms|gram|grams|mg|ml|mls|l|lt|ltr|litre|litres|liter|cl)\b/);
    if (m) {
      const [unit, f] = UNIT_MAP[m[2]];
      return { pack_count: 1, size_value: round(num(m[1]) * f), size_unit: unit };
    }
    m = s.match(new RegExp(`(\\d+)\\s*(${COUNT_WORDS})\\b`));
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) return { pack_count: n, size_value: n, size_unit: 'each' };
    }
    m = s.match(new RegExp(`\\b(${COUNT_WORDS.replace('|x', '')})\\s*(\\d+)\\b`));
    if (m) {
      const n = parseInt(m[2], 10);
      if (n > 0 && n < 10000) return { pack_count: n, size_value: n, size_unit: 'each' };
    }
    if (/^(each|ea|1 each)$/.test(s)) return { pack_count: 1, size_value: 1, size_unit: 'each' };
    return null;
  };
  return tryParse(sizeText) || tryParse(name) || { pack_count: null, size_value: null, size_unit: null };
}

function round(n) { return Math.round(n * 1000) / 1000; }

/** Our standard unit price basis: per 100g, per 1L, per each. */
export function unitBasisFor(unit) {
  if (unit === 'g') return '100g';
  if (unit === 'ml') return '1L';
  if (unit === 'each') return 'each';
  return null;
}

export function unitPriceCents(priceCents, sizeValue, unit) {
  if (priceCents == null || !sizeValue || !unit) return null;
  if (unit === 'g') return Math.round((priceCents / sizeValue) * 100);
  if (unit === 'ml') return Math.round((priceCents / sizeValue) * 1000);
  if (unit === 'each') return Math.round(priceCents / sizeValue);
  return null;
}

/** "Uses" printed on the pack, e.g. "40 Washes", "60 Tablets" (only explicit counts). */
export function parseUses(name = '', sizeText = '') {
  const s = `${name} ${sizeText}`.toLowerCase();
  const m = s.match(/(\d+)\s*(washes|wash|loads|tablets|tabs|capsules|caps|pods|uses|serves|servings)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 && n < 5000 ? n : null;
}

// ---------- names, keys ----------

const STOP = new Set(['the', 'and', 'with', 'of', 'a', 'an', 'in', 'for', 'pack', 'pk', 'each', 'ea', 'bottle', 'bottles', 'can', 'cans', 'bag', 'box', 'tub', 'jar', 'punnet', 'tray', 'value', 'multipack', 'per', 'kg', 'approx', 'loose', 'prepacked']);
const ABBR = { choc: 'chocolate', crm: 'cream', fc: 'full cream', vanila: 'vanilla', lt: 'light', 'f/c': 'full cream', 'w/meal': 'wholemeal', wholemeal: 'wholemeal', ff: 'fat free' };

export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name tokens without size words, brand, or stop words. */
export function nameTokens(name, brand) {
  let s = normText(name);
  const b = normText(brand);
  if (b && s.startsWith(b + ' ')) s = s.slice(b.length + 1);
  s = s
    .replace(/\d+(?:[.,]\d+)?\s*(kg|kgs|g|gm|gms|mg|ml|mls|l|lt|ltr|litre|litres|cl)\b/g, ' ')
    .replace(/\d+\s*[x×]\s*\d+/g, ' ')
    .replace(new RegExp(`\\b\\d+\\s*(${COUNT_WORDS}|washes|loads|tablets|capsules|pods)\\b`, 'g'), ' ');
  const out = [];
  for (let t of s.split(' ')) {
    if (!t) continue;
    if (ABBR[t]) t = ABBR[t];
    for (const p of t.split(' ')) if (p && !STOP.has(p) && !/^\d+$/.test(p)) out.push(p);
  }
  return out;
}

export function brandKey(brand) { return normText(brand).replace(/\s+/g, ''); }

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Same brand + same product, any size. */
export function familyKey(brand, name) {
  const toks = [...new Set(nameTokens(name, brand))].sort();
  return `f:${brandKey(brand) || 'nobrand'}:${toks.join('-')}`.slice(0, 180);
}

// ---------- categories ----------

const CATS = [
  ['Liquor', /liquor|beer|wine|spirits|cider|alcohol/],
  ['Fruit & Veg', /fruit|veg|salad|herbs/],
  ['Meat & Seafood', /meat|seafood|poultry|chicken|beef|lamb|pork|fish|deli/],
  ['Dairy & Eggs', /dairy|eggs|milk|cheese|yoghurt|yogurt|butter|fridge/],
  ['Bakery', /bakery|bread/],
  ['Frozen', /frozen|freezer|ice cream/],
  ['Snacks & Sweets', /snack|chips|confectionery|chocolate|biscuit|lollies|sweets/],
  ['Drinks', /drink|beverage|soft drink|juice|water|coffee|tea/],
  ['Baby', /baby/],
  ['Pet', /pet|dog|cat /],
  ['Health & Beauty', /health|beauty|personal care|toiletries|vitamin|pharmacy|cosmetic/],
  ['Household', /household|cleaning|laundry|kitchen|paper|maintenance|home/],
  ['Pantry', /pantry|international|breakfast|cereal|canned|pasta|rice|sauces|baking|spreads|condiments/],
];
export const CATEGORY_LIST = ['Fruit & Veg', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen', 'Snacks & Sweets', 'Drinks', 'Household', 'Health & Beauty', 'Baby', 'Pet', 'Liquor', 'Other'];

export function mapCategory(categoryPath, name = '') {
  const top = normText(String(categoryPath || '').split('>')[0]);
  for (const [cat, re] of CATS) if (re.test(top)) return cat;
  const full = normText(`${categoryPath || ''} ${name}`);
  for (const [cat, re] of CATS) if (re.test(full)) return cat;
  return 'Other';
}

// ---------- comparable groups (curated staples) ----------
// Products in the same group are "similar items" (different brands, same use).
// Groups also require the same unit type so unit prices compare like with like.
export const COMPARABLE_RULES = [
  ['milk-full-cream', /\b(full cream|whole) milk\b|\bmilk full cream\b/, 'ml'],
  ['milk-light', /\b(light|lite|reduced fat|low fat) milk\b/, 'ml'],
  ['milk-skim', /\bskim(med)? milk\b/, 'ml'],
  ['milk-lactose-free', /lactose free milk/, 'ml'],
  ['eggs-free-range', /free range eggs?\b/, null],
  ['eggs-cage-free', /cage free eggs?\b/, null],
  ['bread-white', /\bwhite\b.*\bbread\b|\bbread white\b/, 'g'],
  ['bread-wholemeal', /wholemeal bread|bread wholemeal|multigrain bread/, 'g'],
  ['peanut-butter', /peanut butter/, 'g'],
  ['butter', /(?<!peanut |nut |cocoa |shea )\bbutter\b(?! (cookies|chicken|beans|menthol|cake))/, 'g'],
  ['cheese-tasty-block', /\b(tasty|cheddar|colby)\b.*\bblock\b|\bcheese block\b/, 'g'],
  ['cheese-grated', /\b(grated|shredded)\b.*cheese|cheese.*\b(grated|shredded)\b/, 'g'],
  ['yoghurt-greek', /greek.*yog(h)?urt|yog(h)?urt.*greek/, 'g'],
  ['bananas', /\bbananas?\b(?! bread)/, 'g'],
  ['apples', /\bapples?\b(?! juice| cider)/, 'g'],
  ['potatoes', /\bpotato(es)?\b(?! chips| salad)/, 'g'],
  ['onions-brown', /\bbrown onions?\b/, 'g'],
  ['tomatoes', /\btomato(es)?\b(?! sauce| paste| soup|es diced|es crushed)/, 'g'],
  ['chicken-breast', /chicken breast/, 'g'],
  ['beef-mince', /beef mince|mince beef/, 'g'],
  ['rice-white', /\b(jasmine|basmati|white|long grain) rice\b/, 'g'],
  ['pasta-dry', /\b(spaghetti|penne|fettuccine|spirals|fusilli|pasta)\b/, 'g'],
  ['oats', /\b(rolled|quick|traditional) oats\b|\boats\b/, 'g'],
  ['sugar-white', /\b(white|raw|caster) sugar\b/, 'g'],
  ['flour-plain', /plain flour|self raising flour/, 'g'],
  ['olive-oil', /olive oil/, 'ml'],
  ['canola-oil', /canola oil|vegetable oil/, 'ml'],
  ['tomatoes-canned', /(diced|crushed|chopped) tomatoes/, 'g'],
  ['baked-beans', /baked beans/, 'g'],
  ['tuna-canned', /\btuna\b/, 'g'],
  ['tomato-sauce', /tomato sauce|tomato ketchup/, 'ml'],
  ['coffee-instant', /instant coffee|coffee.*(instant|granules)/, 'g'],
  ['coffee-beans-ground', /coffee (beans|ground)|ground coffee|espresso beans/, 'g'],
  ['coffee-capsules', /coffee capsules|capsules.*coffee|compatible capsules/, 'each'],
  ['tea-bags', /tea bags|\btea\b.*\b\d+ (bags|pack)/, null],
  ['cereal-wheat-biscuits', /wheat biscuits|weet-?bix|weeties/, 'g'],
  ['orange-juice', /orange juice/, 'ml'],
  ['sparkling-water', /sparkling (mineral )?water|soda water/, 'ml'],
  ['cola', /\bcola\b|\bcoke\b|pepsi/, 'ml'],
  ['potato-chips', /potato chips|\bchips\b/, 'g'],
  ['chocolate-block', /chocolate block|\bblock\b.*chocolate/, 'g'],
  ['ice-cream', /ice cream/, 'ml'],
  ['frozen-peas', /frozen peas|\bpeas\b.*frozen|garden peas/, 'g'],
  ['toilet-paper', /toilet (paper|tissue|rolls)/, 'each'],
  ['paper-towel', /paper towel/, 'each'],
  ['tissues', /facial tissues|\btissues\b/, 'each'],
  ['dish-liquid', /dishwashing liquid|dish liquid/, 'ml'],
  ['laundry-liquid', /laundry liquid|liquid laundry|(?<!dish)washing liquid/, 'ml'],
  ['laundry-powder', /laundry powder|washing powder/, 'g'],
  ['dishwasher-tablets', /dishwash(er|ing) (tablets|capsules|pods)|dishwasher tabs/, 'each'],
  ['toothpaste', /toothpaste/, 'g'],
  ['shampoo', /\bshampoo\b/, 'ml'],
  ['body-wash', /body wash|shower gel/, 'ml'],
  ['nappies', /\bnappies\b|\bnappy pants\b/, 'each'],
  ['dog-food-dry', /dry dog food|dog food.*dry/, 'g'],
  ['cat-food-wet', /cat food/, 'g'],
];

export function comparableGroup(name, brand, unit) {
  const s = normText(`${name}`);
  for (const [id, re, u] of COMPARABLE_RULES) {
    if (re.test(s) && (!u || !unit || unit === u)) return id;
  }
  return null;
}

// ---------- promotions ----------

/** Map scraper fields to our promo_type vocabulary. */
export function promoType(item) {
  if (!item) return null;
  const text = `${item.promotionType || ''} ${item.specialType || ''} ${item.promotionText || ''}`.toLowerCase();
  if (item.isHalfPrice || /half price|1\/2 price|½/.test(text)) return 'half_price';
  if (/(\d+)\s*for\s*\$|buy\s*\d+|multi ?buy|any\s*\d+\s*for/.test(text)) return 'multibuy';
  if (/prices? dropped|down down|lower price|price drop/.test(text)) return 'price_dropped';
  if (/low shelf|lower shelf/.test(text)) return 'low_shelf_price';
  if (/everyday low|every day low/.test(text)) return 'everyday_low';
  if (item.isOnSpecial) return 'other';
  return null;
}

/** "2 for $10" -> {qty:2, cents:1000} */
export function parseMultibuy(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  let m = s.match(/(?:any\s*)?(\d+)\s*for\s*\$\s*(\d+(?:\.\d+)?)/);
  if (m) return { qty: parseInt(m[1], 10), cents: Math.round(parseFloat(m[2]) * 100) };
  m = s.match(/buy\s*(\d+)\s*for\s*\$\s*(\d+(?:\.\d+)?)/);
  if (m) return { qty: parseInt(m[1], 10), cents: Math.round(parseFloat(m[2]) * 100) };
  return null;
}

/** Build the normalised product + snapshot record from a scraper item. */
export function normaliseScraped(retailer, item, capturedAt) {
  if (!item || item.error || !item.productId || !item.name) return null;
  const priceCents = toCents(item.price);
  const size = parseSize(item.size, item.name);
  const unitCents = unitPriceCents(priceCents, size.size_value, size.size_unit);
  const ptype = item.isOnSpecial ? promoType(item) : null;
  const mb = ptype === 'multibuy' ? parseMultibuy(item.promotionText || item.promotionType) : null;
  const category = mapCategory(item.category, item.name);
  return {
    product: {
      id: `${retailer}:${item.productId}`,
      retailer,
      retailer_product_id: String(item.productId),
      name: String(item.name).trim(),
      brand: item.brand ? String(item.brand).trim() : null,
      size_text: item.size || null,
      size_value: size.size_value,
      size_unit: size.size_unit,
      pack_count: size.pack_count,
      uses_per_pack: parseUses(item.name, item.size),
      gtin: item.barcode ? String(item.barcode).replace(/\D/g, '') || null : null,
      category_path: item.category || null,
      category,
      image_url: item.image || null,
      product_url: item.url || null,
      family_id: familyKey(item.brand, item.name),
      comparable_group_id: comparableGroup(item.name, item.brand, size.size_unit),
    },
    snapshot: {
      price_cents: priceCents,
      was_cents: toCents(item.wasPrice),
      unit_cents: unitCents,
      unit_basis: unitBasisFor(size.size_unit),
      retailer_unit_text: item.unitPriceText || null,
      is_special: item.isOnSpecial ? 1 : 0,
      promo_type: ptype,
      promo_text: item.isOnSpecial ? (item.promotionText || item.promotionType || null) : null,
      multibuy_qty: mb ? mb.qty : null,
      multibuy_cents: mb ? mb.cents : null,
      in_stock: item.isAvailable === false ? 0 : 1,
      price_context: item.storeContext || 'default',
      source: 'scraper',
      captured_at: capturedAt || item.scrapedAt || new Date().toISOString(),
    },
  };
}

/** Effective single-item price when buying the multibuy quantity. */
export function multibuyEach(snapshot) {
  if (!snapshot || !snapshot.multibuy_qty || !snapshot.multibuy_cents) return null;
  return Math.round(snapshot.multibuy_cents / snapshot.multibuy_qty);
}

export function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

/**
 * True-discount check from ~12 weeks of history (spec section 6.4).
 * history: [{price_cents, captured_at}] excluding the current snapshot.
 */
export function discountFlag(current, history) {
  const weeks = new Set(history.map((h) => isoWeek(h.captured_at))).size;
  if (weeks < 4 || current.price_cents == null) return { flag: null, weeks, low: null, med: null };
  const prices = history.map((h) => h.price_cents).filter((x) => x != null);
  const low = Math.min(...prices);
  const med = median(prices);
  let flag = null;
  if (current.was_cents && med && current.was_cents > med * 1.1) flag = 'inflated';
  else if (current.price_cents <= low && med && current.price_cents < med) flag = 'low12';
  return { flag, weeks, low, med };
}

export function isoWeek(iso) {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
