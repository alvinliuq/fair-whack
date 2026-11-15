// Fair Whack API — Cloudflare Pages Function (single router).
// Bindings: env.DB (D1). Secrets: INVITE_CODE, ADMIN_CODE, SESSION_SECRET, VAPID_PUBLIC_KEY.
import {
  parseSize, unitPriceCents, unitBasisFor, parseUses, familyKey, comparableGroup, mapCategory,
  toCents, CATEGORY_LIST, normText, ACTIVE_RETAILERS, RETAILER_CATEGORY_ORDER,
} from './normalize.js';

const FRESH_DAYS = 8;
const PAGE = 40;
const RETAILERS = ['woolworths', 'coles', 'aldi', 'costco'];

// ---------- helpers ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...headers },
  });
const err = (status, message) => json({ error: message }, status);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const nowIso = () => new Date().toISOString();
const freshCut = () => new Date(Date.now() - FRESH_DAYS * 86400000).toISOString();
const uid = () => crypto.randomUUID();

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeSession(env, userId) {
  const exp = Math.floor(Date.now() / 1000) + 90 * 86400;
  const payload = `${encodeURIComponent(userId)}.${exp}`;
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}
async function readSession(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)fw_session=([^;]+)/);
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, `${u}.${exp}`))) return null;
  return decodeURIComponent(u);
}
function cookieHeader(value, maxAge, request) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `fw_session=${value}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}
async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

// ---------- product serialisation ----------
const COLS = `id, retailer, name, brand, size_text, size_value, size_unit, uses_per_pack, category, image_url, product_url,
  canonical_product_id, family_id, comparable_group_id, cur_price_cents, cur_was_cents, cur_unit_cents, cur_unit_basis,
  cur_retailer_unit_text, cur_is_special, cur_promo_type, cur_promo_text, cur_multibuy_qty, cur_multibuy_cents,
  cur_in_stock, cur_source, cur_captured_at, special_since, low12_cents, median12_cents, history_weeks, discount_flag, price_flag, cat1, cat2, first_seen_at`;

function pub(p) {
  if (!p) return null;
  const fresh = p.cur_captured_at && p.cur_captured_at >= freshCut();
  const special = !!p.cur_is_special && fresh;
  const mbEach = p.cur_multibuy_qty && p.cur_multibuy_cents ? Math.round(p.cur_multibuy_cents / p.cur_multibuy_qty) : null;
  const effective = mbEach && special ? Math.min(mbEach, p.cur_price_cents) : p.cur_price_cents;
  const unitEff = special && mbEach && p.size_value ? unitPriceCents(mbEach, p.size_value / 1, p.size_unit) : p.cur_unit_cents;
  return {
    id: p.id,
    retailer: p.retailer,
    name: p.name,
    brand: p.brand,
    size: p.size_text,
    category: p.category,
    cat1: p.cat1,
    firstSeen: p.first_seen_at,
    image: p.image_url,
    url: p.product_url,
    canonical: p.canonical_product_id,
    price: p.cur_price_cents,
    was: special ? p.cur_was_cents : null,
    effective,
    unit: unitEff,
    unitBasis: p.cur_unit_basis,
    retailerUnit: p.cur_retailer_unit_text,
    perUse: p.uses_per_pack && effective ? Math.round(effective / p.uses_per_pack) : null,
    uses: p.uses_per_pack,
    special,
    promoType: special ? p.cur_promo_type : null,
    promoText: special ? p.cur_promo_text : null,
    multibuy: special && mbEach ? { qty: p.cur_multibuy_qty, cents: p.cur_multibuy_cents } : null,
    saving: special && p.cur_was_cents && p.cur_was_cents > effective ? p.cur_was_cents - effective : null,
    discountFlag: special ? p.discount_flag : null,
    low12: p.low12_cents,
    historyWeeks: p.history_weeks,
    inStock: p.cur_in_stock !== 0,
    source: p.cur_source,
    checkedAt: p.cur_captured_at,
    stale: !fresh,
    anomaly: p.price_flag === 'anomaly',
  };
}

const sortOffers = (a, b) => (a.effective ?? 1e12) - (b.effective ?? 1e12);

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, ...opts });
};

route('POST', '/api/login', async ({ env, request }) => {
  const { code, name } = await body(request);
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!cleanName) throw new HttpError(400, 'Please enter your name');
  const isAdmin = env.ADMIN_CODE && safeEqual(String(code || '').trim(), env.ADMIN_CODE);
  const isUser = isAdmin || (env.INVITE_CODE && safeEqual(String(code || '').trim(), env.INVITE_CODE));
  if (!isUser) throw new HttpError(401, 'That invite code is not right');
  const id = 'u:' + normText(cleanName).replace(/\s+/g, '-');
  const existing = await env.DB.prepare('SELECT id, is_admin FROM users WHERE id = ?').bind(id).first();
  if (!existing) {
    await env.DB.prepare('INSERT INTO users (id, name, is_admin, created_at) VALUES (?, ?, ?, ?)').bind(id, cleanName, isAdmin ? 1 : 0, nowIso()).run();
    await env.DB.prepare('INSERT INTO lists (id, user_id, name, retailer, created_at) VALUES (?, ?, ?, NULL, ?)').bind(uid(), id, 'My list', nowIso()).run();
  } else if (isAdmin && !existing.is_admin) {
    await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(id).run();
  }
  const token = await makeSession(env, id);
  return json({ ok: true, user: { id, name: cleanName, isAdmin: !!(isAdmin || existing?.is_admin) } }, 200, { 'Set-Cookie': cookieHeader(token, 90 * 86400, request) });
}, { public: true });

route('POST', '/api/logout', async ({ request }) => json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0, request) }), { public: true });

const ACT = "retailer IN ('woolworths','coles')";
const isActive = (r) => ACTIVE_RETAILERS.includes(r);
const AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
const GENDERS = ['male', 'female', 'other'];
const HOUSEHOLD = ['1', '2', '3', '4', '5+'];
const SHOP_CATEGORIES = CATEGORY_LIST.filter((c) => c !== 'Liquor');
const parseFavs = (u) => { try { const a = JSON.parse(u.fav_categories || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const profileOf = (u) => ({ ageRange: u.age_range, gender: u.gender, household: u.household_size, favCategories: parseFavs(u), done: !!u.profile_done_at });

/** "New" = first seen after the starting range was collected, within the last 7 days (30 days once live for a month). */
async function newWindow(env) {
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'new_baseline_at'").first().catch(() => null);
  const baseline = row?.value || null;
  const monthly = baseline && Date.now() - Date.parse(baseline) > 30 * 86400000;
  const days = monthly ? 30 : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return { baseline, days, label: monthly ? 'New this month' : 'New this week', since: baseline && baseline > since ? baseline : since };
}

const SAVING_ORDER = 'CASE WHEN cur_is_special = 1 AND cur_was_cents > 0 THEN (cur_was_cents - cur_price_cents) * 1.0 / cur_was_cents ELSE 0 END DESC';
function catOrder(retailer, names) {
  const order = RETAILER_CATEGORY_ORDER[retailer] || SHOP_CATEGORIES;
  const pos = (n) => { const i = order.indexOf(n); return i < 0 ? 999 : i; };
  return names.sort((a, b) => pos(a.name) - pos(b.name) || (b.count - a.count));
}

route('GET', '/api/me', async ({ user, env }) => json({
  user: { id: user.id, name: user.name, isAdmin: !!user.is_admin },
  profile: profileOf(user),
  needsProfile: !user.profile_done_at,
  vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
}));

route('GET', '/api/profile/options', async () => json({ ageRanges: AGE_RANGES, genders: GENDERS, household: HOUSEHOLD, categories: SHOP_CATEGORIES }));

route('POST', '/api/profile', async ({ env, user, request }) => {
  const b = await body(request);
  if (!AGE_RANGES.includes(b.ageRange)) throw new HttpError(400, 'Please choose your age range');
  if (!GENDERS.includes(b.gender)) throw new HttpError(400, 'Please choose your gender');
  if (!HOUSEHOLD.includes(String(b.household))) throw new HttpError(400, 'Please choose how many people live in your home');
  const favs = (Array.isArray(b.favCategories) ? b.favCategories : []).filter((c) => SHOP_CATEGORIES.includes(c));
  if (!favs.length) throw new HttpError(400, 'Pick at least one category');
  await env.DB.prepare('UPDATE users SET age_range = ?, gender = ?, household_size = ?, fav_categories = ?, profile_done_at = COALESCE(profile_done_at, ?) WHERE id = ?')
    .bind(b.ageRange, b.gender, String(b.household), JSON.stringify(favs), nowIso(), user.id).run();
  return json({ ok: true });
});

route('GET', '/api/meta', async ({ env }) => {
  const rows = (await env.DB.prepare(`SELECT retailer, COUNT(*) AS products, MAX(cur_captured_at) AS updated,
      SUM(CASE WHEN cur_is_special = 1 AND cur_captured_at >= ? THEN 1 ELSE 0 END) AS specials
      FROM retailer_product WHERE ${ACT} GROUP BY retailer`).bind(freshCut()).all()).results;
  const nw = await newWindow(env);
  return json({ categories: SHOP_CATEGORIES, retailers: rows, newSince: nw.since, newLabel: nw.label, newReady: !!nw.baseline });
});

/** Category options. scope=deals counts current specials only; scope=all counts every product (Browse). */
route('GET', '/api/categories', async ({ env, url }) => {
  const retailer = url.searchParams.get('retailer');
  const deals = url.searchParams.get('scope') === 'deals';
  const where = deals ? `cur_is_special = 1 AND cur_captured_at >= ? AND ${ACT}` : `cur_price_cents IS NOT NULL AND ${ACT}`;
  const binds = deals ? [freshCut()] : [];
  if (retailer && isActive(retailer)) {
    const rows = (await env.DB.prepare(`SELECT cat1, cat2, COUNT(*) AS n FROM retailer_product WHERE ${where} AND retailer = ? GROUP BY cat1, cat2`).bind(...binds, retailer).all()).results;
    const top = new Map();
    for (const r of rows) {
      const k = r.cat1 || 'Other';
      if (!top.has(k)) top.set(k, { name: k, count: 0, children: [] });
      const t = top.get(k); t.count += r.n;
      if (r.cat2) t.children.push({ name: r.cat2, count: r.n });
    }
    for (const t of top.values()) t.children.sort((a, b) => b.count - a.count);
    return json({ retailer, categories: catOrder(retailer, [...top.values()]) });
  }
  const rows = (await env.DB.prepare(`SELECT category AS name, COUNT(*) AS count FROM retailer_product WHERE ${where} GROUP BY category`).bind(...binds).all()).results;
  const counts = new Map(rows.map((r) => [r.name || 'Other', r.count]));
  const list = SHOP_CATEGORIES.map((c) => ({ name: c, count: counts.get(c) || 0 })).filter((c) => c.count > 0);
  return json({ retailer: null, categories: list });
});

/** Home "Best Deals". No store + no category = personalised ("For you"). */
async function deals({ env, url, user }) {
  const q = url.searchParams;
  const where = ['cur_is_special = 1', 'cur_captured_at >= ?', ACT];
  const binds = [freshCut()];
  const retailer = q.get('retailer');
  const category = q.get('category');
  if (retailer && isActive(retailer)) {
    where.push('retailer = ?'); binds.push(retailer);
    if (category) { where.push('cat1 = ?'); binds.push(category); }
  } else if (category) { where.push('category = ?'); binds.push(category); }
  if (q.get('half') === '1') where.push("cur_promo_type = 'half_price'");
  const sort = q.get('sort') === 'price' ? 'price' : 'saving';
  let order = sort === 'price' ? 'cur_price_cents ASC, name' : `${SAVING_ORDER}, name`;
  let forYou = false;
  if (!retailer && !category && user) {
    // Favourite categories and categories already on the tester's lists come first.
    const favs = parseFavs(user);
    const listCats = (await env.DB.prepare(`SELECT DISTINCT p.category FROM list_items li JOIN lists l ON l.id = li.list_id JOIN retailer_product p ON p.id = li.product_id WHERE l.user_id = ?`).bind(user.id).all()).results.map((r) => r.category).filter(Boolean);
    const prefer = [...new Set([...favs, ...listCats])].slice(0, 12);
    if (prefer.length) {
      forYou = true;
      order = `CASE WHEN category IN (${prefer.map(() => '?').join(',')}) THEN 0 ELSE 1 END, ${order}`;
      binds.push(...prefer);
    }
  }
  const page = Math.max(0, parseInt(q.get('page') || '0', 10));
  const rows = (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${page * PAGE}`).bind(...binds).all()).results;
  return json({ items: rows.slice(0, PAGE).map(pub), more: rows.length > PAGE, page, forYou });
}
route('GET', '/api/deals', deals);
route('GET', '/api/specials', deals);

