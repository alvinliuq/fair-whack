// Stage 7.4 Home: profile similarity and "Top 20 Choices By Aussie Families".

/** The 8 Top 20 groups and the app categories inside each. */
export const TOP_GROUPS = [
  ['Fresh Food', ['Fruit & Veg', 'Meat & Seafood', 'Dairy, Eggs & Fridge', 'Bakery']],
  ['Food & Drinks', ['Pantry', 'Frozen', 'Snacks & Sweets', 'Drinks']],
  ['Cleaning & Household', ['Household']],
  ['Health & Beauty', ['Health & Beauty']],
  ['Baby & Kids', ['Baby', 'Toys & Games']],
  ['Pets', ['Pet']],
  ['Electronics', ['Electronics']],
  ['Home & Hardware', ['Home & Hardware']],
];
export const groupOf = (category) => TOP_GROUPS.find(([, cats]) => cats.includes(category))?.[0] || null;

export const TOP = { similarity: 0.8, minSimilarUsers: 5, minUsersPerProduct: 2, days: 7, size: 20 };

const AGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
const SIZES = ['1', '2', '3', '4', '5+'];
const near = (list, a, b) => { const i = list.indexOf(a), j = list.indexOf(b); return i < 0 || j < 0 ? null : i === j ? 1 : Math.abs(i - j) === 1 ? 0.5 : 0; };
const jaccard = (a, b) => { if (!a.length && !b.length) return null; const s = new Set(a); const inter = b.filter((x) => s.has(x)).length; return inter / new Set([...a, ...b]).size; };

/** What we compare: age range, gender, household size, kids at home, pets, favourite categories. */
export function profileVector(user, household = {}) {
  let favs = [];
  try { favs = JSON.parse(user.fav_categories || '[]'); } catch {}
  const about = household.about || {};
  const members = Array.isArray(about.members) ? about.members : [];
  const kids = members.length ? members.some((m) => ['0-4', '5-12', '13-17'].includes(m?.age)) : null;
  const pets = Array.isArray(about.pets) ? about.pets.filter((p) => typeof p === 'string') : null;
  return { age: user.age_range || null, gender: user.gender || null, size: user.household_size || null, kids, pets, favs: Array.isArray(favs) ? favs : [] };
}

/** 0..1, averaged over the things both people answered. Fewer than 3 shared answers = not comparable (0). */
export function similarity(a, b) {
  const parts = [
    a.age && b.age ? near(AGES, a.age, b.age) : null,
    a.gender && b.gender ? (a.gender === b.gender ? 1 : 0) : null,
    a.size && b.size ? near(SIZES, a.size, b.size) : null,
    a.kids != null && b.kids != null ? (a.kids === b.kids ? 1 : 0) : null,
    a.pets && b.pets ? jaccard(a.pets, b.pets) : null,
    a.favs.length && b.favs.length ? jaccard(a.favs, b.favs) : null,
  ].filter((x) => x != null);
  if (parts.length < 3) return 0;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

/**
 * adds: [{ user_id, product_id }] list additions in the window (one row per user and product).
 * Returns the products ranked by how many different people added them.
 */
export function rankTop(adds, users, minUsers = TOP.minUsersPerProduct) {
  const allow = users ? new Set(users) : null;
  const by = new Map();
  for (const a of adds) {
    if (allow && !allow.has(a.user_id)) continue;
    if (!by.has(a.product_id)) by.set(a.product_id, new Set());
    by.get(a.product_id).add(a.user_id);
  }
  return [...by].map(([id, s]) => ({ id, people: s.size })).filter((x) => x.people >= minUsers)
    .sort((x, y) => y.people - x.people || (x.id < y.id ? -1 : 1));
}
