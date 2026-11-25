// Pipeline settings. Change these here; no secrets in this file.

export const ACTORS = {
  woolworths: 'atalaia~woolworths-au',
  coles: 'atalaia~coles-au',
};

// Leave Woolworths postcode blank: setting one triggers paid detail lookups.
export const POSTCODE = {
  woolworths: '',
  coles: process.env.COLES_POSTCODE || '3165',
};

// Specials run twice a week (stage 6). Wednesday: every retailer (supermarket specials change on Wednesdays),
// then the wishlist refresh. Saturday: every retailer except these supermarkets.
export const SUPERMARKETS = ['woolworths', 'coles', 'aldi'];

// Specials pages. Half-price pages first so they are never cut off by the cap.
// Per-retailer total stays at about 2,500 items.
export const SPECIALS = {
  woolworths: [
    { url: 'https://www.woolworths.com.au/shop/browse/specials/half-price', max: 700 },
    { url: 'https://www.woolworths.com.au/shop/browse/specials', max: 1800 },
  ],
  coles: [
    { url: 'https://www.coles.com.au/on-special?filter_Special=halfprice', max: 700 },
    { url: 'https://www.coles.com.au/on-special', max: 1800 },
  ],
};

// Catalogue crawl every 4 weeks ("Plan A": about 10-12k products per store).
// max = items collected from that department. Errors (wrong URL) are not charged.
const W = 'https://www.woolworths.com.au/shop/browse/';
const C = 'https://www.coles.com.au/browse/';
export const AISLES = {
  woolworths: [
    ['fruit-veg', 600], ['poultry-meat-seafood', 500], ['deli', 400], ['dairy-eggs-fridge', 1000], ['bakery', 500],
    ['pantry', 1500], ['freezer', 1000], ['drinks', 800], ['snacks-confectionery', 1000], ['cleaning-maintenance', 1000],
    ['personal-care', 1000], ['beauty', 500], ['health-wellness', 600], ['baby', 500], ['pet', 500], ['lunch-box', 300],
    ['international-foods', 400],
  ].map(([a, max]) => ({ url: W + a, max })),
  coles: [
    ['fruit-vegetables', 600], ['meat-seafood', 500], ['deli', 400], ['dairy-eggs-fridge', 1000], ['bakery', 500],
    ['pantry', 1500], ['frozen', 1000], ['drinks', 800], ['chips-chocolates-snacks', 1000], ['household', 1000],
    ['health-beauty', 1500], ['baby', 500], ['pet', 500],
  ].map(([a, max]) => ({ url: C + a, max })),
};

export const LIMITS = {
  wishlistMaxItems: 500,           // per retailer per week
  catalogueEveryDays: 27,          // skip catalogue unless this long since last ok run
  excludeCategories: ['Liquor'],
};

// Hard caps per Apify run (USD). Apify stops the run when reached. Every run is also capped by what is
// left under this month's hard limit.
export const RUN_CAPS_USD = {
  'specials:woolworths': 2,
  'specials:coles': 3,
  'catalogue:woolworths': 8,
  'catalogue:coles': 12,
  'wishlist:woolworths': 1,
  'wishlist:coles': 1,
  // Stage 6 first batch (estimates: about US$1-2 per 1,000 products, reviews and detail pages off).
  ...Object.fromEntries(['aldi', 'costco', 'bunnings', 'kmart', 'bigw', 'officeworks', 'chemistwarehouse', 'jbhifi'].flatMap((r) => [
    [`specials:${r}`, 2], [`catalogue:${r}`, r === 'jbhifi' ? 4 : 8], [`wishlist:${r}`, 1], [`probe:${r}`, 0.3],
  ])),
  // Second batch (Zyte, estimated cost per run; Zyte's own monthly limit is US$70).
  ...Object.fromEntries(['target', 'thegoodguys', 'petbarn', 'peto', 'decathlon', 'ebgames'].flatMap((r) => [
    [`specials:${r}`, r === 'decathlon' ? 3 : 1], [`catalogue:${r}`, r === 'decathlon' ? 9 : 5], [`wishlist:${r}`, 2],
  ])),
};

// The monthly budget (soft and hard limits, what counts) is in shared/budget.js,
// so the app and the pipeline use the same figures.

export const MATCH = {
  autoAccept: 0.9,     // >= : link automatically
  reviewFloor: 0.6,    // between floor and autoAccept: send to admin review
};

// Automatic review of the "possible matches" queue (pipeline/review.js). A pair is linked only when
// the size is the same, the names are more than nameMin alike, and the photos pass both photo checks.
export const REVIEW = {
  nameMin: 0.9,
  shapeMin: 0.7,     // photo layout (perceptual hash), 1 = identical
  colourMin: 0.85,   // photo colours, 1 = identical
  // Second way to pass: the two stores show almost the same photo. Then the names only need to be
  // 60% alike (same size and brand still required). Catches "Macaroni No 38" / "Macaroni Pasta No 38".
  near: { nameMin: 0.6, shapeMin: 0.94, colourMin: 0.97 },
};

export const ALERTS = {
  maxPushesPerUserPerDay: 1,
  appUrl: process.env.APP_URL || 'https://fair-whack.pages.dev',
};
