// Stage 6, first batch: eight more retailers through ready-made Apify scrapers.
// Each source says which actor to run, what to ask for (specials, catalogue, refresh of list items),
// and how to turn the actor's items into the shape normaliseScraped() reads:
//   { productId, name, brand, size, price, wasPrice, isOnSpecial, promotionText, category, image, url, barcode, isAvailable, unitPriceText }
//
// Seven use the same developer's scrapers (abotapi: same inputs, similar output). JB Hi-Fi uses dromb's
// scraper, which fetches one search page per run. Reviews and extra detail pages are always switched off:
// they are charged separately and the app does not use them.

import { adaptSerp, serpQueryFromUrl } from './serp.js';

const NO_EXTRAS = { fetchReviews: false, incrementalMode: false };

// ALDI departments (URL slugs, as on aldi.com.au/products/<slug>/k/<key>).
const ALDI_DEPTS = ['fruits-vegetables', 'meat-seafood', 'deli-chilled-meats', 'dairy-eggs-fridge', 'pantry', 'bakery',
  'freezer', 'drinks', 'health-beauty', 'baby', 'cleaning-household', 'pets', 'snacks-confectionery'];

// Broad searches that together cover what households buy at each store (a "catalogue" for a
// general retailer is these searches; each one walks its result pages up to the item cap).
const Q = {
  bunnings: ['cordless drill', 'garden hose', 'paint', 'storage', 'light globe', 'bbq', 'outdoor furniture', 'cleaning', 'pots plants', 'tool set', 'extension lead', 'smoke alarm', 'door handle', 'heater', 'fan'],
  kmart: ['towel', 'bedding', 'storage', 'kitchen', 'toys', 'lamp', 'cushion', 'kids clothing', 'womens', 'mens', 'shoes', 'phone accessories', 'home decor', 'baby', 'outdoor', 'appliances', 'party', 'fitness'],
  // 25 Nov: 16 searches gave only 715 products (each search stops after a few pages), so many narrower ones.
  costco: ['coffee', 'chocolate', 'nuts', 'olive oil', 'laundry', 'toilet paper', 'vitamins', 'tv', 'laptop', 'tyres', 'mattress', 'water', 'snacks', 'baby', 'pet food', 'cleaning',
    'cheese', 'meat', 'seafood', 'frozen', 'bakery', 'breakfast cereal', 'rice', 'pasta', 'sauce', 'tea', 'juice', 'soft drink', 'wine', 'paper towel', 'dishwasher', 'shampoo',
    'skin care', 'toothpaste', 'nappies', 'protein', 'headphones', 'tablet', 'phone', 'camera', 'appliances', 'vacuum', 'cookware', 'furniture', 'outdoor', 'bbq', 'toys', 'clothing', 'gift card', 'luggage'],
  // 25 Nov: an empty browse stops at 1,000 products, so the catalogue is these searches instead.
  chemistwarehouse: ['vitamins', 'fish oil', 'probiotic', 'protein powder', 'pain relief', 'cold and flu', 'allergy', 'first aid', 'skin care', 'moisturiser', 'sunscreen', 'face wash',
    'makeup', 'fragrance', 'perfume', 'hair care', 'shampoo', 'hair colour', 'oral care', 'toothpaste', 'electric toothbrush', 'deodorant', 'body wash', 'shaving', 'baby formula',
    'baby care', 'nappies', 'womens health', 'mens health', 'weight management', 'sports nutrition', 'eye care', 'sleep', 'magnesium', 'collagen', 'pet health', 'household'],
  officeworks: ['paper', 'pens', 'printer ink', 'laptop', 'monitor', 'desk', 'office chair', 'school', 'notebook', 'headphones', 'storage', 'art', 'calculator', 'keyboard', 'mouse'],
  bigw: ['toys', 'lego', 'bedding', 'towel', 'kitchen', 'tv', 'headphones', 'books', 'video games', 'clothing', 'shoes', 'baby', 'pet', 'vitamins', 'cleaning', 'outdoor'],
  jbhifi: ['tv', 'laptop', 'headphones', 'speaker', 'iphone', 'samsung', 'ipad', 'nintendo switch', 'playstation', 'xbox', 'camera', 'smart watch', 'monitor', 'vacuum', 'coffee machine', 'air fryer', 'keyboard', 'soundbar'],
};

