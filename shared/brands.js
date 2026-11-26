// FW2.2 "Your Brand, Your Deal": matching rules and link building (no database access here, so it can be tested).

export const BRAND_ZONE = {
  // 'fixed': every tester sees the same live campaigns (test phase and early launch: too few users to judge
  // matching). 'match': only campaigns scoring minScore or more, best first. Switch when there are enough users.
  mode: 'fixed',
  size: 5,            // campaigns on Home
  minScore: 40,       // 'match' mode: lowest score shown
  alertScore: 70,     // brand deal alert: lowest score that gets a push
  alertEveryDays: 7,  // brand deal alerts: at most one per person in this many days (follows aside)
  hideDays: 90,       // "Not interested" hides the brand this long
  weights: { category: 40, brand: 30, profile: 20, similar: 10 },
};

export const KINDS = { brand: 'Brand site', retailer: 'Retailer event' };

const lc = (s) => String(s || '').trim().toLowerCase();

/** Does the household match the campaign's target? null when the campaign has no target or we can't tell. */
export function profileFits(target, v) {
  if (!target) return null;
  const checks = [];
  if (Array.isArray(target.sizes) && target.sizes.length) checks.push(v.size ? target.sizes.includes(v.size) : null);
  if (Array.isArray(target.ages) && target.ages.length) checks.push(v.age ? target.ages.includes(v.age) : null);
  if (target.kids === true || target.kids === false) checks.push(v.kids == null ? null : v.kids === target.kids);
  if (Array.isArray(target.pets) && target.pets.length) checks.push(Array.isArray(v.pets) ? v.pets.some((p) => target.pets.includes(p)) : null);
  const known = checks.filter((x) => x != null);
  if (!checks.length || !known.length) return null;
  return known.every(Boolean);
}

/**
 * Score one campaign for one person, with the reasons behind it.
 * c:  { tags: { categories: [], brands: [] }, target, reason, brandName }
 * me: { listCategories: Set, listBrands: Set (lower case), follows: bool, vector, similarEngaged: bool }
 */
export function scoreCampaign(c, me, w = BRAND_ZONE.weights) {
  const reasons = [];
  let score = 0;
  const cats = (c.tags?.categories || []).filter((x) => me.listCategories?.has(x));
  if (cats.length) {
    score += w.category;
    reasons.push({ kind: 'category', text: `Your list has ${cats.slice(0, 2).join(' and ')} items` });
  }
  const brands = (c.tags?.brands || []).filter((b) => me.listBrands?.has(lc(b)));
  if (me.follows || brands.length) {
    score += w.brand;
    reasons.push({ kind: 'brand', text: me.follows ? `You follow ${c.brandName}` : `Your list has ${brands[0]} products` });
  }
  if (me.vector && profileFits(c.target, me.vector) === true) {
    score += w.profile;
    reasons.push({ kind: 'profile', text: 'Picked for households like yours' });
  }
  if (me.similarEngaged) {
    score += w.similar;
    reasons.push({ kind: 'similar', text: 'Families like yours are checking this out' });
  }
  if (!reasons.length) reasons.push({ kind: 'pick', text: c.reason || 'Hand-picked by Fair Whack' });
  return { score, reasons };
}

/** Which campaigns Home shows, given scored campaigns in priority order. */
export function pickForHome(scored, mode = BRAND_ZONE.mode, size = BRAND_ZONE.size) {
  if (mode === 'match') return scored.filter((c) => c.score >= BRAND_ZONE.minScore).sort((a, b) => b.score - a.score || b.priority - a.priority).slice(0, size);
  return scored.slice(0, size);
}

/** Only http(s) links leave Fair Whack. */
export function safeUrl(u) {
  try { const x = new URL(String(u || '').trim()); return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null; } catch { return null; }
}

/** The address "Go to site" sends people to: UTM tags unless the link is an affiliate link (add_utm off). */
export function outboundUrl(url, { addUtm = true, campaign = '', medium = 'app' } = {}) {
  const safe = safeUrl(url);
  if (!safe || !addUtm) return safe;
  const x = new URL(safe);
  if (!x.searchParams.has('utm_source')) {
    x.searchParams.set('utm_source', 'fairwhack');
    x.searchParams.set('utm_medium', medium);
    if (campaign) x.searchParams.set('utm_campaign', campaign);
  }
  return x.toString();
}

export const slugify = (s) => lc(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Live = switched on and inside its dates. */
export const isLive = (c, now = new Date().toISOString()) => c.status === 'live' && c.starts_at <= now && c.ends_at > now;

export function cleanTarget(t) {
  if (!t || typeof t !== 'object') return null;
  const arr = (a, allowed) => (Array.isArray(a) ? [...new Set(a.map(String).filter((x) => allowed.includes(x)))] : []);
  const out = {
    sizes: arr(t.sizes, ['1', '2', '3', '4', '5+']),
    ages: arr(t.ages, ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']),
    kids: t.kids === true || t.kids === false ? t.kids : null,
    pets: arr(t.pets, ['dog', 'cat', 'other']),
  };
  return out.sizes.length || out.ages.length || out.kids != null || out.pets.length ? out : null;
}