/** Browse a store's range: every product, filtered by the store's own categories. */
route('GET', '/api/browse', async ({ env, url }) => {
  const q = url.searchParams;
  const retailer = q.get('retailer');
  if (!isActive(retailer)) throw new HttpError(400, 'Choose Woolworths or Coles');
  const where = ['retailer = ?', 'cur_price_cents IS NOT NULL'];
  const binds = [retailer];
  if (q.get('cat1')) { where.push('cat1 = ?'); binds.push(q.get('cat1')); }
  if (q.get('cat2')) { where.push('cat2 = ?'); binds.push(q.get('cat2')); }
  const sort = ['new', 'saving', 'price_asc', 'price_desc'].includes(q.get('sort')) ? q.get('sort') : 'new';
  const nw = await newWindow(env);
  if (sort === 'new') {
    where.push('first_seen_at > ?'); binds.push(nw.since);
    if (!nw.baseline) where.push('0'); // nothing counts as new until the starting range is in
  }
  const order = {
    new: 'first_seen_at DESC, name',
    saving: `${SAVING_ORDER}, name`,
    price_asc: 'COALESCE(cur_price_cents, 1e12) ASC, name',
    price_desc: 'cur_price_cents DESC, name',
  }[sort];
  const page = Math.max(0, parseInt(q.get('page') || '0', 10));
  const rows = (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${page * PAGE}`).bind(...binds).all()).results;
  return json({ items: rows.slice(0, PAGE).map(pub), more: rows.length > PAGE, page, newLabel: nw.label, newSince: nw.since });
});

// ----- search -----
const SEARCH_SORTS = ['relevance', 'unit', 'saving', 'price_asc', 'price_desc'];
const HOT_PRESET = ['milk', 'eggs', 'bread', 'coffee', 'toilet paper', 'chicken breast', 'laundry liquid', 'chocolate', 'olive oil', 'nappies'];
const cleanQuery = (s) => normText(s).slice(0, 60).trim();
/** Every typed word must start a word in the name or brand ("tim ta" finds Tim Tam, not inTIMate TAblets). */
function wordMatch(tokens) {
  const where = tokens.map(() => "((' ' || LOWER(name)) LIKE ? OR (' ' || LOWER(COALESCE(brand,''))) LIKE ?)");
  const binds = tokens.flatMap((t) => [`% ${t}%`, `% ${t}%`]);
  return { where, binds };
}

route('GET', '/api/search', async ({ env, url, user }) => {
  const raw = (url.searchParams.get('q') || '').trim();
  const sort = SEARCH_SORTS.includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'relevance';
  const tokens = normText(raw).split(' ').filter((t) => t.length > 1).slice(0, 6);
  if (!tokens.length) return json({ groups: [] });
  const { where, binds } = wordMatch(tokens);
  const rows = (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE ${where.join(' AND ')} AND ${ACT} AND cur_price_cents IS NOT NULL LIMIT 400`).bind(...binds).all()).results;
  const groups = new Map();
  for (const r of rows) {
    const k = r.canonical_product_id || `c:${r.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(pub(r));
  }
  let out = [...groups.entries()].map(([id, offers]) => {
    offers.sort(sortOffers);
    const best = offers[0];
    return { id, name: best.name, brand: best.brand, size: best.size, image: offers.find((o) => o.image)?.image || null, best, offers, unitBasis: best.unitBasis };
  });
  // Relevance: whole phrase in the name > all words at the start of the name > brand match; shorter names first.
  const phrase = tokens.join(' ');
  const wordRes = tokens.map((t) => new RegExp(`(^| )${t.replace(/[^a-z0-9]/g, '')}( |$)`));
  const rel = (g) => {
    const n = normText(g.name);
    return (wordRes.every((re) => re.test(n)) ? 0 : 4) + (n.includes(phrase) ? 0 : 2) + (n.startsWith(tokens[0]) || normText(g.brand).startsWith(tokens[0]) ? 0 : 1) + (g.offers.length > 1 ? 0 : 0.5);
  };
  const price = (g) => g.best.effective ?? 1e12;
  const saving = (g) => Math.max(...g.offers.map((o) => (o.saving && o.was ? o.saving / o.was : 0)));
  const cmp = {
    relevance: (a, b) => rel(a) - rel(b) || a.name.length - b.name.length || price(a) - price(b),
    unit: (a, b) => (a.best.unit ?? 1e12) - (b.best.unit ?? 1e12),
    saving: (a, b) => saving(b) - saving(a) || price(a) - price(b),
    price_asc: (a, b) => price(a) - price(b),
    price_desc: (a, b) => price(b) - price(a),
  }[sort];
  out.sort(cmp);
  out = out.slice(0, 80);
  // Log once per search (not on re-sorts).
  if (url.searchParams.get('log') !== '0') {
    const qn = cleanQuery(raw);
    if (qn) {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO search_log (user_id, query, created_at) VALUES (?, ?, ?)').bind(user.id, qn, nowIso()),
        env.DB.prepare('INSERT INTO search_history (user_id, query, last_at) VALUES (?, ?, ?) ON CONFLICT(user_id, query) DO UPDATE SET last_at = excluded.last_at').bind(user.id, qn, nowIso()),
      ]).catch(() => {});
    }
  }
  return json({ groups: out, count: rows.length });
});

route('GET', '/api/suggest', async ({ env, url }) => {
  const tokens = normText(url.searchParams.get('q') || '').split(' ').filter(Boolean).slice(0, 5);
  if (!tokens.length || tokens.join('').length < 2) return json({ suggestions: [] });
  const { where, binds } = wordMatch(tokens);
  const rows = (await env.DB.prepare(`SELECT name, brand FROM retailer_product WHERE ${where.join(' AND ')} AND ${ACT} LIMIT 200`).bind(...binds).all()).results;
  const first = tokens[0];
  const seen = new Set(), out = [];
  // Brands first (if typed text matches one), then product names; names starting with the text rank higher.
  const brands = [...new Set(rows.map((r) => r.brand).filter((b) => b && normText(b).includes(tokens.join(' '))))].slice(0, 2);
  for (const b of brands) { const k = normText(b); if (!seen.has(k)) { seen.add(k); out.push({ text: b, kind: 'brand' }); } }
  rows.sort((a, b) => (normText(a.name).startsWith(first) ? 0 : 1) - (normText(b.name).startsWith(first) ? 0 : 1) || a.name.length - b.name.length);
  for (const r of rows) {
    const k = normText(r.name);
    if (seen.has(k)) continue;
    seen.add(k); out.push({ text: r.name, kind: 'product' });
    if (out.length >= 8) break;
  }
  return json({ suggestions: out });
});

route('GET', '/api/search/hot', async ({ env }) => {
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM search_log').first();
  if ((total?.n || 0) < 30) return json({ keywords: HOT_PRESET, source: 'preset' });
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = (await env.DB.prepare('SELECT query, COUNT(DISTINCT user_id) AS people, COUNT(*) AS n FROM search_log WHERE created_at >= ? GROUP BY query ORDER BY people DESC, n DESC LIMIT 10').bind(since).all()).results;
  const words = rows.map((r) => r.query);
  for (const w of HOT_PRESET) { if (words.length >= 10) break; if (!words.includes(w)) words.push(w); }
  return json({ keywords: words, source: rows.length ? 'live' : 'preset' });
});

route('GET', '/api/search/history', async ({ env, user }) => {
  const rows = (await env.DB.prepare('SELECT query FROM search_history WHERE user_id = ? ORDER BY last_at DESC LIMIT 10').bind(user.id).all()).results;
  return json({ history: rows.map((r) => r.query) });
});
route('DELETE', '/api/search/history', async ({ env, user, url }) => {
  const q = url.searchParams.get('q');
  if (q) await env.DB.prepare('DELETE FROM search_history WHERE user_id = ? AND query = ?').bind(user.id, q).run();
  else await env.DB.prepare('DELETE FROM search_history WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true });
});

/** Which products are on the tester's lists (for the heart buttons). */
route('GET', '/api/saved', async ({ env, user }) => {
  const rows = (await env.DB.prepare('SELECT li.id, li.product_id, li.alert_mode, li.target_cents, l.id AS list_id, l.name AS list_name FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.user_id = ?').bind(user.id).all()).results;
  return json({ saved: rows });
});

route('GET', '/api/product/:id', async ({ env, params, user }) => {
  const p = await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE id = ?`).bind(params.id).first();
  if (!p) throw new HttpError(404, 'Product not found');
  const canon = p.canonical_product_id || `c:${p.id}`;
  const offers = (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE (id = ? OR canonical_product_id = ?) AND ${ACT}`).bind(p.id, canon).all()).results.map(pub).sort(sortOffers);
  const sizes = p.family_id
    ? (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE family_id = ? AND id != ? AND ${ACT} AND cur_price_cents IS NOT NULL ORDER BY cur_unit_cents IS NULL, cur_unit_cents LIMIT 12`).bind(p.family_id, p.id).all()).results.map(pub).filter((x) => !offers.some((o) => o.id === x.id))
    : [];
  const similar = p.comparable_group_id
    ? (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE comparable_group_id = ? AND id != ? AND ${ACT} AND cur_price_cents IS NOT NULL AND cur_unit_basis = ? ORDER BY cur_unit_cents LIMIT 12`).bind(p.comparable_group_id, p.id, p.cur_unit_basis).all()).results.map(pub).filter((x) => !offers.some((o) => o.id === x.id))
    : [];
  const since = new Date(Date.now() - 84 * 86400000).toISOString();
  const history = (await env.DB.prepare(`SELECT product_id, price_cents, is_special, captured_at FROM price_snapshot WHERE product_id IN (SELECT id FROM retailer_product WHERE (id = ? OR canonical_product_id = ?) AND ${ACT}) AND captured_at >= ? ORDER BY captured_at`).bind(p.id, canon, since).all()).results;
  const saved = (await env.DB.prepare(`SELECT li.id, li.alert_mode, li.target_cents, l.id AS list_id, l.name AS list_name FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.user_id = ? AND li.product_id = ?`).bind(user.id, p.id).all()).results;
  return json({ product: pub(p), offers, sizes, similar, history, saved });
});

// ----- lists -----
async function ownList(env, user, listId) {
  const l = await env.DB.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').bind(listId, user.id).first();
  if (!l) throw new HttpError(404, 'List not found');
  return l;
}
async function ownItem(env, user, itemId) {
  const it = await env.DB.prepare('SELECT li.* FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.id = ? AND l.user_id = ?').bind(itemId, user.id).first();
  if (!it) throw new HttpError(404, 'Item not found');
  return it;
}
const ALERT_MODES = ['any', 'half', 'target', 'off'];

route('GET', '/api/lists', async ({ env, user }) => {
  let lists = (await env.DB.prepare('SELECT id, name, retailer, created_at FROM lists WHERE user_id = ? ORDER BY created_at').bind(user.id).all()).results;
  if (!lists.length) {
    const id = uid();
    await env.DB.prepare('INSERT INTO lists (id, user_id, name, retailer, created_at) VALUES (?, ?, ?, NULL, ?)').bind(id, user.id, 'My list', nowIso()).run();
    lists = [{ id, name: 'My list', retailer: null }];
  }
  const items = (await env.DB.prepare(`SELECT li.id AS item_id, li.list_id, li.alert_mode, li.target_cents, ${COLS.split(',').map((c) => 'p.' + c.trim()).join(', ')}
      FROM list_items li JOIN lists l ON l.id = li.list_id JOIN retailer_product p ON p.id = li.product_id
      WHERE l.user_id = ? ORDER BY li.created_at DESC`).bind(user.id).all()).results;
  // Best current offer for each item across matched products (respecting list retailer).
  const canons = [...new Set(items.map((i) => i.canonical_product_id).filter(Boolean))];
  const twins = new Map();
  for (let i = 0; i < canons.length; i += 80) {
    const chunk = canons.slice(i, i + 80);
    const rows = (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE canonical_product_id IN (${chunk.map(() => '?').join(',')}) AND ${ACT}`).bind(...chunk).all()).results;
    for (const r of rows) {
      if (!twins.has(r.canonical_product_id)) twins.set(r.canonical_product_id, []);
      twins.get(r.canonical_product_id).push(pub(r));
    }
  }
  const byList = new Map(lists.map((l) => [l.id, { ...l, items: [] }]));
  for (const it of items) {
    const list = byList.get(it.list_id);
    const product = pub(it);
    let offers = (twins.get(it.canonical_product_id) || [product]).filter((o) => !list.retailer || o.retailer === list.retailer);
    if (!offers.length) offers = [product];
    offers.sort(sortOffers);
    list.items.push({ id: it.item_id, alertMode: it.alert_mode, target: it.target_cents, product, best: offers[0], offers });
  }
  return json({ lists: [...byList.values()] });
});