// Kmart through Google Shopping: one search per line, with the category the results are filed under.
const KMART_RANGE = [
  ['kmart bath towels', 'Home > Bathroom'], ['kmart bath mat', 'Home > Bathroom'], ['kmart bedding sheets', 'Home > Bedroom'],
  ['kmart quilt cover', 'Home > Bedroom'], ['kmart pillows', 'Home > Bedroom'], ['kmart cushions', 'Home > Living'],
  ['kmart throw rug', 'Home > Living'], ['kmart lamp', 'Home > Lighting'], ['kmart storage boxes', 'Home > Storage'],
  ['kmart baskets', 'Home > Storage'], ['kmart kitchen utensils', 'Home > Kitchen'], ['kmart cookware', 'Home > Kitchen'],
  ['kmart dinnerware', 'Home > Dining'], ['kmart food containers', 'Home > Kitchen'], ['kmart cleaning', 'Home > Cleaning'],
  ['kmart laundry basket', 'Home > Laundry'], ['kmart home decor', 'Home > Decor'], ['kmart candles', 'Home > Decor'],
  ['kmart outdoor furniture', 'Home > Outdoor'], ['kmart garden', 'Home > Garden'], ['kmart small appliances', 'Electronics > Appliances'],
  ['kmart air fryer', 'Electronics > Appliances'], ['kmart kettle toaster', 'Electronics > Appliances'], ['kmart phone accessories', 'Electronics > Phone accessories'],
  ['kmart headphones', 'Electronics > Audio'], ['kmart tv', 'Electronics > TVs'], ['kmart toys', 'Toys'], ['kmart lego', 'Toys'],
  ['kmart kids clothing', 'Clothing > Kids'], ['kmart womens clothing', 'Clothing > Womens'], ['kmart mens clothing', 'Clothing > Mens'],
  ['kmart shoes', 'Clothing > Shoes'], ['kmart pyjamas', 'Clothing > Sleepwear'], ['kmart baby', 'Baby'], ['kmart nursery', 'Baby'],
  ['kmart fitness', 'Sports > Fitness'], ['kmart camping', 'Sports > Camping'], ['kmart stationery', 'Office > Stationery'],
  ['kmart pet bed', 'Pet'], ['kmart party supplies', 'Home > Party'], ['kmart christmas decorations', 'Home > Christmas'],
];
const KMART_SPECIALS = ['kmart clearance', 'kmart sale', 'kmart price drop', 'kmart homewares sale', 'kmart toys sale'];

// ---------- adapters ----------

const first = (...v) => v.find((x) => x !== undefined && x !== null && x !== '');
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const imageOf = (x) => {
  const v = first(x.imageUrl, x.image, Array.isArray(x.images) ? x.images[0] : null);
  return typeof v === 'object' && v ? first(v.url, v.src) : v || null;
};
const categoryOf = (x) => {
  for (const v of [x.categoryPath, x.breadcrumbs, x.categoryHierarchy, x.categories]) {
    if (Array.isArray(v) && v.length) return v.map((c) => (typeof c === 'object' ? first(c.name, c.title, c.label) : c)).filter(Boolean).join(' > ');
    if (typeof v === 'string' && v) return v.replace(/\s*[/|]\s*/g, ' > ');
  }
  return first(x.category, x.department, x.merchDepartment, x.type) || null;
};
const absUrl = (u, host) => (!u ? null : /^https?:/.test(u) ? u : `https://${host}${u.startsWith('/') ? '' : '/'}${u}`);

/** abotapi-style item (and most shop scrapers) -> our scraper shape. */
export function adaptGeneric(x, host) {
  if (!x || x.error || x.changeType === 'EXPIRED') return { error: x?.error || 'no item' };
  const price = num(first(x.currentPrice, x.promoPrice, x.discountPrice, x.current_price, x.discount_price, x.salePrice, x.price));
  const listed = num(first(x.wasPrice, x.compareAtPrice, x.originalPrice, x.listPrice, x.rrp, x.price));
  const was = listed && price && listed > price + 0.004 ? listed : null;
  const avail = first(x.inStock, x.isInStock, x.in_stock, x.inStockNationally, x.availableOnline);
  const stock = String(first(x.stockStatus, x.stock_status, x.availability) || '').toLowerCase();
  return {
    productId: first(x.sku, x.code, x.itemNumber, x.articleId, x.productId, x.id, x.object_id),
    name: first(x.name, x.title),
    brand: first(x.brand, x.vendor) || null,
    size: first(x.sellingSize, x.size, x.packSize) || null,
    price,
    wasPrice: was,
    isOnSpecial: !!(x.isOnSpecial || x.onSale || x.isSpecialBuy || was),
    promotionText: first(x.promoLabel, typeof x.promotion === 'string' ? x.promotion : null, x.priceLabel, x.savingsDisplay,
      x.isSpecialBuy ? 'Special Buy' : null, was ? `Save $${(was - price).toFixed(2)}` : null) || null,
    category: categoryOf(x),
    image: imageOf(x),
    url: absUrl(first(x.url, x.productUrl, x.source_url, x.link), host),
    barcode: first(x.gtin, x.apn, x.ean, x.barcode, x.upc) || null,
    isAvailable: avail === false || /out ?of ?stock|unavailable|sold ?out/.test(stock) ? false : true,
    unitPriceText: first(x.unitPriceDisplay, x.unitPriceFormatted) || null,
    _membersOnly: !!(x.priceHidden || x.membershipRequired) && price == null,
  };
}

