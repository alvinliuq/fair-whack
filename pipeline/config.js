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

// Monthly catalogue crawl (about 300 items per aisle).
export const AISLES = {
  woolworths: [
    'fruit-veg', 'dairy-eggs-fridge', 'meat-seafood-deli', 'bakery', 'pantry', 'freezer',
    'snacks-confectionery', 'drinks', 'cleaning-maintenance', 'beauty-personal-care', 'baby',
  ].map((a) => `https://www.woolworths.com.au/shop/browse/${a}`),
  coles: [
    'fruit-vegetables', 'dairy-eggs-fridge', 'meat-seafood', 'bakery', 'pantry', 'frozen',
    'chips-chocolates-snacks', 'drinks', 'household', 'health-beauty',
  ].map((a) => `https://www.coles.com.au/browse/${a}`),
};

export const LIMITS = {
  wishlistMaxItems: 500,           // per retailer per week
  aisleMaxItems: 300,              // per aisle per monthly crawl
  catalogueEveryDays: 27,          // skip catalogue unless this long since last ok run
  excludeCategories: ['Liquor'],
};

// Hard caps per Apify run (USD). Apify stops the run when reached.
export const RUN_CAPS_USD = {
  'specials:woolworths': 2,
  'specials:coles': 3,
  'catalogue:woolworths': 3,
  'catalogue:coles': 4,
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

export const ALERTS = {
  maxPushesPerUserPerDay: 1,
  appUrl: process.env.APP_URL || 'https://fair-whack.pages.dev',
};