route('POST', '/api/lists', async ({ env, user, request }) => {
  const { name, retailer } = await body(request);
  const n = String(name || '').trim().slice(0, 60) || 'New list';
  const r = isActive(retailer) ? retailer : null;
  const id = uid();
  await env.DB.prepare('INSERT INTO lists (id, user_id, name, retailer, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, user.id, n, r, nowIso()).run();
  return json({ id, name: n, retailer: r });
});

route('PATCH', '/api/lists/:id', async ({ env, user, request, params }) => {
  await ownList(env, user, params.id);
  const { name, retailer } = await body(request);
  if (name !== undefined) await env.DB.prepare('UPDATE lists SET name = ? WHERE id = ?').bind(String(name).trim().slice(0, 60) || 'List', params.id).run();
  if (retailer !== undefined) await env.DB.prepare('UPDATE lists SET retailer = ? WHERE id = ?').bind(isActive(retailer) ? retailer : null, params.id).run();
  return json({ ok: true });
});

route('DELETE', '/api/lists/:id', async ({ env, user, params }) => {
  await ownList(env, user, params.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM list_items WHERE list_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(params.id),
  ]);
  return json({ ok: true });
});

route('POST', '/api/lists/:id/items', async ({ env, user, request, params }) => {
  await ownList(env, user, params.id);
  const { product_id, alert_mode = 'any', target_cents = null } = await body(request);
  const p = await env.DB.prepare('SELECT id FROM retailer_product WHERE id = ?').bind(product_id).first();
  if (!p) throw new HttpError(404, 'Product not found');
  const mode = ALERT_MODES.includes(alert_mode) ? alert_mode : 'any';
  const id = uid();
  await env.DB.prepare(`INSERT INTO list_items (id, list_id, product_id, alert_mode, target_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(list_id, product_id) DO UPDATE SET alert_mode = excluded.alert_mode, target_cents = excluded.target_cents`)
    .bind(id, params.id, product_id, mode, Number.isFinite(target_cents) ? Math.round(target_cents) : null, nowIso()).run();
  return json({ ok: true });
});