/** Chemist Warehouse: drop prescription-only medicines (not shown in the beta). */
function adaptChemist(x) {
  const out = adaptGeneric(x, 'www.chemistwarehouse.com.au');
  const rx = (v) => v && !/^(none|null|otc|n\/a)$/i.test(String(v).trim());
  if (x && (rx(x.prescriptionType) && /prescri|s4|s8/i.test(String(x.prescriptionType)) || /^S4|^S8/i.test(String(x.schedule || '')))) return { ...out, error: 'prescription' };
  // Category names start with the site's own root levels.
  if (out.category) out.category = out.category.replace(/^Chemist Warehouse Australia > (Categories > )?/, '') || null;
  return out;
}

// ---------- sources ----------
// specials: list of runs ({ input, max }); catalogue: list of runs; refresh(urls) -> list of runs.
const urlRefresh = (field = 'urls', extra = {}) => (urls) => [{ input: { mode: 'url', [field]: urls, maxItems: urls.length, ...extra }, max: urls.length }];
const searches = (r, total, extra) => [{ input: { mode: 'search', queries: Q[r], maxItems: total, ...extra }, max: total }];

export const SOURCES = {
  aldi: {
    actor: 'abotapi~aldi-com-au-scraper',
    host: 'www.aldi.com.au',
    // Probe 25 Nov: the /products page returns nothing; browsing by department (categories) and the three
    // promo ranges work. Allowed specialsCategory values: special-buys, lower-prices, super-savers.
    specials: [
      { input: { mode: 'search', searchTerms: [], specialsCategory: 'special-buys', maxItems: 300, fetchDetails: false }, max: 300 },
      { input: { mode: 'search', searchTerms: [], specialsCategory: 'super-savers', maxItems: 200, fetchDetails: false }, max: 200 },
    ],
    catalogue: [{ input: { mode: 'search', searchTerms: [], categories: ALDI_DEPTS, maxItems: 3500, fetchDetails: false }, max: 3500 }],
    refresh: urlRefresh('urls', { fetchDetails: false }),
    probeAlternatives: [
      { mode: 'search', searchTerms: [], specialsCategory: 'super-savers', fetchDetails: false },
      { mode: 'search', searchTerms: [], categories: ALDI_DEPTS, fetchDetails: false, maxItems: 60 },
    ],
  },
  costco: {
    actor: 'abotapi~costco-au-scraper',
    host: 'www.costco.com.au',
    specials: [{ input: { mode: 'search', queries: [], specialsCategory: 'hot_buys', maxItems: 400, fetchDetails: false, ...NO_EXTRAS }, max: 400 }],
    catalogue: searches('costco', 3500, { fetchDetails: false, ...NO_EXTRAS }),
    refresh: urlRefresh('urls', { fetchDetails: false, ...NO_EXTRAS }),
  },
  bunnings: {
    actor: 'abotapi~bunnings-com-au-scraper',
    host: 'www.bunnings.com.au',
    specials: [], // Bunnings publishes no was-prices or specials; its prices are refreshed with the catalogue and list.
    catalogue: searches('bunnings', 3000, { fetchDetails: false, ...NO_EXTRAS }),
    refresh: urlRefresh('urls', { fetchDetails: false, ...NO_EXTRAS }),
  },
  kmart: {
    // Kmart's site blocks both Apify scrapers and Zyte (tested 25 Nov), so Kmart is read from Google Shopping
    // (SerpApi), keeping only results sold by Kmart. Each query is one search from the SerpApi plan; runs cost $0.
    runner: 'serp',
    host: 'www.kmart.com.au',
    specials: KMART_SPECIALS.map((q) => ({ input: { store: '^kmart$', queries: [[q, null]] }, max: 1 })),
    catalogue: KMART_RANGE.map(([q, c]) => ({ input: { store: '^kmart$', queries: [[q, c]] }, max: 1 })),
    // Each list item is looked up again by its name (at most 150 a week).
    refresh: (urls) => urls.map(serpQueryFromUrl).filter(Boolean).slice(0, 150)
      .map((t) => ({ input: { store: '^kmart$', queries: [[`kmart ${t}`, null]] }, max: 1 })),
  },
  bigw: {
    actor: 'abotapi~bigw-marketplace-scraper',
    host: 'www.bigw.com.au',
    // BIG W's own range only (not marketplace sellers). Its specials views have no documented names,
    // so specials come from the price-sorted browse plus was-prices in the catalogue.
    // Probe 25 Nov: an empty browse returns nothing, keyword searches work (was-prices included).
    specials: [{ input: { mode: 'search', queries: Q.bigw.slice(0, 8), soldBy: 'bigw', marketplaceOnly: false, maxItems: 400, ...NO_EXTRAS }, max: 400 }],
    catalogue: searches('bigw', 3000, { soldBy: 'bigw', marketplaceOnly: false, ...NO_EXTRAS }),
    refresh: urlRefresh('urls', { soldBy: 'bigw', marketplaceOnly: false, ...NO_EXTRAS }),
  },
  officeworks: {
    actor: 'abotapi~officeworks-scraper',
    host: 'www.officeworks.com.au',
    specials: [{ input: { mode: 'search', queries: [], specialsCategory: 'deals', maxItems: 400, detailEnrichment: false, maxReviewsPerProduct: 0, incrementalMode: false }, max: 400 }],
    catalogue: searches('officeworks', 2500, { detailEnrichment: false, maxReviewsPerProduct: 0, incrementalMode: false }),
    refresh: urlRefresh('urls', { detailEnrichment: false, maxReviewsPerProduct: 0 }),
  },
  chemistwarehouse: {
    actor: 'abotapi~chemistwarehouse-com-au-scraper',
    host: 'www.chemistwarehouse.com.au',
    adapt: adaptChemist,
    specials: [{ input: { mode: 'search', queries: [], specialsCategory: 'promotions', maxItems: 500, ...NO_EXTRAS }, max: 500 }],
    catalogue: searches('chemistwarehouse', 4000, NO_EXTRAS),
    refresh: urlRefresh('productUrls', NO_EXTRAS),
  },
  jbhifi: {
    actor: 'dromb~jbhifi-au-product-scraper',
    host: 'www.jbhifi.com.au',
    // One search page (up to 120 products) per run.
    specials: Q.jbhifi.slice(0, 6).map((q) => ({ input: { operation: 'search', query: q, page: 1, limit: 60, proxyMode: 'auto' }, max: 60 })),
    catalogue: Q.jbhifi.flatMap((q) => [1, 2].map((page) => ({ input: { operation: 'search', query: q, page, limit: 80, proxyMode: 'auto' }, max: 80 }))),
    refresh: (urls) => urls.slice(0, 40).map((url) => ({ input: { operation: 'item', url, proxyMode: 'auto' }, max: 1 })),
  },
};

/** Sources that run. A paused source (disabled) is skipped by every job, so it costs nothing. */
export const ACTIVE_SOURCES = Object.fromEntries(Object.entries(SOURCES).filter(([, v]) => !v.disabled));

/** Turn one raw item into the shape normaliseScraped() reads, for any retailer. */
export function adaptItem(retailer, item) {
  const s = SOURCES[retailer];
  if (!s) return item; // Woolworths and Coles actors already use that shape
  const out = s.runner === 'serp' ? adaptSerp(item, s.host) : (s.adapt || ((x) => adaptGeneric(x, s.host)))(item);
  if (out._membersOnly) return { ...out, error: 'members-only price' };
  // A listing that links to another website (e.g. a partner's deal) is not this store's product.
  const site = s.host.replace(/^www\./, '');
  if (out.url && !new URL(out.url).hostname.endsWith(site)) return { ...out, error: `links to another site (${new URL(out.url).hostname})` };
  if (out.productId == null || !out.name || out.price == null) return { ...out, error: out.error || 'missing id, name or price' };
  return out;
}

