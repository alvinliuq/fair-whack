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

// Weekly specials. Half-price pages first so they are never cut off by the cap.
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

// Hard caps per Apify run (USD). Apify stops the run when reached.
export const RUN_CAPS_USD = {
  'specials:woolworths': 2,
  'specials:coles': 3,
  'catalogue:woolworths': 8,
  'catalogue:coles': 12,
  'wishlist:woolworths': 1,
  'wishlist:coles': 1,
};

export const BUDGET = {
  totalUsd: 100,
  // At this total, only the weekly specials keep running; extras stop.
  pauseExtrasAtUsd: 80,
  // At this total, everything stops.
  hardStopUsd: 95,
};

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
};

export const ALERTS = {
  maxPushesPerUserPerDay: 1,
  appUrl: process.env.APP_URL || 'https://fair-whack.pages.dev',
};