route('PATCH', '/api/items/:id', async ({ env, user, request, params }) => {
  await ownItem(env, user, params.id);
  const { alert_mode, target_cents } = await body(request);
  if (alert_mode !== undefined && ALERT_MODES.includes(alert_mode)) await env.DB.prepare('UPDATE list_items SET alert_mode = ? WHERE id = ?').bind(alert_mode, params.id).run();
  if (target_cents !== undefined) await env.DB.prepare('UPDATE list_items SET target_cents = ? WHERE id = ?').bind(Number.isFinite(target_cents) ? Math.round(target_cents) : null, params.id).run();
  return json({ ok: true });
});

route('DELETE', '/api/items/:id', async ({ env, user, params }) => {
  await ownItem(env, user, params.id);
  await env.DB.prepare('DELETE FROM list_items WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

route('GET', '/api/digest', async ({ env, user }) => {
  const rows = (await env.DB.prepare(`
    SELECT DISTINCT li.id AS item_id, li.alert_mode, li.target_cents, ${COLS.split(',').map((c) => 'o.' + c.trim()).join(', ')}
      FROM list_items li JOIN lists l ON l.id = li.list_id
      JOIN retailer_product p ON p.id = li.product_id
      JOIN retailer_product o ON (o.id = p.id OR (p.canonical_product_id IS NOT NULL AND o.canonical_product_id = p.canonical_product_id))
     WHERE l.user_id = ? AND o.cur_is_special = 1 AND o.cur_captured_at >= ? AND o.retailer IN ('woolworths','coles')
       AND (l.retailer IS NULL OR l.retailer = o.retailer)`).bind(user.id, freshCut()).all()).results;
  const best = new Map();
  for (const r of rows) {
    const o = pub(r);
    const prev = best.get(r.item_id);
    if (!prev || o.effective < prev.effective) best.set(r.item_id, { ...o, alertMode: r.alert_mode, target: r.target_cents });
  }
  const top = (await env.DB.prepare(`SELECT ${COLS} FROM retailer_product WHERE cur_is_special = 1 AND cur_captured_at >= ? AND cur_promo_type = 'half_price' AND ${ACT}
      AND COALESCE(discount_flag,'') != 'inflated' AND cur_was_cents > 0 ORDER BY (cur_was_cents - cur_price_cents) DESC LIMIT 12`).bind(freshCut()).all()).results.map(pub);
  return json({ fromYourList: [...best.values()].sort((a, b) => (b.saving || 0) - (a.saving || 0)), topHalfPrice: top });
});

// ----- push -----
route('GET', '/api/push/key', async ({ env }) => json({ key: env.VAPID_PUBLIC_KEY || null }));
route('POST', '/api/push/subscribe', async ({ env, user, request }) => {
  const { endpoint, keys } = await body(request);
  if (!endpoint || !keys?.p256dh || !keys?.auth || !/^https:\/\//.test(endpoint)) throw new HttpError(400, 'Bad subscription');
  await env.DB.prepare(`INSERT INTO push_subs (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .bind(uid(), user.id, endpoint, keys.p256dh, keys.auth, nowIso()).run();
  return json({ ok: true });
});
route('POST', '/api/push/unsubscribe', async ({ env, user, request }) => {
  const { endpoint } = await body(request);
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(endpoint || '', user.id).run();
  return json({ ok: true });
});
route('GET', '/api/push/status', async ({ env, user }) => {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').bind(user.id).first();
  return json({ devices: r.n });
});

// ----- Costco reports -----
route('POST', '/api/reports', async ({ env, user, request }) => {
  const b = await body(request);
  const name = String(b.name || '').trim().slice(0, 120);
  const price = toCents(b.price);
  if (!name || !price || price <= 0 || price > 500000) throw new HttpError(400, 'Name and price are required');
  const observed = /^\d{4}-\d{2}-\d{2}$/.test(b.observed_on || '') ? b.observed_on : nowIso().slice(0, 10);
  await env.DB.prepare(`INSERT INTO user_reports (id, user_id, retailer, name, brand, size_text, price_cents, store, gtin, observed_on, note, status, created_at)
      VALUES (?, ?, 'costco', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .bind(uid(), user.id, name, (b.brand || '').trim().slice(0, 60) || null, (b.size_text || '').trim().slice(0, 40) || null, price,
      (b.store || '').trim().slice(0, 60) || null, String(b.gtin || '').replace(/\D/g, '').slice(0, 14) || null, observed, (b.note || '').trim().slice(0, 300) || null, nowIso()).run();
  return json({ ok: true });
});
route('GET', '/api/reports/mine', async ({ env, user }) => {
  const rows = (await env.DB.prepare('SELECT id, name, brand, size_text, price_cents, store, observed_on, status, created_at FROM user_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all()).results;
  return json({ reports: rows });
});

// ----- admin -----
const slug = (s) => normText(s).replace(/\s+/g, '-').slice(0, 80);

/** Upsert a manually sourced product (Aldi CSV, approved Costco report) and add a snapshot. */
function manualUpsert(env, { retailer, name, brand, size_text, price_cents, was_cents = null, is_special = 0, promo_text = null, url = null, gtin = null, category = null, source, reported_by = null, captured_at }) {
  const size = parseSize(size_text, name);
  const unit = unitPriceCents(price_cents, size.size_value, size.size_unit);
  const id = `${retailer}:${slug(`${brand || ''} ${name} ${size_text || ''}`)}`;
  const cat = category && CATEGORY_LIST.includes(category) ? category : mapCategory(category || '', name);
  const stmts = [
    env.DB.prepare(`INSERT INTO retailer_product (id, retailer, retailer_product_id, name, brand, size_text, size_value, size_unit, pack_count, uses_per_pack, gtin,
        category, product_url, family_id, comparable_group_id, cur_price_cents, cur_was_cents, cur_unit_cents, cur_unit_basis, cur_is_special, cur_promo_type,
        cur_promo_text, cur_in_stock, cur_source, cur_captured_at, special_since, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, brand = excluded.brand, size_text = excluded.size_text, size_value = excluded.size_value,
        size_unit = excluded.size_unit, gtin = COALESCE(excluded.gtin, retailer_product.gtin), category = excluded.category,
        product_url = COALESCE(excluded.product_url, retailer_product.product_url),
        cur_price_cents = excluded.cur_price_cents, cur_was_cents = excluded.cur_was_cents, cur_unit_cents = excluded.cur_unit_cents,
        cur_unit_basis = excluded.cur_unit_basis, cur_is_special = excluded.cur_is_special, cur_promo_type = excluded.cur_promo_type,
        cur_promo_text = excluded.cur_promo_text, cur_source = excluded.cur_source, cur_captured_at = excluded.cur_captured_at,
        special_since = CASE WHEN excluded.cur_is_special = 1 THEN COALESCE(retailer_product.special_since, excluded.special_since) ELSE NULL END,
        last_seen_at = excluded.last_seen_at`)
      .bind(id, retailer, id.split(':')[1], name, brand || null, size_text || null, size.size_value, size.size_unit, size.pack_count, parseUses(name, size_text), gtin || null,
        cat, url, familyKey(brand, name), comparableGroup(name, brand, size.size_unit), price_cents, was_cents, unit, unitBasisFor(size.size_unit), is_special ? 1 : 0,
        is_special ? 'other' : null, promo_text, source, captured_at, is_special ? captured_at : null, captured_at, captured_at),
    env.DB.prepare(`INSERT INTO price_snapshot (product_id, price_cents, was_cents, unit_cents, unit_basis, is_special, promo_type, promo_text, in_stock, price_context, source, reported_by, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(id, price_cents, was_cents, unit, unitBasisFor(size.size_unit), is_special ? 1 : 0, is_special ? 'other' : null, promo_text, retailer === 'costco' ? 'warehouse' : 'national', source, reported_by, captured_at),
  ];
  return { id, stmts };
}

route('GET', '/api/admin/overview', async ({ env }) => {
  const spend = await env.DB.prepare('SELECT COALESCE(SUM(cost_usd),0) AS usd FROM pipeline_runs').first();
  const runs = (await env.DB.prepare('SELECT id, mode, retailer, started_at, finished_at, status, items, cost_usd, message FROM pipeline_runs ORDER BY id DESC LIMIT 20').all()).results;
  const counts = (await env.DB.prepare(`SELECT retailer, COUNT(*) AS products,
      SUM(CASE WHEN cur_captured_at >= ? THEN 1 ELSE 0 END) AS fresh28,
      SUM(CASE WHEN cur_is_special = 1 AND cur_captured_at >= ? THEN 1 ELSE 0 END) AS specials,
      SUM(CASE WHEN match_method IN ('gtin','rule','manual') THEN 1 ELSE 0 END) AS matched,
      SUM(CASE WHEN price_flag = 'anomaly' THEN 1 ELSE 0 END) AS anomalies,
      MAX(cur_captured_at) AS updated
      FROM retailer_product GROUP BY retailer`).bind(new Date(Date.now() - 28 * 86400000).toISOString(), freshCut()).all()).results;
  const pending = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM user_reports WHERE status='pending') AS reports, (SELECT COUNT(*) FROM match_candidate WHERE status='pending') AS matches").first();
  const users = (await env.DB.prepare(`SELECT u.name, u.created_at, u.age_range, u.gender, u.household_size, u.fav_categories,
      (SELECT COUNT(*) FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.user_id = u.id) AS items,
      (SELECT COUNT(*) FROM search_log q WHERE q.user_id = u.id) AS searches,
      (SELECT COUNT(*) FROM push_subs s WHERE s.user_id = u.id) AS devices FROM users u ORDER BY u.created_at`).all()).results;
  return json({ spendUsd: spend.usd, budgetUsd: 100, runs, counts, pending, users });
}, { admin: true });

route('GET', '/api/admin/reports', async ({ env }) => {
  const rows = (await env.DB.prepare(`SELECT r.*, u.name AS user_name FROM user_reports r LEFT JOIN users u ON u.id = r.user_id ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 100`).all()).results;
  return json({ reports: rows });
}, { admin: true });

route('POST', '/api/admin/reports/:id', async ({ env, user, request, params }) => {
  const { action } = await body(request);
  const r = await env.DB.prepare('SELECT * FROM user_reports WHERE id = ?').bind(params.id).first();
  if (!r) throw new HttpError(404, 'Report not found');
  if (action === 'reject') {
    await env.DB.prepare("UPDATE user_reports SET status = 'rejected', reviewed_by = ? WHERE id = ?").bind(user.id, r.id).run();
    return json({ ok: true });
  }
  if (action !== 'approve') throw new HttpError(400, 'action must be approve or reject');
  const { id, stmts } = manualUpsert(env, {
    retailer: 'costco', name: r.name, brand: r.brand, size_text: r.size_text, price_cents: r.price_cents, gtin: r.gtin,
    source: 'user_report', reported_by: r.user_id, captured_at: `${r.observed_on}T12:00:00.000Z`,
  });
  await env.DB.batch([...stmts, env.DB.prepare("UPDATE user_reports SET status = 'approved', reviewed_by = ?, product_id = ? WHERE id = ?").bind(user.id, id, r.id)]);
  return json({ ok: true, product_id: id });
}, { admin: true });

// Aldi CSV: name,brand,size,price[,was_price,special,url,category]
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

route('POST', '/api/admin/aldi', async ({ env, request }) => {
  const { csv } = await body(request);
  const rows = parseCsv(String(csv || ''));
  if (!rows.length) throw new HttpError(400, 'Empty CSV');
  const header = rows[0].map((h) => normText(h));
  const hasHeader = header.includes('name') && header.includes('price');
  const idx = (k, d) => (hasHeader ? header.indexOf(k) : d);
  const col = { name: idx('name', 0), brand: idx('brand', 1), size: idx('size', 2), price: idx('price', 3), was: idx('was price', 4) >= 0 ? idx('was price', 4) : idx('was', 4), special: idx('special', 5), url: idx('url', 6), category: idx('category', 7) };
  const captured = nowIso();
  const stmts = [], errors = [];
  for (const [n, r] of rows.slice(hasHeader ? 1 : 0).entries()) {
    const get = (k) => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');
    const price = toCents(get('price'));
    if (!get('name') || !price) { errors.push(`row ${n + 1}: missing name or price`); continue; }
    const special = /^(1|y|yes|true|special)$/i.test(get('special'));
    stmts.push(...manualUpsert(env, {
      retailer: 'aldi', name: get('name'), brand: get('brand') || null, size_text: get('size') || null, price_cents: price,
      was_cents: toCents(get('was')), is_special: special ? 1 : 0, promo_text: special ? 'ALDI special' : null,
      url: get('url') || null, category: get('category') || null, source: 'manual', captured_at: captured,
    }).stmts);
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return json({ ok: true, imported: stmts.length / 2, errors });
}, { admin: true });

route('GET', '/api/admin/matches', async ({ env }) => {
  const rows = (await env.DB.prepare(`SELECT m.id, m.score, m.status, a.id AS a_id, a.retailer AS a_retailer, a.name AS a_name, a.size_text AS a_size, a.cur_price_cents AS a_price, a.image_url AS a_image,
        b.id AS b_id, b.retailer AS b_retailer, b.name AS b_name, b.size_text AS b_size, b.cur_price_cents AS b_price, b.image_url AS b_image
      FROM match_candidate m JOIN retailer_product a ON a.id = m.product_a JOIN retailer_product b ON b.id = m.product_b
      WHERE m.status = 'pending' ORDER BY m.score DESC LIMIT 50`).all()).results;
  return json({ matches: rows });
}, { admin: true });

route('POST', '/api/admin/matches/:id', async ({ env, user, request, params }) => {
  const { action } = await body(request);
  const m = await env.DB.prepare('SELECT * FROM match_candidate WHERE id = ?').bind(params.id).first();
  if (!m) throw new HttpError(404, 'Not found');
  if (action === 'approve') {
    const a = await env.DB.prepare('SELECT id, canonical_product_id FROM retailer_product WHERE id = ?').bind(m.product_a).first();
    const canon = a?.canonical_product_id || `c:${m.product_a}`;
    await env.DB.batch([
      env.DB.prepare("UPDATE retailer_product SET canonical_product_id = ?, match_method = 'manual', match_confidence = 1 WHERE id IN (?, ?)").bind(canon, m.product_a, m.product_b),
      env.DB.prepare("UPDATE match_candidate SET status = 'approved', decided_by = ? WHERE id = ?").bind(user.id, m.id),
    ]);
  } else if (action === 'reject') {
    await env.DB.prepare("UPDATE match_candidate SET status = 'rejected', decided_by = ? WHERE id = ?").bind(user.id, m.id).run();
  } else throw new HttpError(400, 'action must be approve or reject');
  return json({ ok: true });
}, { admin: true });

// ---------- entry ----------
export async function handle(request, env) {
  const url = new URL(request.url);
  const r = routes.find((x) => x.method === request.method && x.re.test(url.pathname));
  if (!r) return err(404, 'Not found');
  if (!env.SESSION_SECRET) return err(500, 'Server not configured (SESSION_SECRET missing)');
  const m = url.pathname.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  try {
    let user = null;
    if (!r.public) {
      const id = await readSession(env, request);
      if (!id) return err(401, 'Please sign in');
      user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
      if (!user) return err(401, 'Please sign in');
      if (r.admin && !user.is_admin) return err(403, 'Admins only');
    }
    return await r.handler({ request, env, url, params, user });
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    console.error(e);
    return err(500, 'Something went wrong');
  }
}

