// Fair Whack beta — single-page app (no build step).
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
// Store names and the stores shown: filled from /api/meta (stores that have products). These are the fallbacks.
const RET = { woolworths: 'Woolworths', coles: 'Coles', aldi: 'ALDI', jbhifi: 'JB Hi-Fi', costco: 'Costco', kmart: 'Kmart', bunnings: 'Bunnings', petbarn: 'Petbarn', bigw: 'BIG W', chemistwarehouse: 'Chemist Warehouse', thegoodguys: 'The Good Guys', target: 'Target', officeworks: 'Officeworks', ebgames: 'EB Games', peto: 'PetO', decathlon: 'Decathlon', harveynorman: 'Harvey Norman', petstock: 'PETstock', petcircle: 'Pet Circle' };
const STORES = ['woolworths', 'coles'];
function applyStores(meta) {
  if (!meta || !Array.isArray(meta.stores) || !meta.stores.length) return;
  for (const s of meta.stores) RET[s.id] = s.name;
  STORES.splice(0, STORES.length, ...meta.stores.map((s) => s.id));
}
// Store logos (shown at 88×88; files are 264×264 for 3x screens, supplied by Alvin 26 Nov): public/icons/stores/<id>.png. A store without one shows a coloured badge.
const STORE_LOGOS = Object.fromEntries(['woolworths', 'coles', 'aldi', 'jbhifi', 'costco', 'kmart', 'bunnings', 'petbarn', 'bigw', 'chemistwarehouse',
  'thegoodguys', 'target', 'officeworks', 'ebgames', 'peto', 'decathlon', 'harveynorman', 'petstock', 'petcircle'].map((r) => [r, `/icons/stores/${r}.png?v=2`]));
const storeLogo = (r, cls = '') => `<span class="slogo ${r} ${cls} ${STORE_LOGOS[r] ? 'has-img' : ''}" aria-hidden="true">${STORE_LOGOS[r] ? `<img src="${STORE_LOGOS[r]}" alt="" width="88" height="88" decoding="async">` : `<b>${(RET[r] || '?')[0]}</b>`}</span>`;
const MARK = '<svg class="mark" viewBox="34 57 100 102" aria-hidden="true"><polygon points="76,59 89,79 111,66 108,91 132,101 113,115 124,138 99,134 88,157 76,136 52,145 58,119 36,106 58,92 52,68" fill="#C8F169"/><path d="M84 82v37M69 106l15 16 15-16" fill="none" stroke="#5B2BE0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const state = { me: null, profile: null, needsProfile: false, meta: null, vapid: null, saved: new Map(), products: new Map(), listOpen: {} };

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);
const unitText = (p) => {
  if (p.unit == null || !p.unitBasis) return p.retailerUnit || '';
  return `${money(p.unit)} / ${p.unitBasis === 'each' ? 'each' : p.unitBasis}`;
};
const monthName = (key) => { const [y, m] = String(key || '').split('-').map(Number); return y ? new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; };
const ago = (iso) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};
const initials = (n) => esc(String(n || '?').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?');
const thumb = (p) => `<div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${initials(p.brand || p.name)}'}))">` : `<span class="ph">${initials(p.brand || p.name)}</span>`}</div>`;
const qs = (o) => { const s = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && v !== false) s.set(k, v === true ? '1' : v); const t = s.toString(); return t ? `?${t}` : ''; };
const isNew = (p) => state.meta?.newReady && p.firstSeen && state.meta.newSince && p.firstSeen > state.meta.newSince;

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('.toast-btn').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), action ? 5000 : 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    state.me = null;
    if (!location.hash.startsWith('#/login')) { try { sessionStorage.setItem('fw.next', location.hash); } catch {} }
    location.replace('#/login'); throw new Error('Please sign in');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  // Something changed (list, alert, settings, shares…): Home updates the next time it's shown.
  if ((opts.method || 'GET') !== 'GET' && !path.startsWith('/api/login')) { keptHome.dirty = true; pagesChanged(); }
  return data;
}

function badges(p, { stale = true } = {}) {
  const b = [];
  if (p.promoType === 'half_price') b.push('<span class="badge b-half">½ PRICE</span>');
  else if (p.special) b.push(`<span class="badge b-promo">${esc(p.multibuy ? p.promoText || 'Multibuy' : p.promoText || 'Special')}</span>`);
  if (p.discountFlag === 'low12') b.push('<span class="badge b-low">12-wk low</span>');
  if (p.discountFlag === 'inflated') b.push('<span class="badge b-inflated" title="The “was” price is higher than its usual price">Was price inflated</span>');
  if (isNew(p)) b.push('<span class="badge b-new">NEW</span>');
  if (stale && p.stale) b.push(`<span class="badge b-stale">Checked ${ago(p.checkedAt)}</span>`);
  return b.length ? `<div class="badges">${b.join('')}</div>` : '';
}

// ---------- hearts ----------
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.6s-7.4-4.5-9.3-9.1C1.3 8.1 3.4 4.8 6.8 4.8c2 0 3.4 1.1 4.2 2.4h2c.8-1.3 2.2-2.4 4.2-2.4 3.4 0 5.5 3.3 4.1 6.7-1.9 4.6-9.3 9.1-9.3 9.1z"/></svg>';
const BELL = '<svg class="bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2zm7-6V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg>';
// 💜 with a bell = on a list with alerts; 💜 alone = on a list, no alerts of its own; outline = not saved.
// A product counts as on your list if you saved it, or saved the same product at another store.
const savedFor = (id) => state.saved.get(id) || state.savedTwins?.get(id) || null;
const heartState = (id) => { const s = savedFor(id); return !s ? '' : s.alert_mode === 'off' ? 'quiet' : 'alert'; };
const heartLabel = (st) => (st === 'alert' ? 'On your list, alerts on — settings' : st === 'quiet' ? 'On your list, no alerts — settings' : 'Add to my list');
function heart(p) {
  state.products.set(p.id, p);
  const st = heartState(p.id);
  return `<button type="button" class="heart ${st ? 'on' : ''} ${st}" data-heart="${esc(p.id)}" aria-pressed="${!!st}" aria-label="${heartLabel(st)}">${HEART}${BELL}</button>`;
}
function refreshHearts() {
  document.querySelectorAll('[data-heart]').forEach((b) => {
    const st = heartState(b.dataset.heart);
    b.classList.toggle('on', !!st); b.classList.toggle('alert', st === 'alert'); b.classList.toggle('quiet', st === 'quiet');
    b.setAttribute('aria-pressed', !!st);
    b.setAttribute('aria-label', heartLabel(st));
  });
  const w = $('#watch');
  if (w) { const on = !!savedFor(w.dataset.pid); w.textContent = on ? '♥ On your list' : '♡ Add to my list'; w.classList.toggle('ghost', on); }
}
async function loadSaved() {
  const { saved, twins = [] } = await api('/api/saved');
  state.saved = new Map(saved.map((s) => [s.product_id, s]));
  const byItem = new Map(saved.map((s) => [s.id, s]));
  state.savedTwins = new Map(twins.filter((t) => !state.saved.has(t.product_id) && byItem.has(t.item_id)).map((t) => [t.product_id, byItem.get(t.item_id)]));
  refreshHearts();
}
async function onHeart(id) {
  const p = state.products.get(id) || { id, name: 'this product' };
  const saved = savedFor(id);
  if (saved) return editItemSheet(saved, p, async () => { await loadSaved(); if (location.hash.startsWith('#/lists')) views.lists(); });
  const { lists } = await api('/api/lists');
  addToListSheet(p, lists, async () => { await loadSaved(); });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-heart]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  onHeart(b.dataset.heart).catch((err) => toast(err.message));
}, true);

function tile(p) {
  return `<a class="tile" href="#/p/${encodeURIComponent(p.id)}">
    ${thumb(p)}${badges(p)}
    <span class="ret ${p.retailer}">${RET[p.retailer]}</span>
    <div class="name">${esc(p.name)}</div>
    <div class="foot">
      <div class="price num">${money(p.effective)}${p.was ? `<small>${money(p.was)}</small>` : ''}</div>
      ${p.multibuy ? `<div class="unit">${esc(p.promoText)} · ${money(p.price)} for 1</div>` : ''}
      <div class="unit num">${esc(unitText(p))}${p.perUse ? ` · ${money(p.perUse)}/use` : ''}</div>
      ${heart(p)}
    </div>
  </a>`;
}

const LP = '<span class="lp" hidden>Lowest</span>';
/** A store's price row. lp: mark the cheapest later with a "Lowest" pill (product page) instead of "Cheapest". */
function offerRow(o, best, lp = false) {
  const save = o.saving ? `<span class="note">Save ${money(o.saving)}</span>` : '';
  return `<a class="offer ${best && !lp ? 'best' : ''}" href="#/p/${encodeURIComponent(o.id)}">
    <div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span>${badges(o)}${best && !lp ? '<span class="tag-best">Cheapest</span>' : ''}</div>
    <div class="p num"${lp ? ` data-cents="${o.effective ?? ''}"` : ''}>${money(o.effective)}${lp ? LP : ''}</div>
    <div class="note">${o.was ? `was ${money(o.was)} ` : ''}${save}</div>
    <div class="u num">${esc(unitText(o))}${o.perUse ? ` · ${money(o.perUse)}/use` : ''}</div>
  </a>`;
}

function loading(n = 4, el = app) { el.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(n)}</div>`; }
function fail(e, el = app) { el.innerHTML = `<div class="empty"><b>Something went wrong</b>${esc(e.message)}<p><button class="btn small light" onclick="location.reload()">Try again</button></p></div>`; }
function chips(items, current, href, { all = 'All', cls = '' } = {}) {
  return `<div class="chips ${cls}">${all ? `<a class="chip ${!current ? 'on' : ''}" href="${href('')}">${esc(all)}</a>` : ''}${items.map((c) => `<a class="chip ${current === c.name ? 'on' : ''}" href="${href(c.name)}">${esc(c.name)}${c.count != null ? ` <span class="cnt">${c.count}</span>` : ''}</a>`).join('')}</div>`;
}

/** Paged product grid with "Load more". */
function pagedGrid(el, fetchPage, empty, keep = () => true) {
  let page = 0;
  const load = async () => {
    const d = await fetchPage(page);
    const items = d.items.filter(keep);
    if (page === 0) el.innerHTML = items.length || d.more ? '<div class="grid" data-g></div>' : `<div class="empty">${empty}</div>`;
    const g = el.querySelector('[data-g]');
    if (g) g.insertAdjacentHTML('beforeend', items.map(tile).join(''));
    el.querySelector('[data-more]')?.remove();
    if (d.more) {
      el.insertAdjacentHTML('beforeend', '<p class="center" data-more><button class="btn light">Load more</button></p>');
      el.querySelector('[data-more] button').onclick = () => { page++; load().catch((e) => toast(e.message)); };
    }
    return d;
  };
  loading(4, el);
  return load().catch((e) => fail(e, el));
}

// ---------- views ----------
const views = {};

views.login = (q) => {
  // From a shared deal (/deal?…&r=<code>): remember who invited them, and open the deal after signing in.
  const ref = q?.get('ref') || sessionStorage.getItem('fw.ref') || '';
  try { if (q?.get('ref')) sessionStorage.setItem('fw.ref', q.get('ref')); if (q?.get('next')) sessionStorage.setItem('fw.next', `#/${q.get('next')}`); } catch {}
  document.body.classList.add('anon');
  app.innerHTML = `<form class="login stack" id="f">
    ${MARK}
    <h1>Fair Whack</h1>
    <p class="tagline">Same trolley. Less whack.</p>
    <p class="lead">Keep one shopping list across Woolworths, Coles, ALDI, Kmart, JB Hi-Fi, Petbarn and more, compare prices, and get told when the things you buy go on special. Internal beta.</p>
    <div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" placeholder="e.g. Sam Nguyen" required></div>
    <div class="field"><label for="code">Invite or design code</label><input id="code" name="code" autocomplete="off" autocapitalize="off" required></div>
    <div class="err" id="err"></div>
    <button class="btn block">Sign in</button>
    <p class="small muted">Use the same name on every device to keep your lists. Specials are collected twice a week and prices may differ in store.</p>
  </form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/login', { method: 'POST', body: { name: fd.get('name'), code: fd.get('code'), ref: ref || undefined } });
      state.me = null; // route() reloads the profile
      document.body.classList.remove('anon');
      let next = '#/';
      try { next = sessionStorage.getItem('fw.next') || '#/'; sessionStorage.removeItem('fw.next'); sessionStorage.removeItem('fw.ref'); } catch {}
      if (!/^#\/[\w/?=&%.-]*$/.test(next) || next.startsWith('#/login')) next = '#/';
      if (location.hash === next) route(); else fwGo(next);
    } catch (err) { $('#err').textContent = err.message; }
  };
};

// ----- profile (required during the beta) -----
const AGE_LABEL = { '18-24': '18–24', '25-34': '25–34', '35-44': '35–44', '45-54': '45–54', '55-64': '55–64', '65+': '65+' };
const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other' };
const HOUSE_LABEL = { 1: 'Just me', 2: '2', 3: '3', 4: '4', '5+': '5 or more' };

views.welcome = async () => {
  document.body.classList.add('onboarding');
  const opts = await api('/api/profile/options');
  const pr = state.profile || {};
  const radio = (name, values, labels, cur) => `<div class="pills">${values.map((v) => `<label class="pill"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''}><span>${labels[v] || v}</span></label>`).join('')}</div>`;
  app.innerHTML = `<form id="pf" class="stack profile">
    <h1>${pr.done ? 'Your details' : `Welcome${state.me ? `, ${esc(state.me.name.split(' ')[0])}` : ''}!`}</h1>
    <p class="lead">${pr.done ? 'Update anytime.' : 'Four quick questions so we can show you deals that suit your household. Required during the beta.'}</p>
    <fieldset><legend>Age</legend>${radio('ageRange', opts.ageRanges, AGE_LABEL, pr.ageRange)}</fieldset>
    <fieldset><legend>Gender</legend>${radio('gender', opts.genders, GENDER_LABEL, pr.gender)}</fieldset>
    <fieldset><legend>People in your household</legend>${radio('household', opts.household, HOUSE_LABEL, pr.household)}</fieldset>
    <fieldset><legend>What do you want to hear about first? <span class="muted small">Pick any</span></legend>
      <div class="pills">${opts.categories.filter((c) => c !== 'Other').map((c) => `<label class="pill"><input type="checkbox" name="fav" value="${esc(c)}" ${(pr.favCategories || []).includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div></fieldset>
    <div class="err" id="err"></div>
    <button class="btn block">${pr.done ? 'Save' : 'Start saving'}</button>
    <p class="small muted">Only used inside Fair Whack to sort deals for you and to understand who uses the beta. Never shared.</p>
  </form>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/profile', { method: 'POST', body: { ageRange: fd.get('ageRange'), gender: fd.get('gender'), household: fd.get('household'), favCategories: fd.getAll('fav') } });
      const r = await api('/api/me'); state.profile = r.profile; state.needsProfile = r.needsProfile; profMod?.invalidate();
      document.body.classList.remove('onboarding');
      toast('Saved');
      fwGo(pr.done ? '#/profile' : '#/');
    } catch (err) { $('#err').textContent = err.message; }
  };
};

// ----- Home: your list (list picker + stores) · Shared with you · Bargains (store tiles) · Top 20 -----
const HOME_PICK = 'fw.homePick';
// When two stores have the same product at the same price, Home shows this store first (big supermarkets, then
// the general stores most testers use, then the rest).
const SAME_PRICE_ORDER = ['woolworths', 'coles', 'aldi', 'costco', 'chemistwarehouse', 'kmart', 'bigw', 'target', 'jbhifi', 'thegoodguys',
  'officeworks', 'bunnings', 'harveynorman', 'petbarn', 'petstock', 'petcircle', 'peto', 'ebgames', 'decathlon'];
function homePick() { try { return JSON.parse(localStorage.getItem(HOME_PICK)) || {}; } catch { return {}; } }
function saveHomePick(v) { try { localStorage.setItem(HOME_PICK, JSON.stringify(v)); } catch {} }

/** "Lowest" pill on Home tiles that are the lowest price anywhere (same comparison as the product page). */
const lowestSeen = new Map();
async function markHomeLowest(el, pool) {
  const ids = [...new Set(pool.map((o) => o.id))];
  const need = ids.filter((id) => !lowestSeen.has(id));
  if (need.length) {
    try { const r = await api(`/api/lowest?ids=${need.map(encodeURIComponent).join(',')}`); need.forEach((id) => lowestSeen.set(id, !!r.lowest?.[id])); } catch { return; }
  }
  el.querySelectorAll('a.tile').forEach((a) => {
    const id = decodeURIComponent(a.getAttribute('href').replace('#/p/', ''));
    const price = a.querySelector('.price');
    if (!price || !lowestSeen.get(id) || price.querySelector('.lp')) return;
    price.classList.add('has-lp');
    price.insertBefore(Object.assign(document.createElement('span'), { className: 'lp', textContent: 'Lowest' }), price.querySelector('small'));
  });
}
function renderMine(el, d) {
  const lists = d.lists || [];
  const pick = homePick();
  const listId = lists.some((l) => l.id === pick.list) ? pick.list : lists[0]?.id;
  const inList = (d.byStore || []).filter((o) => o.listId === listId);
  const stores = STORES.filter((r) => inList.some((o) => o.retailer === r));
  const sel = (pick.stores || []).filter((r) => stores.includes(r)); // empty = All stores
  // Same product = matched across stores (canonical id), or the same name.
  const nameKey = (o) => String(o.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const rank = (r) => { const i = SAME_PRICE_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  let pool;
  if (sel.length) {
    // Single stores: every special on the list at those stores; a store listing the same thing twice shows once.
    const seen = new Set();
    pool = inList.filter((o) => sel.includes(o.retailer)).filter((o) => {
      const k = [o.id, `${o.retailer}|${o.canonical || o.id}`, `${o.retailer}|${nameKey(o)}|${o.effective}`];
      if (k.some((x) => seen.has(x))) return false; k.forEach((x) => seen.add(x)); return true;
    });
  } else {
    // All stores: one product = matched across stores (or the same name), on special at one or more stores.
    // Show only its lowest special; on a tie, the store whose price was checked most recently.
    const alias = new Map(); const groups = new Map();
    for (const o of inList) {
      const keys = [o.canonical && `c|${o.canonical}`, `n|${nameKey(o)}`].filter(Boolean);
      const k = keys.map((x) => alias.get(x)).find(Boolean) || keys[0];
      keys.forEach((x) => alias.set(x, k));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    const newer = (a, b) => String(b.checkedAt || '').localeCompare(String(a.checkedAt || '')) || rank(a.retailer) - rank(b.retailer);
    pool = [...groups.values()].map((g) => g.sort((a, b) => a.effective - b.effective || newer(a, b))[0])
      .sort((a, b) => (b.saving || 0) - (a.saving || 0));
  }
  if (sel.length) pool.sort((a, b) => (b.saving || 0) - (a.saving || 0));
  const picker = lists.length > 1
    ? `<label class="list-pick"><span class="sr-only">List</span><select id="homelist">${lists.map((l) => `<option value="${esc(l.id)}" ${l.id === listId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`
    : `<a class="list-pick one" href="#/lists">${esc(lists[0]?.name || 'My List')} ›</a>`;
  $('#minepick').innerHTML = picker;
  const toggles = stores.length > 1 ? `<div class="toggles" role="group" aria-label="Stores">
      <button type="button" class="toggle all" data-store="" aria-pressed="${!sel.length}"><span class="tick" aria-hidden="true">✓</span>All stores</button>
      ${stores.map((r) => `<button type="button" class="toggle ${r}" data-store="${r}" aria-pressed="${sel.includes(r)}"><span class="tick" aria-hidden="true">✓</span>${RET[r]}</button>`).join('')}
    </div>` : '';
  let body;
  if (!inList.length) body = `<div class="rail-empty"><b>Nothing from this list is on special right now</b>Tap ♡ on any product to watch it.<p style="margin:10px 0 0"><a class="btn small" href="#/browse">Browse products</a></p></div>`;
  else body = `<div class="rail" tabindex="0" aria-label="Your items on special, swipe for more">${pool.map(tile).join('')}<div class="rail-end"><a href="#/lists"><span aria-hidden="true">→</span>See My List</a></div></div>`;
  el.innerHTML = toggles + (inList.length ? `<p class="sec-sub" style="margin-top:0">${sel.length ? `${pool.length} on special` : `${pool.length} item${pool.length === 1 ? '' : 's'} on special · lowest price shown`}</p>` : '') + body;
  markHomeLowest(el, pool);
  el.querySelectorAll('[data-store]').forEach((b) => (b.onclick = () => {
    const r = b.dataset.store;
    let next = r ? (sel.includes(r) ? sel.filter((x) => x !== r) : [...sel, r]) : [];
    if (next.length === stores.length) next = [];
    saveHomePick({ ...homePick(), stores: next });
    renderMine(el, d);
  }));
  const ls = $('#homelist');
  if (ls) ls.onchange = () => { saveHomePick({ list: ls.value, stores: [] }); renderMine(el, d); };
}

function bargainTiles(el, stores) {
  if (!stores.length) { el.innerHTML = '<div class="rail-empty"><b>No specials yet</b>New specials arrive on Wednesdays and Saturdays.</div>'; return; }
  el.innerHTML = `<div class="store-grid" tabindex="0" aria-label="Stores with specials, swipe for more">${stores.map((s) => `
    <a class="store-tile" href="#/deals/${s.id}">
      ${s.newDeals ? '<span class="new-deals">New deals</span>' : ''}
      ${storeLogo(s.id, 'big')}
      <span class="st-name">${esc(s.name)}</span>
      ${s.upTo >= 5 ? `<b class="st-off">Up to ${s.upTo}% off</b>` : '<b class="st-off">&nbsp;</b>'}
      <span class="st-count">${s.specials.toLocaleString()} on special</span>
    </a>`).join('')}</div>`;
}

function topTwenty(el, d) {
  let g = '';
  const draw = () => {
    const items = g ? d.items.filter((p) => p.group === g).slice(0, 20) : d.items.filter((p) => p.top);
    el.innerHTML = `<div class="sec-head"><h2>${esc(d.title)}</h2></div>
      <p class="sec-sub">${d.forFamilies ? 'Added to lists this week by households like yours' : 'Most added to lists this week'}</p>
      ${d.groups.length ? `<div class="chips scroll" id="topcats"><a class="chip ${!g ? 'on' : ''}" data-g="" href="#">All categories</a>${d.groups.map((x) => `<a class="chip ${g === x ? 'on' : ''}" data-g="${esc(x)}" href="#">${esc(x)}</a>`).join('')}</div>` : ''}
      ${items.length ? `<div class="rail ranked" tabindex="0" aria-label="Top products, swipe for more">${items.map((p, i) => `<div class="rank-wrap"><span class="rank">${i + 1}</span>${tile(p)}</div>`).join('')}</div>`
        : '<div class="rail-empty"><b>Not enough lists yet</b>Products show up here once at least 2 people add them to a list.</div>'}`;
    el.querySelectorAll('[data-g]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); g = a.dataset.g; draw(); }));
  };
  draw();
}

views.home = async () => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const meta = state.meta || {};
  const updRows = (meta.retailers || []).filter((r) => STORES.includes(r.retailer));
  const newest = updRows.map((r) => r.updated).filter(Boolean).sort().pop();
  const upd = updRows.length > 3 ? `${ago(newest)} · ${updRows.length} stores` : updRows.map((r) => `${RET[r.retailer]} ${ago(r.updated)}`).join(' · ');
  app.innerHTML = `
    <section class="hsec hero"><h1>G'day ${esc(state.me.name.split(' ')[0])}</h1>
      <p class="lead small">${upd ? `Prices updated: ${upd}` : 'Waiting for the first price update.'}</p>
      ${!standalone && /iPhone|iPad/.test(navigator.userAgent) ? `<a class="notice info" style="display:block;text-decoration:none" href="#/install"><b>Add Fair Whack to your Home Screen</b> to get special alerts on iPhone →</a>` : ''}</section>
    <section class="hsec home-search">${searchBox('')}</section>
    <section class="hsec"><div class="sec-head"><h2>Deals on your list</h2><span id="minepick"></span></div>
      <div id="mine"><div class="skeleton" style="height:120px"></div></div></section>
    <section class="hsec"><div id="sharedrail"></div></section>
    <section class="hsec"><div class="sec-head" id="deals"><h2>Bargains you're missing</h2></div>
      <p class="sec-sub">Tap a store to see all its specials</p>
      <div id="bargains"><div class="skeleton" style="height:230px"></div></div></section>
    <section class="hsec"><div id="top20"></div></section>
    <section class="hsec"><div id="brandzone"></div></section>`;
  // Sections alternate background (clear / white); empty ones are skipped so the stripes stay even.
  const stripe = () => {
    let i = 0;
    app.querySelectorAll('.hsec:not(.hero):not(.home-search)').forEach((sec) => {
      const empty = !sec.textContent.trim() && !sec.querySelector('img, .skeleton');
      sec.hidden = empty;
      if (!empty) sec.classList.toggle('alt', i++ % 2 === 1);
    });
  };
  stripe();
  bindSearchBox();
  api('/api/digest').then((d) => { keptHome.digest = JSON.stringify(d); renderMine($('#mine'), d); }).catch((e) => fail(e, $('#mine')));
  soc().then((m) => m.homeRail($('#sharedrail'))).catch(() => {}).finally(stripe);
  api('/api/bargains/stores').then((d) => bargainTiles($('#bargains'), d.stores.filter((s) => STORES.includes(s.id)))).catch((e) => fail(e, $('#bargains')));
  api('/api/top20').then((d) => topTwenty($('#top20'), d)).catch(() => {}).finally(stripe);
  brd().then((m) => m.homeRail($('#brandzone'))).catch(() => {}).finally(stripe);
};

// ----- One store's specials (from a Bargains tile) -----
views.deals = async (q, store) => {
  if (!STORES.includes(store)) { fwGo('#/'); return; }
  const f = { cat: q.get('cat') || '', sort: q.get('sort') === 'popular' ? 'popular' : '' };
  const link = (patch) => `#/deals/${store}${qs({ ...f, ...patch })}`;
  app.innerHTML = `
    <a class="back" href="#/">‹ Home</a>
    <div class="store-head">${storeLogo(store, 'big')}<div><h1>${esc(RET[store])}</h1><p class="lead small" id="dcount">Specials this week</p></div></div>
    <div id="cats"></div>
    <div class="row" style="margin:2px 0 4px"><span class="spacer"></span>
      <div class="seg"><button data-sort="" class="${!f.sort ? 'on' : ''}">Biggest saving</button><button data-sort="popular" class="${f.sort === 'popular' ? 'on' : ''}">Most popular</button></div></div>
    <p class="small muted" id="dlabel" style="margin:0 0 10px;text-align:right"></p>
    <div id="res"></div>`;
  const remember = () => history.replaceState(history.state, '', link({}));
  const loadCats = () => api(`/api/categories${qs({ scope: 'deals', retailer: store })}`).then((c) => {
    const total = c.categories.reduce((n, x) => n + x.count, 0);
    $('#dcount').textContent = `${total.toLocaleString()} on special this week`;
    $('#cats').innerHTML = chips(c.categories, f.cat, (name) => link({ cat: name }), { all: 'All', cls: 'scroll' });
    $('#cats').querySelectorAll('a.chip').forEach((a) => (a.onclick = (e) => {
      e.preventDefault();
      f.cat = new URLSearchParams(a.getAttribute('href').split('?')[1] || '').get('cat') || '';
      $('#cats').querySelectorAll('a.chip').forEach((x) => x.classList.toggle('on', x === a));
      remember(); loadDeals();
    }));
  }).catch(() => {});
  const loadDeals = async () => {
    const res = $('#res');
    if (!res) return;
    res.style.minHeight = `${res.offsetHeight}px`;
    const box = document.createElement('div');
    res.replaceChildren(box);
    const d = await pagedGrid(box, (page) => api(`/api/deals${qs({ retailer: store, category: f.cat, sort: f.sort || 'saving', page })}`),
      '<b>No specials here right now</b>Try another category.');
    if (box.isConnected) {
      res.style.minHeight = '';
      $('#dlabel').textContent = f.sort === 'popular' && d && d.popularReady === false ? 'Not enough views yet · biggest saving first' : '';
    }
  };
  app.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => {
    if (f.sort === b.dataset.sort) return;
    f.sort = b.dataset.sort;
    app.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
    remember(); loadDeals();
  }));
  loadCats();
  await loadDeals();
};

// ----- Browse: stores in 8 groups, then a store's range -----
const STORE_GROUPS = [
  ['Groceries', ['woolworths', 'coles', 'aldi', 'costco'], '🛒', '#E8F6EC'],
  ['Department Stores', ['kmart', 'bigw', 'target'], '🏬', '#FDEBEC'],
  ['Electronics', ['jbhifi', 'thegoodguys', 'harveynorman'], '🎧', '#FFF6D6'],
  ['Tools & Home', ['bunnings'], '🔨', '#E6F2EA'],
  ['Health & Beauty', ['chemistwarehouse'], '💊', '#FCE8F3'],
  ['Pets', ['petbarn', 'petstock', 'petcircle', 'peto'], '🐾', '#FFEFE2'],
  ['Office', ['officeworks'], '📎', '#E6F0FB'],
  ['Sports & Gaming', ['decathlon', 'ebgames'], '⚽', '#EEE7FB'],
];
const BROWSE_SORTS = [['popular', 'Most popular'], ['new', null], ['special', 'On special'], ['mine', 'On my list']];

/** Browse groups: 8 cards; tapping one lifts it and opens it into a panel of its stores. */
function openGroup(card, [name, ids, icon, bg], count, gi, again) {
  const from = card.getBoundingClientRect();
  const back = document.createElement('div'); back.className = 'grp-back';
  const panel = document.createElement('div'); panel.className = 'grp-panel'; panel.style.setProperty('--bg', bg);
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', name);
  panel.innerHTML = `<div class="grp-top"><span class="grp-icon" aria-hidden="true">${icon}</span><div><h2>${esc(name)}</h2><span class="small muted">${ids.length} store${ids.length > 1 ? 's' : ''}</span></div>
      <button class="grp-x" aria-label="Close">✕</button></div>
    <div class="grp-stores">${ids.map((r) => `<a class="store-tile" href="#/browse/${r}">${storeLogo(r, 'big')}<span class="st-name">${esc(RET[r])}</span><span class="st-count">${count(r).toLocaleString('en-AU')} products</span></a>`).join('')}</div>`;
  document.body.append(back, panel);
  const to = panel.getBoundingClientRect();
  card.style.visibility = 'hidden';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fromT = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  const dur = reduce || again ? 0 : 340;
  // The open group is part of the address, so going back from a store lands here, not on the bare Browse page.
  history.replaceState(history.state, '', `#/browse?g=${gi}`);
  back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, fill: 'both' });
  // Lift first (a little bigger, deeper shadow), then grow into the panel.
  panel.animate([
    { transform: fromT, borderRadius: '18px', boxShadow: '0 1px 3px rgba(40,20,90,.1)' },
    { transform: `${fromT} translateY(-6px) scale(1.04)`, boxShadow: '0 18px 40px rgba(40,20,90,.28)', offset: 0.25 },
    { transform: 'none', borderRadius: '24px', boxShadow: '0 24px 60px rgba(40,20,90,.30)' },
  ], { duration: reduce || again ? 0 : 420, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
  if (!again) panel.querySelectorAll('.store-tile').forEach((t, i) => t.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: reduce ? 0 : 260, delay: reduce ? 0 : 220 + i * 50, fill: 'both' }));
  let closed = false;
  const close = (go) => {
    if (closed) return; closed = true;
    removeEventListener('hashchange', onHash);
    const now = card.getBoundingClientRect();
    const t = `translate(${now.left - to.left}px, ${now.top - to.top}px) scale(${now.width / to.width}, ${now.height / to.height})`;
    back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: go ? 0 : dur, fill: 'both' });
    const a = panel.animate([{ transform: 'none', opacity: 1 }, { transform: t, opacity: 0.4 }], { duration: go ? 0 : 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
    a.onfinish = () => { panel.remove(); back.remove(); card.style.visibility = ''; };
    if (!go) history.replaceState(history.state, '', '#/browse');
  };
  const onHash = () => close(true);
  addEventListener('hashchange', onHash);
  back.onclick = () => close();
  panel.querySelector('.grp-x').onclick = () => close();
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  panel.querySelector('.grp-x').focus({ preventScroll: true });
}

function browseGroups() {
  const grouped = new Set(STORE_GROUPS.flatMap(([, ids]) => ids));
  const extra = STORES.filter((r) => !grouped.has(r));
  return [...STORE_GROUPS, ...(extra.length ? [['More stores', extra, '🛍️', '#F1EEF8']] : [])]
    .map(([g, ids, icon, bg]) => [g, ids.filter((r) => STORES.includes(r)), icon, bg]).filter(([, ids]) => ids.length);
}

views.browse = async (q, store) => {
  if (!STORES.includes(store)) {
    const meta = state.meta || {};
    const count = (r) => (meta.retailers || []).find((x) => x.retailer === r)?.products || 0;
    const groups = browseGroups();
    app.innerHTML = `<h1>Browse</h1><p class="lead">Pick a kind of shop, then a store, to walk its aisles and see what's new.</p>
      <div class="grp-grid">${groups.map(([g, ids, icon, bg], i) => `<button type="button" class="grp-card" data-g="${i}" style="--bg:${bg}">
        <span class="grp-icon" aria-hidden="true">${icon}</span>
        <b>${esc(g)}</b>
        <span class="small muted">${ids.length} store${ids.length > 1 ? 's' : ''} · ${ids.reduce((n, r) => n + count(r), 0).toLocaleString('en-AU')} products</span>
        <span class="grp-logos">${ids.slice(0, 4).map((r) => storeLogo(r, 'sm')).join('')}</span>
      </button>`).join('')}</div>`;
    app.querySelectorAll('.grp-card').forEach((b) => (b.onclick = () => openGroup(b, groups[+b.dataset.g], count, +b.dataset.g)));
    // Coming back from a store (swipe back or "‹"): the group's panel is open again.
    const g = q.get('g');
    if (g != null && groups[+g]) openGroup(app.querySelector(`.grp-card[data-g="${+g}"]`), groups[+g], count, +g, true);
    return;
  }
  const newLabel = state.meta?.newLabel || 'New this week';
  const f = { cat1: q.get('cat1') || '', cat2: q.get('cat2') || '', sort: BROWSE_SORTS.some(([k]) => k === q.get('sort')) ? q.get('sort') : 'popular' };
  const link = (patch) => `#/browse/${store}${qs({ ...f, ...patch })}`;
  const total = (state.meta?.retailers || []).find((x) => x.retailer === store)?.products || 0;
  const gi = browseGroups().findIndex(([, ids]) => ids.includes(store));
  app.innerHTML = `<a class="back" href="#/browse${gi >= 0 ? `?g=${gi}` : ''}">‹ ${gi >= 0 ? esc(browseGroups()[gi][0]) : 'Browse'}</a>
    <div class="store-head with-search">${storeLogo(store, 'big')}<div class="sh-t"><h1>${esc(RET[store])} <span class="small muted">${total.toLocaleString('en-AU')} products</span></h1>
      <form class="store-search" id="ssf" role="search" autocomplete="off"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input type="search" name="q" value="${esc(q.get('q') || '')}" placeholder="Search ${esc(RET[store])}" enterkeyhint="search" aria-label="Search ${esc(RET[store])}"></form></div></div>
    <div id="browsebody">
    <div id="c1"><div class="chips"><span class="chip">Loading aisles…</span></div></div><div id="c2"></div>
    <div class="chips sorts">${BROWSE_SORTS.map(([k, l]) => `<a class="chip ${k === 'new' ? 'ticket' : ''} ${f.sort === k ? 'on' : ''}" href="${link({ sort: k })}" data-replace>${esc(l || newLabel)}</a>`).join('')}</div>
    <p class="small muted" id="blabel" style="margin:0 0 8px"></p>
    <div id="res"></div></div><div id="searchres" hidden></div>`;
  // Search this store: results replace the aisles until the box is cleared.
  const sf = $('#ssf'), sres = $('#searchres'), body = $('#browsebody');
  let seq = 0;
  const runSearch = async (v) => {
    v = v.trim();
    history.replaceState(history.state, '', `#/browse/${store}${qs({ ...f, q: v })}`);
    if (v.length < 2) { sres.hidden = true; body.hidden = false; return; }
    const my = ++seq;
    body.hidden = true; sres.hidden = false;
    loading(4, sres);
    try {
      const d = await api(`/api/browse/search${qs({ retailer: store, q: v })}`);
      if (my !== seq) return;
      sres.innerHTML = d.items.length
        ? `<p class="small muted" style="margin:4px 0 8px">${d.total > d.items.length ? `First ${d.items.length} of ${d.total}` : `${d.items.length} result${d.items.length > 1 ? 's' : ''}`} at ${esc(RET[store])}</p><div class="grid">${d.items.map(tile).join('')}</div>`
        : `<div class="empty"><b>Nothing at ${esc(RET[store])} for “${esc(v)}”</b><a href="#/search?q=${encodeURIComponent(v)}">Search every store →</a></div>`;
    } catch (e) { if (my === seq) fail(e, sres); }
  };
  let t;
  sf.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => runSearch(sf.q.value), 300); });
  sf.onsubmit = (e) => { e.preventDefault(); clearTimeout(t); sf.q.blur(); runSearch(sf.q.value); };
  if (q.get('q')) runSearch(q.get('q'));
  api(`/api/categories${qs({ retailer: store })}`).then((c) => {
    $('#c1').innerHTML = chips(c.categories, f.cat1, (name) => link({ cat1: name, cat2: '' }), { all: 'All aisles' });
    const top = c.categories.find((x) => x.name === f.cat1);
    if (top && top.children.length > 1) $('#c2').innerHTML = chips(top.children, f.cat2, (name) => link({ cat2: name }), { all: `All ${f.cat1}`, cls: 'sub' });
    // Aisles and sorts swap the page in place: swiping back leaves the store, not the last aisle.
    app.querySelectorAll('#c1 a, #c2 a').forEach((a) => a.setAttribute('data-replace', ''));
    app.querySelector('#c1 .chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }).catch(() => {});
  const empty = {
    new: `<b>Nothing new ${newLabel.includes('month') ? 'this month' : 'this week'} yet</b>New arrivals show up after each Wednesday update.`,
    special: '<b>Nothing on special here right now</b>Try another aisle.',
    mine: `<b>Nothing from your lists here</b>Tap ♡ on a ${esc(RET[store])} product to add it.`,
  }[f.sort] || '<b>No products here</b>Try another aisle.';
  if (f.sort === 'popular') $('#blabel').textContent = 'Most viewed and listed in the last 30 days';
  if (f.sort === 'special') $('#blabel').textContent = 'Biggest discount first';
  pagedGrid($('#res'), (page) => api(`/api/browse${qs({ retailer: store, cat1: f.cat1, cat2: f.cat2, sort: f.sort, page })}`), empty);
};

// ----- Search & Compare -----
const SEARCH_SORTS = [['relevance', 'Best match'], ['unit', 'Unit price'], ['saving', 'Biggest saving'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']];

const ICON_CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const ICON_LIB = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';
const ICON_BAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8V5a1 1 0 0 1 1-1h3M17 4h3a1 1 0 0 1 1 1v3M21 16v3a1 1 0 0 1-1 1h-3M7 20H4a1 1 0 0 1-1-1v-3M7 8v8M10 8v8M13.5 8v8M17 8v8"/></svg>';

function searchBox(term) {
  return `<form id="sf" class="searchbox" role="search" autocomplete="off">
    <div class="sb-field"><input type="search" name="q" value="${esc(term)}" placeholder="Search products or brands" enterkeyhint="search" aria-label="Search products or brands" aria-autocomplete="list" aria-controls="sugg">
    <ul id="sugg" class="suggest" role="listbox" hidden></ul></div>
    <button type="button" class="sb-tool" id="sb-photo" aria-label="Search with a photo">${ICON_CAM}</button>
    <button type="button" class="sb-tool" id="sb-scan" aria-label="Scan a barcode">${ICON_BAR}</button></form>`;
}
function bindSearchBox() {
  const form = $('#sf'), input = form.q, list = $('#sugg');
  $('#sb-photo').onclick = photoSearch;
  $('#sb-scan').onclick = () => openScanner().catch((e) => toast(e.message));
  const go = (v) => { v = v.trim(); if (!v) return; list.hidden = true; input.blur(); fwGo(`#/search?q=${encodeURIComponent(v)}`); };
  form.onsubmit = (e) => { e.preventDefault(); go(input.value); };
  let timer, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = input.value.trim();
    if (v.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      const { suggestions } = await api(`/api/suggest?q=${encodeURIComponent(v)}`).catch(() => ({ suggestions: [] }));
      if (my !== seq) return;
      list.innerHTML = suggestions.map((s) => `<li role="option" data-v="${esc(s.text)}">${s.kind === 'brand' ? '<span class="tag">Brand</span>' : '<span class="tag">⌕</span>'}<span>${esc(s.text)}</span></li>`).join('');
      list.hidden = !suggestions.length;
    }, 180);
  });
  list.addEventListener('pointerdown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); input.value = li.dataset.v; go(li.dataset.v); } });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
}

views.search = async (q) => {
  const term = q.get('q') || '';
  const sort = SEARCH_SORTS.some(([k]) => k === q.get('sort')) ? q.get('sort') : 'relevance';
  app.innerHTML = `<h1>Search &amp; Compare</h1>${searchBox(term)}<div id="via"></div><div id="body"></div>`;
  bindSearchBox();
  const body = $('#body');
  const via = state.via && state.via.query === term ? state.via : null;
  if (via) {
    $('#via').innerHTML = `<div class="via">${via.thumb ? `<img src="${via.thumb}" alt="">` : `<span class="sb-tool" style="width:40px;height:40px;border:0;background:#fff">${ICON_BAR}</span>`}
      <span>${via.kind === 'photo' ? 'From your photo' : `Barcode ${esc(via.code)}`}${via.label ? `: <b>${esc(via.label)}</b>` : ''}</span><span class="spacer"></span><button class="linkbtn" id="via-edit">Edit</button></div>`;
    $('#via-edit').onclick = () => { const i = $('#sf input'); i.focus(); i.select(); };
  }
  if (!term) {
    body.innerHTML = `<h2>People are searching</h2><div id="hot" class="chips wrap"><span class="chip">…</span></div><div id="hist"></div>`;
    api('/api/search/hot').then((h) => { $('#hot').innerHTML = h.keywords.map((t) => `<a class="chip" href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join(''); }).catch(() => {});
    const renderHistory = async () => {
      const { history } = await api('/api/search/history');
      $('#hist').innerHTML = history.length ? `<h2>Search History <button class="linkbtn" id="clr">Clear all</button></h2>
        <div class="card list-rows hist">${history.map((h) => `<div class="r"><a class="n" href="#/search?q=${encodeURIComponent(h)}"><span class="muted">↺</span> ${esc(h)}</a><button class="x" data-del="${esc(h)}" aria-label="Remove ${esc(h)}">✕</button></div>`).join('')}</div>` : '';
      $('#hist').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await api(`/api/search/history?q=${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); renderHistory(); }));
      const clr = $('#clr');
      if (clr) clr.onclick = async () => { await api('/api/search/history', { method: 'DELETE' }); renderHistory(); };
    };
    renderHistory().catch(() => {});
    if (!/iPhone|iPad/.test(navigator.userAgent)) $('#sf input').focus();
    return;
  }
  body.innerHTML = `<div class="chips sorts">${SEARCH_SORTS.map(([k, l]) => `<a class="chip ${sort === k ? 'on' : ''}" href="#/search?q=${encodeURIComponent(term)}&sort=${k}" data-replace>${l}</a>`).join('')}</div><div id="res"><div class="skeleton"></div></div>`;
  try {
    // Re-sorting the same search is not logged again.
    const d = await api(`/api/search?q=${encodeURIComponent(term)}&sort=${sort}${q.get('sort') ? '&log=0' : ''}`);
    $('#res').innerHTML = d.groups.length ? `<p class="small muted">${d.groups.length}${d.groups.length >= 80 ? '+' : ''} products</p>` + d.groups.map((g) => `<div class="group">
        <a class="group-head" href="#/p/${encodeURIComponent(g.best.id)}">${thumb(g.best)}<div class="t"><div class="name">${esc(g.name)}</div><div class="small muted">${esc(g.size || '')}${g.offers.length > 1 ? ` · ${g.offers.length} stores` : ''}</div></div>${heart(g.best)}</a>
        ${g.offers.map((o, i) => offerRow(o, i === 0 && g.offers.length > 1 && (g.offers[1].effective ?? 1e12) > (o.effective ?? 0))).join('')}
      </div>`).join('') : `<div class="empty"><b>No matches</b>Try a shorter word or a brand name.</div>`;
    $('#res').insertAdjacentHTML('beforeend', '<div id="web"></div>');
    webPrices(term, $('#web'));
  } catch (e) { fail(e, $('#res')); }
};

/** One Google Shopping card (Search page and product page). lp: room for a "Lowest" pill. */
function webCard(r, lp = false) {
  return `<a class="web-card${r.ignored ? ' ignored' : ''}" href="${esc(r.link || '#')}" target="_blank" rel="noopener noreferrer">
      ${lp ? `<button class="wc-ignore" type="button" data-store="${esc(r.store || '')}" aria-pressed="${r.ignored ? 'true' : 'false'}" aria-label="${r.ignored ? 'Bring back' : 'Ignore'} ${esc(r.store || 'this shop')}">${r.ignored ? 'Undo' : 'Ignore'}</button>` : ''}
      <span class="wc-img">${r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<b>?</b>'}</span>
      <span class="wc-store">${esc(r.store || 'Online shop')}${r.used ? ' · used' : ''}</span>
      <span class="wc-name">${esc(r.title)}</span>
      <span class="wc-price num"${lp && !r.ignored ? ` data-cents="${r.priceCents}"` : ''}>${money(r.priceCents)}${r.wasCents && r.wasCents > r.priceCents ? `<small>${money(r.wasCents)}</small>` : ''}${lp ? LP : ''}</span>
      ${r.match === 'close' ? '<span class="wc-note wc-close">Close match</span>' : r.sizeUnknown ? '<span class="wc-note">Size not shown</span>' : ''}
      ${r.delivery ? `<span class="wc-note">${esc(r.delivery)}</span>` : ''}
    </a>`;
}
// Google Shopping comparison (stage 6): other shops' prices for the same words, looked up at most once a day per keyword.
async function webPrices(term, el) {
  if (normQ(term).length < 2) return;
  el.innerHTML = '<div class="sec-head"><h2>Elsewhere online</h2></div><div class="skeleton" style="height:90px"></div>';
  let d;
  try { d = await api(`/api/search/web?q=${encodeURIComponent(term)}`); } catch { el.innerHTML = ''; return; }
  const rows = d.results || []; // Google's order (most relevant first): cheapest-first put spare parts and used items on top
  if (!rows.length) {
    const why = { budget: 'Paused for the rest of the month (beta budget).', month: 'This month’s lookups are used up; they reset on the 1st.', today: 'You’ve used today’s lookups. More tomorrow!' }[d.unavailable];
    el.innerHTML = why ? `<div class="sec-head"><h2>Elsewhere online</h2></div><p class="small muted">${why}</p>` : '';
    return;
  }
  el.innerHTML = `<div class="sec-head"><h2>Elsewhere online</h2><span class="small muted">Google Shopping</span></div>
    <div class="rail web-rail" tabindex="0" aria-label="Prices at other online shops, swipe for more">${rows.map((r) => webCard(r)).join('')}</div>
    <p class="small muted">Most relevant first. Checked ${ago(d.fetchedAt)}${d.stale ? ' (saved results)' : ''}. Shown as listed on Google Shopping, which may not include delivery. Opens the shop’s page.</p>`;
}
const normQ = (t) => String(t || '').trim();

// ----- search by photo -----
function pickFile(capture) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
    input.click();
  });
}
/** Shrink a photo to at most `max` px on its longest side, as a JPEG data URL. */
async function shrink(file, max = 768) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That photo could not be opened')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL('image/jpeg', 0.82), canvas: c };
  } finally { URL.revokeObjectURL(url); }
}
function photoSearch() {
  sheet(`<h3>Search with a photo</h3><p class="small muted" style="margin-top:-6px">Snap the front of the pack. We'll work out what it is and compare prices.</p>
    <div class="pick"><button id="ph-cam"><span class="ic">${ICON_CAM}</span><span>Take a photo<small>Opens your camera</small></span></button>
    <button id="ph-lib"><span class="ic">${ICON_LIB}</span><span>Choose from your photos<small>Pick a photo you already have</small></span></button></div>`, (s, close) => {
    const go = async (capture) => {
      const file = await pickFile(capture);
      if (!file) return;
      close();
      runPhoto(file);
    };
    $('#ph-cam', s).onclick = () => go(true);
    $('#ph-lib', s).onclick = () => go(false);
  });
}
async function runPhoto(file) {
  let close = () => {};
  try {
    const { dataUrl } = await shrink(file);
    close = sheet(`<div class="busy"><img src="${dataUrl}" alt=""><div class="spin"></div><b>Looking at your photo…</b><span class="small muted">This takes a few seconds.</span></div>`);
    const r = await api('/api/search/photo', { method: 'POST', body: { image: dataUrl } });
    if (r.found) {
      close();
      state.via = { kind: 'photo', query: r.query, label: r.label, thumb: (await shrink(file, 120)).dataUrl };
      fwGo(`#/search?q=${encodeURIComponent(r.query)}`);
      return;
    }
    close();
    notFoundSheet(r.label ? `We think it's <b>${esc(r.label)}</b>, but couldn't find it at our stores yet.` : "We couldn't recognise a product in that photo.", r.label, photoSearch, 'Try another photo');
  } catch (e) { close(); toast(e.message); }
}
function notFoundSheet(msg, guess, retry, retryLabel, tip = 'Tip: get the brand name and product name in the shot, in good light.') {
  sheet(`<h3>No match yet</h3><p>${msg}</p>${tip ? `<p class="small muted">${tip}</p>` : ''}
    <form id="nf" class="stack"><div class="field"><label for="nfq">Search by name instead</label><input id="nfq" name="q" value="${esc(guess || '')}" placeholder="e.g. Tim Tam"></div>
    <div class="row"><button type="button" class="btn light" id="nf-retry">${esc(retryLabel)}</button><button class="btn" style="flex:1">Search</button></div></form>`, (s, close) => {
    $('#nf-retry', s).onclick = () => { close(); retry(); };
    $('#nf', s).onsubmit = (e) => { e.preventDefault(); const v = $('#nfq', s).value.trim(); if (!v) return; close(); fwGo(`#/search?q=${encodeURIComponent(v)}`); };
  });
}

// ----- scan a barcode -----
async function openScanner() {
  const { decodeImage, validBarcode } = await import('/barcode.js?v=4');
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Scan a barcode');
  ov.innerHTML = `<video playsinline muted autoplay></video><div class="shade"><div class="frame"></div></div>
    <div class="top"><b>Scan a barcode</b><button class="x" aria-label="Close">✕</button></div>
    <div class="msg" hidden></div>
    <div class="bottom"><p class="hint">Line the barcode up inside the box</p>
      <form class="manual"><input inputmode="numeric" pattern="[0-9]*" placeholder="Or type the numbers" aria-label="Barcode number"><button class="btn ticket">Go</button></form>
      <button type="button" class="linkbtn" style="color:#E9E3FF;margin-top:12px" data-photo>Scan from a photo instead</button></div>`;
  document.body.appendChild(ov);
  const video = $('video', ov), msg = $('.msg', ov);
  let stream = null, timer = null, done = false, last = null;
  const stop = () => { done = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const close = () => { stop(); ov.remove(); };
  const say = (html) => { msg.hidden = false; msg.innerHTML = html; $('.shade', ov).hidden = true; };
  $('.x', ov).onclick = close;
  const found = async (code) => {
    if (done) return;
    stop();
    navigator.vibrate?.(60);
    say(`<div class="spin" style="margin:0 auto 10px"></div>Found <b>${esc(code)}</b>. Looking it up…`);
    try {
      const r = await api(`/api/search/barcode?code=${encodeURIComponent(code)}`);
      if (r.found && r.productId) { close(); fwGo(`#/p/${encodeURIComponent(r.productId)}`); return; }
      if (r.found && r.query) { close(); state.via = { kind: 'barcode', code, query: r.query, label: r.label }; fwGo(`#/search?q=${encodeURIComponent(r.query)}`); return; }
      close();
      notFoundSheet(`We don't have barcode <b>${esc(code)}</b> yet. Not every product's barcode is in our data during the beta.`, '', () => openScanner().catch((e) => toast(e.message)), 'Scan again', '');
    } catch (e) { close(); toast(e.message); }
  };
  $('.manual', ov).onsubmit = (e) => {
    e.preventDefault();
    const v = $('.manual input', ov).value.replace(/\D/g, '');
    if (!validBarcode(v)) { toast('Check the numbers: a barcode has 8, 12 or 13 digits'); return; }
    found(v);
  };
  $('[data-photo]', ov).onclick = async () => {
    const file = await pickFile(false);
    if (!file) return;
    const { canvas } = await shrink(file, 1600);
    const ctx = canvas.getContext('2d');
    const hit = decodeImage(ctx.getImageData(0, 0, canvas.width, canvas.height), { lines: 61, from: 0.05, to: 0.95 });
    if (hit) found(hit.code); else toast("Couldn't read a barcode in that photo. Try a closer, sharper shot.");
  };
  if (!navigator.mediaDevices?.getUserMedia) { say('This browser can\'t open the camera here. Type the numbers under the barcode, or scan from a photo.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (e) {
    say(e.name === 'NotAllowedError'
      ? '<b>Camera access is off for Fair Whack.</b><br>Allow the camera when asked, or turn it on in your phone\'s settings for this app. Meanwhile, type the numbers under the barcode below.'
      : 'The camera could not start. Type the numbers under the barcode below, or scan from a photo.');
    return;
  }
  if (done) { stop(); return; }
  video.srcObject = stream;
  await video.play().catch(() => {});
  try { stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch {}
  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      if (fmts.includes('ean_13')) detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => fmts.includes(f)) });
    } catch { detector = null; }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (done) return;
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      let code = null;
      if (vw && detector) {
        const r = await detector.detect(video);
        code = r[0]?.rawValue || null;
        if (code && code.length === 12) code = `0${code}`;
      } else if (vw) {
        // The middle band of the frame, matching the on-screen box, at up to 1280 px wide.
        const cw = Math.round(vw * 0.9), ch = Math.round(vh * 0.34);
        const k = Math.min(1, 1280 / cw);
        canvas.width = Math.round(cw * k); canvas.height = Math.round(ch * k);
        ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
        const hit = decodeImage(ctx.getImageData(0, 0, canvas.width, canvas.height), { lines: 17, from: 0.1, to: 0.9 });
        code = hit ? hit.code : null;
        if (hit && hit.votes >= 3) last = code; // seen on several lines at once: accept straight away
      }
      if (code && validBarcode(code)) {
        if (code === last || detector) return found(code);
        last = code;
      }
    } catch {}
    timer = setTimeout(tick, 120);
  };
  tick();
}

function sparkline(history) {
  if (history.length < 2) return '<p class="small muted">Price history builds up week by week.</p>';
  const byRet = {};
  for (const h of history) (byRet[h.product_id.split(':')[0]] ||= []).push(h);
  const all = history.map((h) => h.price_cents);
  const t0 = Date.parse(history[0].captured_at), t1 = Math.max(Date.parse(history[history.length - 1].captured_at), t0 + 1);
  const lo = Math.min(...all), hi = Math.max(...all), span = Math.max(hi - lo, 1);
  const W = 320, H = 80, P = 6;
  const x = (t) => P + ((Date.parse(t) - t0) / (t1 - t0)) * (W - 2 * P);
  const y = (c) => H - P - ((c - lo) / span) * (H - 2 * P);
  const col = (r) => (RET[r] ? `var(--${r})` : '#888');
  // Every second line dashed, so two stores stay apart even if their colours are close.
  const dashed = new Set(Object.keys(byRet).filter((_, i) => i % 2 === 1));
  const lines = Object.entries(byRet).map(([r, hs]) => `<polyline fill="none" stroke="${col(r)}"${dashed.has(r) ? ' stroke-dasharray="5 4"' : ''} stroke-width="2.5" stroke-linejoin="round" points="${hs.map((h) => `${x(h.captured_at).toFixed(1)},${y(h.price_cents).toFixed(1)}`).join(' ')}"/>`).join('');
  const legend = Object.keys(byRet).length > 1 ? `<div class="spark-legend">${Object.keys(byRet).map((r) => `<span><i class="${r} ${dashed.has(r) ? 'dash' : ''}"></i>${RET[r] || r}</span>`).join('')}</div>` : '';
  return `${legend}<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price over the last 12 weeks">${lines}</svg>
    <div class="row small muted"><span>${new Date(t0).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span><span class="spacer"></span><span>Low ${money(lo)} · High ${money(hi)}</span></div>`;
}

views.product = async (q, id) => {
  loading(1);
  try {
    const d = await api(`/api/product/${encodeURIComponent(id)}`);
    const p = d.product;
    state.products.set(p.id, p);
    const on = !!savedFor(p.id);
    app.innerHTML = `
      <div class="hero">${thumb(p)}<div><span class="ret ${p.retailer}">${RET[p.retailer]}</span><h1>${esc(p.name)}</h1><div class="small muted">${esc(p.size || '')}${p.brand ? ` · ${esc(p.brand)}` : ''}</div>${badges(p, { stale: false })}</div></div>
      <div class="facts">
        <div class="fact"><b class="num" data-cents="${p.effective ?? ''}" data-self>${money(p.effective)}${LP}</b><span>${p.was ? `was ${money(p.was)}` : 'Current price'}${p.multibuy ? ` · ${esc(p.promoText)}` : ''}</span></div>
        <div class="fact"><b class="num">${esc(unitText(p) || '—')}</b><span>Unit price</span></div>
        ${p.perUse ? `<div class="fact"><b class="num">${money(p.perUse)}</b><span>Per use (${p.uses} uses)</span></div>` : ''}
        ${p.low12 ? `<div class="fact"><b class="num">${money(p.low12)}</b><span>Lowest in ${p.historyWeeks || 12} weeks</span></div>` : ''}
      </div>
      <p class="small muted">Checked ${ago(p.checkedAt)}${p.stale ? ' — may have changed' : ''}. ${p.anomaly ? '<b>Unusual price change, being checked.</b>' : ''}</p>
      <div class="row" style="margin:12px 0;gap:8px"><button class="btn ${on ? 'ghost' : ''}" id="watch" data-pid="${esc(p.id)}" style="flex:1;white-space:nowrap">${on ? '♥ On your list' : '♡ Add to my list'}</button><button class="btn light icon-btn" id="share" aria-label="Share with friends"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l4.5 4.5-1.4 1.4L13 6.8V15h-2V6.8L8.9 8.9 7.5 7.5zM5 13h2v6h10v-6h2v8H5z"/></svg></button>${p.url ? `<a class="btn light" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="View at ${RET[p.retailer]}">${RET[p.retailer]} ↗</a>` : ''}</div>
      ${d.offers.length > 1 ? `<h2>Same product, other store</h2><div class="group">${d.offers.map((o) => offerRow(o, false, true)).join('')}</div>` : ''}
      <h2>Price history</h2><div class="card">${sparkline(d.history)}</div>
      <div id="pweb"></div>
      ${d.sizes.length ? `<h2>Other sizes</h2><div class="group">${d.sizes.map((o) => `<a class="offer" href="#/p/${encodeURIComponent(o.id)}"><div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span><span class="small">${esc(o.size || o.name)}</span></div><div class="p num">${money(o.effective)}</div><div></div><div class="u num">${esc(unitText(o))}</div></a>`).join('')}</div>` : ''}
      ${d.similar.length ? `<h2>Similar items, by unit price</h2><div class="grid">${d.similar.slice(0, 6).map(tile).join('')}</div>` : ''}`;
    $('#watch').onclick = () => onHeart(p.id).catch((e) => toast(e.message));
    $('#share').onclick = async () => (await soc()).shareSheet(p).catch((e) => toast(e.message));
    markLowest();
    productWeb(p, $('#pweb'));
  } catch (e) { fail(e); }
};
/** Show "Lowest" on the cheapest price on the product page (our stores and Google Shopping), when there are 2+ to compare. */
function markLowest() {
  const els = [...app.querySelectorAll('[data-cents]')].filter((e) => e.dataset.cents !== '');
  // Prices compared: each store row, plus the page's own price when it has no row of its own (only one of our stores).
  const ownRow = !!app.querySelector('.group [data-cents]');
  const n = els.filter((e) => !('self' in e.dataset)).length + (ownRow ? 0 : 1);
  const min = Math.min(...els.map((e) => +e.dataset.cents));
  els.forEach((e) => { const pill = e.querySelector('.lp'); if (pill) pill.hidden = !(n > 1 && +e.dataset.cents === min); });
}
/** The same product at other online shops (Google Shopping), cheapest first, then "Search by product photo". */
async function productWeb(p, el) {
  el.innerHTML = '<h2>Other shops online</h2><div class="skeleton" style="height:70px"></div>';
  let d;
  try { d = await api(`/api/product/${encodeURIComponent(p.id)}/web`); } catch { d = { results: [] }; }
  if (!el.isConnected) return;
  const rows = d.results || [];
  const why = { budget: 'Paused for the rest of the month (beta budget).', month: 'This month’s lookups are used up; they reset on the 1st.', today: 'You’ve used today’s lookups. More tomorrow!' }[d.unavailable];
  const lensBtn = d.canLens ? `<button class="btn light lens-btn" type="button" id="lens-go">${ICON_CAM}<span>Search by product photo</span></button>` : '';
  const lensBox = '<div id="plens"></div>';
  if (!rows.length) {
    el.innerHTML = `<h2>Other shops online</h2><p class="small muted">${why || 'No other online shops found for this product yet.'}</p>${lensBtn}${lensBox}`;
  } else {
    el.innerHTML = `<div class="sec-head"><h2>Other shops online</h2><span class="small muted">Google Shopping</span></div>
    <div class="rail web-rail" tabindex="0" aria-label="Prices at other online shops, cheapest first, swipe for more">${rows.map((r) => webCard(r, true)).join('')}</div>
    <p class="small muted">Cheapest first. Checked ${ago(d.fetchedAt)}${d.stale ? ' (saved results)' : ''}. As listed on Google Shopping, which may not include delivery. Opens the shop’s page. Tap Ignore on a shop you don’t trust or a wrong match: it turns grey and isn’t counted for Lowest. “Size not shown”: the listing doesn’t say the pack size, check it before you buy. “Close match”: added when fewer than 5 shops have the exact product; it may be a different version, so check it, or tap Ignore.</p>${lensBtn}${lensBox}`;
    const wire = () => el.querySelectorAll('.wc-ignore').forEach((b) => b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const on = b.getAttribute('aria-pressed') !== 'true';
      try {
        await api(`/api/product/${encodeURIComponent(p.id)}/web/ignore`, { method: 'PUT', body: { store: b.dataset.store, on } });
        const r = rows.find((x) => (x.store || '') === b.dataset.store);
        if (r) r.ignored = on;
        lowestSeen.clear();
        b.closest('.web-card').outerHTML = webCard(r, true);
        wire(); markLowest();
      } catch (err) { toast(err.message); }
    });
    wire();
    markLowest();
  }
  // Someone already searched this product by photo today: show those results straight away (costs nothing).
  if (d.lens) lensShow(d.lens, $('#plens', el));
  const go = $('#lens-go', el);
  if (go) go.onclick = async () => {
    const box = $('#plens', el);
    go.disabled = true;
    box.innerHTML = '<div class="sec-head"><h2>Found by photo</h2></div><div class="skeleton" style="height:90px"></div>';
    try { lensShow(await api(`/api/product/${encodeURIComponent(p.id)}/lens`, { method: 'POST' }), box); } catch (err) { box.innerHTML = ''; toast(err.message); }
    go.disabled = false;
  };
}
/** "Search by product photo" results (Google Lens): every shop found, most similar first, not checked by us. */
function lensShow(d, box) {
  if (!box) return;
  const rows = d.results || [];
  const why = { budget: 'Paused for the rest of the month (beta budget).', month: 'This month’s lookups are used up; they reset on the 1st.', today: 'You’ve used today’s photo searches. More tomorrow!', error: 'The photo search didn’t work this time. Try again later.', 'not set up': 'Photo search isn’t switched on yet.' }[d.unavailable];
  if (!rows.length) {
    box.innerHTML = `<div class="sec-head"><h2>Found by photo</h2></div><p class="small muted">${why || 'No other online shops found for this product yet.'}</p>`;
    return;
  }
  box.innerHTML = `<div class="sec-head"><h2>Found by photo</h2><span class="small muted">${rows.length} result${rows.length === 1 ? '' : 's'} · Google Lens</span></div>
    <div class="rail web-rail" tabindex="0" aria-label="Shops found by photo, most similar first, swipe for more">${rows.map((r) => webCard(r)).join('')}</div>
    <p class="small muted">Shops whose product photo looks like this one, most similar first; used items left out. Checked ${ago(d.fetchedAt)}${d.stale ? ' (saved results)' : ''}. Not checked by us: it may be a different model, size or an accessory, so check before you buy. Not counted for Lowest. Opens the shop’s page.</p>`;
}

// ----- sheets -----
function sheet(html, onMount, onClose) {
  const s = $('#sheet');
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
  const close = () => { s.hidden = true; s.innerHTML = ''; onClose?.(); };
  s.onclick = (e) => { if (e.target === s) close(); };
  onMount?.(s, close);
  return close;
}

function alertOptions(cur = 'any', target = null, price = null) {
  const on = cur !== 'off';
  const sub = [['any', 'Any special'], ['half', 'Half price only'], ['target', 'Below my price']];
  return `<div class="alert-kinds">
    <label class="opt ${on ? 'on' : ''}" data-kind="alert"><input type="radio" name="kind" value="alert" ${on ? 'checked' : ''}><span class="hk alert">${HEART}${BELL}</span>
      <div><b>Alerts</b><span>A notification of its own when it goes on special</span>
      <div class="subopts">${sub.map(([k, t]) => `<label class="sub ${(on ? cur : 'any') === k ? 'on' : ''}"><input type="radio" name="mode" value="${k}" ${(on ? cur : 'any') === k ? 'checked' : ''}>${t}</label>`).join('')}</div>
      <div class="field target-field" ${(on ? cur : '') === 'target' ? '' : 'hidden'}><input name="target" inputmode="decimal" placeholder="${price ? (price / 100 * 0.7).toFixed(2) : '5.00'}" value="${target ? (target / 100).toFixed(2) : ''}" aria-label="Target price in dollars"></div></div></label>
    <label class="opt ${on ? '' : 'on'}" data-kind="off"><input type="radio" name="kind" value="off" ${on ? '' : 'checked'}><span class="hk quiet">${HEART}</span>
      <div><b>No alerts</b><span>Just keep it on my list. It still counts in the Wednesday and Saturday summary.</span></div></label></div>`;
}
function bindOpts(s) {
  s.querySelectorAll('[data-kind]').forEach((o) => o.addEventListener('click', () => {
    s.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === o));
    o.querySelector('input[name=kind]').checked = true;
  }));
  s.querySelectorAll('.subopts label').forEach((l) => l.addEventListener('click', (e) => {
    e.stopPropagation();
    l.querySelector('input').checked = true;
    s.querySelectorAll('.subopts label').forEach((x) => x.classList.toggle('on', x === l));
    const alert = s.querySelector('[data-kind=alert]');
    s.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === alert));
    alert.querySelector('input[name=kind]').checked = true;
    s.querySelector('.target-field').hidden = l.querySelector('input').value !== 'target';
  }));
  s.querySelector('.target-field input')?.addEventListener('click', (e) => e.stopPropagation());
}
function readOpts(s) {
  if (s.querySelector('input[name=kind]:checked')?.value === 'off') return { alert_mode: 'off', target_cents: null };
  const mode = s.querySelector('input[name=mode]:checked')?.value || 'any';
  const t = parseFloat(String(s.querySelector('input[name=target]')?.value || '').replace(/[^0-9.]/g, ''));
  if (mode === 'target' && !(t > 0)) throw new Error('Enter a target price');
  return { alert_mode: mode, target_cents: mode === 'target' ? Math.round(t * 100) : null };
}

function addToListSheet(p, lists, done) {
  sheet(`<h3>Add “${esc(p.name)}”</h3>
    ${lists.length > 1 ? `<p class="small muted" style="margin:-4px 0 6px">To which list?</p><div class="chips wrap list-pick">${lists.map((l, i) => `<label class="chip ${i === 0 ? 'on' : ''}"><input type="radio" name="list" value="${l.id}" ${i === 0 ? 'checked' : ''} hidden>${esc(l.name)}</label>`).join('')}</div>`
      : `<input type="hidden" name="list" value="${lists[0].id}">`}
    ${alertOptions('any', null, p.price)}
    <div class="err" id="e"></div><button class="btn block" id="ok">Add to ${lists.length > 1 ? 'list' : esc(lists[0].name)}</button>`, (s, close) => {
    bindOpts(s);
    s.querySelectorAll('.list-pick label').forEach((o) => o.addEventListener('click', () => { s.querySelectorAll('.list-pick label').forEach((x) => x.classList.toggle('on', x === o)); }));
    $('#ok', s).onclick = async () => {
      try {
        const listId = (s.querySelector('input[name=list]:checked') || s.querySelector('input[name=list]')).value;
        await api(`/api/lists/${listId}/items`, { method: 'POST', body: { product_id: p.id, ...readOpts(s) } });
        close(); toast(`Added to ${lists.find((l) => l.id === listId).name}`); await done?.(); maybeAskPush();
      } catch (e) { $('#e', s).textContent = e.message; }
    };
  });
}

/** Alert settings for an item already on a list, with a confirmed "Remove". */
function editItemSheet(item, p, done) {
  const mode = item.alert_mode || item.alertMode;
  const target = item.target_cents ?? item.target;
  sheet(`<h3>${esc(p.name)}</h3><p class="small muted" style="margin-top:-6px">On ${esc(item.list_name || 'your list')}.</p>
    ${alertOptions(mode, target, p.price)}
    <div class="err" id="e"></div>
    <div id="acts" class="row"><button class="btn danger" id="rm">Remove from list</button><button class="btn" id="ok" style="flex:1">Save</button></div>`, (s, close) => {
    bindOpts(s);
    $('#ok', s).onclick = async () => {
      try { await api(`/api/items/${item.id}`, { method: 'PATCH', body: readOpts(s) }); close(); toast('Alert updated'); await done?.(); } catch (e) { $('#e', s).textContent = e.message; }
    };
    $('#rm', s).onclick = () => {
      $('#acts', s).innerHTML = `<div class="confirm"><b>Remove this item from ${esc(item.list_name || 'your list')}?</b><span class="small muted">You'll stop getting alerts for it.</span>
        <div class="row"><button class="btn light" id="no" style="flex:1">Keep it</button><button class="btn danger-solid" id="yes" style="flex:1">Remove</button></div></div>`;
      $('#no', s).onclick = () => { close(); editItemSheet(item, p, done); };
      $('#yes', s).onclick = async () => { await api(`/api/items/${item.id}`, { method: 'DELETE' }); close(); toast('Removed from your list'); await done?.(); };
    };
  });
}

// ----- My List -----
const MODE_LABEL = { any: 'Alerts', half: 'Alerts: ½ price', target: 'Alerts: below target', off: 'No alerts' };
const LIST_STORES = 'fw.listStores';
const listStores = () => { try { return JSON.parse(localStorage.getItem(LIST_STORES) || '{}'); } catch { return {}; } };
function setListStores(id, arr) { const m = listStores(); if (arr.length) m[id] = arr; else delete m[id]; try { localStorage.setItem(LIST_STORES, JSON.stringify(m)); } catch {} }

/** Store filter for a list: a small button next to Edit ("All stores" or the stores picked). */
function storeLabel(sel) { return !sel.length ? 'All stores' : sel.length === 1 ? RET[sel[0]] : `${sel.length} stores`; }
function storeSheet(l, stores, onDone) {
  let sel = (listStores()[l.id] || []).filter((r) => stores.includes(r));
  sheet(`<h3>Stores for “${esc(l.name)}”</h3><p class="small muted" style="margin-top:-4px">Show prices from all stores, or only the ones you pick.</p>
    <div class="card list-rows store-pick" id="sp"></div><button class="btn block" id="ok">Done</button>`, (sh, close) => {
    const box = $('#sp', sh);
    const draw = () => {
      box.innerHTML = [['', 'All stores'], ...stores.map((r) => [r, RET[r]])].map(([r, name]) => {
        const on = r ? sel.includes(r) : !sel.length;
        return `<button type="button" class="r sp-row" data-r="${r}" aria-pressed="${on}">${r ? `<span class="dot ret ${r}"></span>` : '<span class="dot all"></span>'}<span class="n"><b>${esc(name)}</b></span><span class="sp-tick" aria-hidden="true">${on ? '✓' : ''}</span></button>`;
      }).join('');
    };
    draw();
    box.onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const r = b.dataset.r;
      sel = !r ? [] : sel.includes(r) ? sel.filter((x) => x !== r) : [...sel, r];
      if (sel.length === stores.length) sel = [];
      draw();
    };
    $('#ok', sh).onclick = () => { setListStores(l.id, sel); close(); onDone(); };
  });
}

function itemRow(i, sel) {
  state.products.set(i.product.id, i.product);
  const offers = sel.length ? i.offers.filter((o) => sel.includes(o.retailer)) : i.offers;
  const best = offers[0];
  if (!best) return '';
  return `<div class="r item">
    <a href="#/p/${encodeURIComponent(best.id)}" class="li-thumb" tabindex="-1" aria-hidden="true">${thumb(i.product.image ? i.product : best)}</a>
    <a href="#/p/${encodeURIComponent(best.id)}" class="n" style="text-decoration:none"><div>${esc(i.product.name)}</div>
      <div class="small"><span class="ret ${best.retailer}">${RET[best.retailer]}</span> ${best.special ? (best.promoType === 'half_price' ? '<span class="badge b-half">½ PRICE</span>' : '<span class="badge b-promo">Special</span>') : ''} <span class="muted">· ${MODE_LABEL[i.alertMode]}${i.alertMode === 'target' && i.target ? ` ${money(i.target)}` : ''}</span></div>
      ${new Set(i.offers.map((o) => o.retailer)).size > 1 ? `<span class="same-tag" data-same="${esc(i.id)}">Same product in ${new Set(i.offers.map((o) => o.retailer)).size - 1} other store${new Set(i.offers.map((o) => o.retailer)).size > 2 ? 's' : ''} ›</span>` : ''}</a>
    <div style="text-align:right"><div class="num" style="font-weight:800">${money(best.effective)}</div>${best.was ? `<div class="small muted num" style="text-decoration:line-through">${money(best.was)}</div>` : ''}</div>
    ${heart(i.product)}
  </div>`;
}

const listStoresOf = (l) => STORES.filter((r) => l.items.some((i) => i.offers.some((o) => o.retailer === r)));
function listBody(l) {
  const stores = listStoresOf(l);
  const sel = (listStores()[l.id] || []).filter((r) => stores.includes(r));
  const rows = l.items.map((i) => itemRow(i, sel)).filter(Boolean);
  return l.items.length
    ? (rows.length ? `<div class="list-rows">${rows.join('')}</div>` : `<div class="empty" style="padding:14px">Nothing on this list at ${sel.map((r) => RET[r]).join(' or ')}.</div>`)
    : '<div class="empty" style="padding:14px">Empty. Tap ♡ on any product to add it here.</div>';
}

views.lists = async () => {
  loading(2);
  try {
    const { lists } = await api('/api/lists');
    app.innerHTML = `<div class="title-row"><h1>My List</h1><span class="spacer"></span>
        ${lists.length > 1 ? '<button class="round-btn" id="reorder" aria-label="Change the order of lists"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' : ''}
        <button class="round-btn primary" id="newlist" aria-label="New list"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg></button></div>
      <p class="lead small">Prices are the cheapest matching offer at the stores you pick. ${HEART_KEY}</p>
      ${lists.map((l, idx) => {
        const open = state.listOpen[l.id] ?? idx === 0;
        const onSpecial = l.items.filter((i) => i.best.special).length;
        return `<details class="card listcard" data-list="${l.id}" ${open ? 'open' : ''}>
        <summary><span class="chev">›</span><div class="t"><b>${esc(l.name)}</b><span class="small muted">${l.items.length} item${l.items.length === 1 ? '' : 's'}${onSpecial ? ` · <span class="hot">${onSpecial} on special</span>` : ''}</span></div>${listStoresOf(l).length > 1 ? `<button class="btn small light store-btn" data-stores="${l.id}"><span>${esc(storeLabel((listStores()[l.id] || []).filter((r) => listStoresOf(l).includes(r))))}</span><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg></button>` : ''}<button class="btn small light" data-edit="${l.id}">Edit</button></summary>
        <div class="list-body">${listBody(l)}</div>
      </details>`; }).join('')}
      <div id="pushbox" style="margin-top:14px"></div>`;
    app.querySelectorAll('details[data-list]').forEach((d) => d.addEventListener('toggle', () => { state.listOpen[d.dataset.list] = d.open; }));
    app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); listSheet(lists.find((l) => l.id === b.dataset.edit), lists.length); }));
    // Store filter: opens a picker; "All stores" or any mix of single stores.
    app.querySelectorAll('[data-stores]').forEach((b) => (b.onclick = (e) => {
      e.preventDefault();
      const l = lists.find((x) => x.id === b.dataset.stores);
      const stores = listStoresOf(l);
      storeSheet(l, stores, () => {
        const card = b.closest('details');
        card.querySelector('.list-body').innerHTML = listBody(l);
        b.querySelector('span').textContent = storeLabel((listStores()[l.id] || []).filter((r) => stores.includes(r)));
        card.open = true;
      });
    }));
    $('#newlist').onclick = () => listSheet(null, lists.length);
    if ($('#reorder')) $('#reorder').onclick = () => reorderSheet(lists);
    renderPushBox($('#pushbox'));
  } catch (e) { fail(e); }
};
const HEART_KEY = '<span class="hkey"><span class="hk alert sm">' + HEART + BELL + '</span> alerts on · <span class="hk quiet sm">' + HEART + '</span> no alerts</span>';

function listSheet(l, count) {
  sheet(`<h3>${l ? 'Edit list' : 'New list'}</h3>
    <div class="field"><label>Name</label><input name="n" value="${esc(l?.name || '')}" placeholder="e.g. Weekly shop"></div><p></p>
    <div class="row">${l && count > 1 ? '<button class="btn danger" id="del">Remove list</button>' : ''}<button class="btn" id="ok" style="flex:1">Save</button></div>`, (s, close) => {
    $('#ok', s).onclick = async () => {
      const body = { name: $('[name=n]', s).value };
      if (l) await api(`/api/lists/${l.id}`, { method: 'PATCH', body }); else await api('/api/lists', { method: 'POST', body });
      close(); views.lists();
    };
    const del = $('#del', s);
    if (del) del.onclick = async () => { if (confirm('Remove this list and everything on it?')) { await api(`/api/lists/${l.id}`, { method: 'DELETE' }); close(); await loadSaved(); views.lists(); } };
  });
}

/** Change the order of lists: drag by ≡. */
function reorderSheet(lists) {
  let order = lists.map((l) => ({ id: l.id, name: l.name }));
  sheet(`<h3>Order of lists</h3><p class="small muted" style="margin-top:-4px">Hold ≡ and drag to move a list.</p><div class="card list-rows reorder" id="ro"></div><button class="btn block" id="ok">Done</button>`, (s, close) => {
    const box = $('#ro', s);
    const draw = () => {
      box.innerHTML = order.map((l, i) => `<div class="r ro-row" data-i="${i}"><span class="grip" aria-hidden="true">≡</span><span class="n"><b>${esc(l.name)}</b></span></div>`).join('');
    };
    const move = (from, to) => { if (to < 0 || to >= order.length || from === to) return; const [x] = order.splice(from, 1); order.splice(to, 0, x); draw(); };
    draw();
    // Drag by the grip (touch and mouse).
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.ro-row');
      if (!row) return;
      const g = row;
      e.preventDefault();
      drag = { from: +row.dataset.i, row, y0: e.clientY, h: row.offsetHeight };
      row.classList.add('dragging');
      g.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y0;
      drag.row.style.transform = `translateY(${dy}px)`;
      drag.to = Math.max(0, Math.min(order.length - 1, drag.from + Math.round(dy / drag.h)));
    });
    const end = () => { if (!drag) return; const { from, to = from } = drag; drag = null; move(from, to); if (from === to) draw(); };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    $('#ok', s).onclick = async () => {
      try { await api('/api/lists/order', { method: 'PUT', body: { ids: order.map((l) => l.id) } }); close(); views.lists(); } catch (err) { toast(err.message); }
    };
  });
}
/** Same product at every store, for one list item: compare, add another store's, or say it isn't the same. */
views.same = async (q, itemId) => {
  loading(1);
  const d = await api(`/api/items/${encodeURIComponent(itemId)}/same`);
  const p = d.product;
  state.products.set(p.id, p);
  const cheapest = d.offers[0];
  const others = d.offers.filter((o) => o.id !== p.id);
  const row = (o, hidden) => `<div class="offer same-row ${!hidden && o.id === cheapest.id && d.offers.length > 1 ? 'best' : ''} ${hidden ? 'hidden-row' : ''}">
      <a class="same-main" href="#/p/${encodeURIComponent(o.id)}">${thumb(o)}<span class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span>${hidden ? '' : badges(o)}${!hidden && o.id === cheapest.id && d.offers.length > 1 ? '<span class="tag-best">Cheapest</span>' : ''}
        <span class="small">${esc(o.name)}${o.size && !o.name.toLowerCase().includes(String(o.size).toLowerCase()) ? ` · ${esc(o.size)}` : ''}</span>${o.id === p.id ? '<span class="small muted">On your list</span>' : ''}</span></a>
      <span class="p num">${money(o.effective)}${o.was ? `<small class="muted">was ${money(o.was)}</small>` : ''}<small class="muted">${esc(unitText(o))}</small></span>
      <span class="acts">${hidden ? `<button class="btn small light" data-putback="${esc(o.id)}">Put back</button>` : heart(o)}</span>
    </div>`;
  app.innerHTML = `<a class="back" href="#/lists">‹ My List</a>
    <div class="hero">${thumb(p)}<div><h1>${esc(p.name)}</h1><div class="small muted">${esc(p.size || '')}${p.brand ? ` · ${esc(p.brand)}` : ''} · on ${esc(d.item.listName)}</div></div></div>
    <p class="small muted">Same product at ${d.offers.length} store${d.offers.length === 1 ? '' : 's'}, cheapest first. Tap ♡ to add a store's one to a list.</p>
    <div class="group same-list">${d.offers.map((o) => row(o, false)).join('')}</div>
    ${d.offers.length === 1 ? '<div class="empty">No other store has this product right now.</div>' : ''}
    ${others.length ? `<button class="btn light block report-btn" id="report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h9l1 2h5v10h-7l-1-2H7v7z"/></svg>Wrong match? Report a product</button>` : ''}
    ${d.hidden.length ? `<h3 class="hidden-h">Hidden from this comparison</h3><p class="small muted" style="margin-top:-6px">You said these aren't the same product. Put one back if that was a mistake.</p>
      <div class="group same-list">${d.hidden.map((o) => row(o, true)).join('')}</div>` : ''}`;
  const putBack = async (id, quiet) => {
    await api(`/api/items/${encodeURIComponent(itemId)}/not-same/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!quiet) toast('Put back in the comparison');
    views.same(q, itemId);
  };
  app.querySelectorAll('[data-putback]').forEach((b) => (b.onclick = () => putBack(b.dataset.putback).catch((e) => toast(e.message))));
  const rep = $('#report');
  if (rep) rep.onclick = () => sheet(`<h3>Which one isn't the same?</h3>
      <p class="small muted" style="margin-top:-4px">It will be hidden from this comparison for you, and we'll check the match. You can put it back any time.</p>
      <div class="card list-rows store-pick" id="rp">${others.map((o) => `<label class="r sp-row"><input type="radio" name="o" value="${esc(o.id)}"><span class="dot ret ${o.retailer}"></span><span class="n"><b>${RET[o.retailer]}</b><span class="small muted" style="display:block">${esc(o.name)}</span></span></label>`).join('')}</div>
      <div class="row" style="gap:8px"><button class="btn light" id="cancel" style="flex:1">Cancel</button><button class="btn danger" id="ok" style="flex:1" disabled>Not the same</button></div>`, (sh, close) => {
    const ok = $('#ok', sh);
    if (others.length === 1) { $('input', sh).checked = true; ok.disabled = false; }
    sh.addEventListener('change', () => { ok.disabled = !$('input:checked', sh); });
    $('#cancel', sh).onclick = close;
    ok.onclick = async () => {
      const id = $('input:checked', sh)?.value;
      if (!id) return;
      ok.disabled = true;
      try {
        await api(`/api/items/${encodeURIComponent(itemId)}/not-same`, { method: 'POST', body: { product_id: id } });
        close();
        await views.same(q, itemId);
        toast('Hidden from this comparison', { label: 'Undo', run: () => putBack(id, true).then(() => toast('Put back')).catch((e) => toast(e.message)) });
      } catch (e) { ok.disabled = false; toast(e.message); }
    };
  });
};

// ---------- push ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enablePush() {
  const key = state.vapid;
  if (!key) throw new Error('Alerts are not configured on the server yet');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can turn them on in Settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) }));
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}
async function disablePush() {
  const sub = await currentSub();
  if (sub) { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
}
async function renderPushBox(el) {
  if (!el) return;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!pushSupported()) {
    el.innerHTML = ios && !standalone
      ? `<div class="notice">To get alerts on iPhone, first <a href="#/install">add Fair Whack to your Home Screen</a>, then open it from there.</div>`
      : `<div class="notice">This browser can't receive alerts. You'll still see specials on the Home screen.</div>`;
    return;
  }
  const sub = await currentSub().catch(() => null);
  el.innerHTML = sub
    ? `<div class="notice info row"><span>🔔 Special alerts are on for this device. Around 8am on Wednesdays and Saturdays: a summary of your list, plus a note for each 💜🔔 item on special (at most 5 a day).</span><span class="spacer"></span><button class="btn small light" id="poff">Turn off</button></div>`
    : `<div class="card row"><span>🔔 Get a heads-up when your items go on special.</span><span class="spacer"></span><button class="btn small ticket" id="pon">Turn on</button></div>`;
  const on = $('#pon', el), off = $('#poff', el);
  if (on) on.onclick = async () => { try { await enablePush(); toast('Alerts on'); renderPushBox(el); } catch (e) { toast(e.message); } };
  if (off) off.onclick = async () => { await disablePush(); toast('Alerts off'); renderPushBox(el); };
}
async function maybeAskPush() {
  if (!pushSupported() || localStorage.getItem('fw_push_asked')) return;
  const sub = await currentSub().catch(() => null);
  if (sub) return;
  try { localStorage.setItem('fw_push_asked', '1'); } catch {}
  sheet(`<h3>Want a heads-up?</h3><p>On Wednesday and Saturday mornings we'll tell you how many items on your list are on special, and send a note of its own for each 💜🔔 item (the ones with a bell) (at most 5 a day).</p>
    <div class="row"><button class="btn light" id="no">Not now</button><button class="btn ticket" id="yes" style="flex:1">Turn on alerts</button></div>`, (s, close) => {
    $('#no', s).onclick = close;
    $('#yes', s).onclick = async () => { close(); try { await enablePush(); toast('Alerts on'); } catch (e) { toast(e.message); } };
  });
}


// ----- More, profile, Save More modules (FW2.0): public/profile.js, loaded on demand -----
const logout = async () => { await api('/api/logout', { method: 'POST' }); state.me = null; state.saved = new Map(); state.savedTwins = new Map(); saveBack([]); location.replace('#/login'); };
let profMod;
async function prof() {
  if (!profMod) { profMod = await import('/profile.js?v=14'); profMod.init({ api, esc, toast, app, state, logout, setHomeStores: (stores) => saveHomePick({ ...homePick(), stores: stores.filter((r) => STORES.includes(r)) }) }); }
  return profMod;
}
views.more = async () => (await prof()).more();
// Friends and sharing (Me button, top right on every page).
let socMod;
async function soc() {
  if (!socMod) { socMod = await import('/social.js?v=6'); socMod.init({ api, esc, toast, app, state, logout, sheet, RET, money, thumb, heart, ago, tile, markMe }); }
  return socMod;
}
// FW2.2 "Your Brands, Your Deals" (public/brands.js): Home rail, campaign pages, brand alerts, Admin → Brand deals.
let brdMod;
async function brd() {
  if (!brdMod) { brdMod = await import('/brands.js?v=8'); brdMod.init({ api, esc, toast, app, state, sheet, RET, money, heart, thumb, shrink, pickFile }); }
  return brdMod;
}
views.brand = async (q, id) => (await brd()).page(id);
views.brands = async () => (await brd()).allPage();
views.following = async () => (await brd()).followingPage();
views.earn = async () => (await brd()).earnPage();
views.adminbrands = async () => (await brd()).adminPage();
views.admincampaign = async (q, id) => (await brd()).campaignEditor(id);
views.friends = async () => (await soc()).friendsPage();
views.account = async () => (await soc()).accountPage();
views.shared = async () => (await soc()).sharedPage();
views.settings = () => {
  app.innerHTML = `<h1>Settings</h1><div class="card menu">
    <a href="#/alerts"><span class="ic">🔔</span><span>Alerts<span class="sub">Turn special alerts on or off for this device</span></span></a>
    <a href="#/install"><span class="ic">📲</span><span>Add to Home Screen<span class="sub">Install on iPhone or Android</span></span></a>
    <a href="#/about"><span class="ic">ℹ️</span><span>About the prices<span class="sub">Where they come from and how often</span></span></a>
    <a href="#/earn"><span class="ic">🤝</span><span>How Fair Whack makes money<span class="sub">Partner brands, and what they can't change</span></span></a></div>`;
};
views.profile = async (q, section) => (section ? (await prof()).editor(section) : (await prof()).hub());
views.bills = async (q) => (await prof()).modulePage('bills', q);
views.fueltest = async () => (await prof()).modulePage('fueltest');
let fuelMod;
views.fuel = async (q) => {
  if (!fuelMod) { fuelMod = await import('/fuel.js?v=6'); fuelMod.init({ api, esc, toast, app, state, sheet, profileChanged: () => profMod?.invalidate() }); }
  return fuelMod.page(q);
};

views.alerts = () => { app.innerHTML = '<h1>Alerts</h1><p class="lead">Around 8am on Wednesdays and Saturdays: one summary of how many items on your list are on special, plus a notification of its own for each 💜🔔 item (with a bell) that goes on special (💜 items without a bell only count in the summary). At most 5 a day. Friends\' requests and shared products arrive straight away.</p><div id="pb"></div><div id="bab"></div>'; renderPushBox($('#pb')); brd().then((m) => m.alertsBox($('#bab'))).catch(() => {}); };

views.install = () => {
  app.innerHTML = `<h1>Add to Home Screen</h1>
    <div class="card"><b>iPhone / iPad (Safari)</b><ol class="steps">
      <li>Open this site in <b>Safari</b> (not Chrome or the Gmail browser).</li>
      <li>Tap the <b>Share</b> button (square with an arrow).</li>
      <li>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open <b>Fair Whack</b> from your Home Screen, go to <b>My List</b> and tap <b>Turn on</b> alerts.</li>
    </ol><p class="small muted">Alerts need iOS 16.4 or later.</p></div>
    <div class="card" style="margin-top:10px"><b>Android (Chrome)</b><ol class="steps"><li>Tap the <b>⋮</b> menu.</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol></div>`;
};

views.about = () => {
  app.innerHTML = `<h1>About the prices</h1><div class="card stack small">
    <p><b>Stores:</b> during the beta Fair Whack covers ${STORES.map((r) => `<b>${RET[r]}</b>`).join(', ')} (Victorian prices where a store prices by state). A store appears once its first prices are in.</p>
    <p><b>How often:</b> specials are collected early on Wednesday (every store) and Saturday (stores other than the supermarkets, whose specials change on Wednesdays). Each store's full range is refreshed every four weeks, and anything on someone's list is refreshed every Wednesday.</p>
    <p><b>Browse</b> uses each store's own aisles, so it looks like their website. <b>“All stores”</b> uses a combined set of categories.</p>
    <p><b>“New”</b> means we saw the product for the first time this week (this month once the beta has run for a month).</p>
    <p><b>Unit prices</b> are worked out by us (per 100g, per litre or per item) so different sizes compare fairly. <b>Per use</b> uses the count printed on the pack, e.g. “40 washes”.</p>
    <p><b>Photo and barcode search:</b> a photo is read by an AI model to work out the product name, then searched like typed words; it isn't kept. Barcodes are matched to the stores' own barcode data, then to Open Food Facts by name. Not every product has a barcode in our data yet.</p>
    <p><b>“12-wk low”</b> means the lowest price we've seen in 12 weeks. <b>“Was price inflated”</b> means the “was” price is more than 10% above what it usually sold for.</p>
    <p>Prices can change or differ in store. Always check before you buy. This beta is for internal testing only and is not connected to or endorsed by any supermarket.</p></div>`;
};

views.admin = async () => {
  if (!state.me?.isAdmin) { app.innerHTML = '<div class="empty">Admins only.</div>'; return; }
  loading(2);
  try {
    const [o, mt] = await Promise.all([api('/api/admin/overview'), api('/api/admin/matches')]);
    const pct = Math.min(100, (o.spendUsd / o.budgetUsd) * 100);
    const counts = o.counts.filter((c) => STORES.includes(c.retailer));
    const tally = (key, labels) => { const m = {}; for (const u of o.users) { const k = u[key] || '—'; m[k] = (m[k] || 0) + 1; } return Object.entries(m).map(([k, n]) => `${labels[k] || k}: ${n}`).join(' · '); };
    const warn = (o.storeWarnings || []).filter((w) => STORES.includes(w.retailer));
    app.innerHTML = `<h1>Admin</h1>
      ${warn.length ? `<div class="notice warn admin-warn"><b>⚠️ Specials not updated at ${warn.length} store${warn.length === 1 ? '' : 's'}</b>
        <ul>${warn.map((w) => `<li><b>${RET[w.retailer] || w.retailer}</b>: ${w.failedAt ? `last run failed ${ago(w.failedAt)}` : 'no failed run, but no update'}${w.lastOk ? ` · last good update ${ago(w.lastOk)}` : ' · never updated'}${w.why ? `<div class="small muted">${esc(w.why)}</div>` : ''}</li>`).join('')}</ul>
        <p class="small">A failed Wednesday or Saturday run is retried at 5pm the same day. To run one now: GitHub → Actions → Pipeline → Run workflow (weekly, or saturday), with the store in “Only this retailer”.</p></div>` : ''}
      <a class="card row" href="#/adminbrands" style="text-decoration:none;margin-bottom:10px"><span>🏷️ <b>Brand deals</b> <span class="small muted">Your Brands, Your Deals: brands, campaigns, results</span></span><span class="spacer"></span>›</a>
      <div class="card"><div class="row"><b>Data spend · ${esc(monthName(o.month))}</b><span class="spacer"></span><b class="num">$${o.spendUsd.toFixed(2)} / $${o.budgetUsd}</b></div>
        <div class="meter ${o.level !== 'ok' ? 'hot' : ''}" style="margin-top:8px"><i style="width:${pct}%"></i></div>
        <p class="small muted">Apify $${o.spendBy.apify.toFixed(2)} · Zyte $${o.spendBy.zyte.toFixed(2)} (estimate) · SerpApi $${o.spendBy.serpapi.toFixed(2)} (plan fee) · Google Shopping lookups ${o.serpUsed}/${o.serpCap}</p>
        <p class="small muted">${o.level === 'hard' ? '<b>Hard stop reached:</b> nothing runs until the 1st.' : o.level === 'soft' ? '<b>Soft limit reached:</b> only specials and list refreshes run.' : 'All jobs running.'} At $${o.softUsd} a month, catalogue crawls stop. At $${o.hardUsd}, everything stops. Resets on the 1st (Melbourne time). The services' own figures are the final word.</p></div>
      <h2>Products</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>Store</th><th>Products</th><th>Last 28d</th><th>Specials</th><th>Matched</th><th>Updated</th></tr>
        ${counts.map((c) => `<tr><td>${RET[c.retailer] || c.retailer}</td><td class="num">${c.products}</td><td class="num">${c.fresh28}</td><td class="num">${c.specials}</td><td class="num">${c.matched}</td><td>${ago(c.updated)}</td></tr>`).join('')}</table></div>
      <div class="row"><h2 style="flex:1;justify-content:flex-start;gap:8px">Testers <span class="small muted">${o.users.length}</span></h2><button class="btn small ghost" id="csv">Download list (CSV)</button></div>
      <div class="card small stack"><div><b>Age</b> ${tally('age_range', AGE_LABEL)}</div><div><b>Gender</b> ${tally('gender', GENDER_LABEL)}</div><div><b>Household</b> ${tally('household_size', HOUSE_LABEL)}</div></div>
      <div class="card" style="overflow-x:auto;margin-top:10px"><table class="t"><tr><th>Name</th><th>Last active</th><th>Age</th><th>Gender</th><th>Home</th><th>Watching</th><th>Searches</th><th>Alerts</th><th></th></tr>
        ${o.users.map((u) => `<tr><td>${esc(u.name)}${u.is_admin ? ' <span class="small muted">admin</span>' : ''}${u.is_design ? ' <span class="small muted">design review</span>' : ''}</td><td>${ago(u.last_active_at) || '—'}</td><td>${AGE_LABEL[u.age_range] || '—'}</td><td>${GENDER_LABEL[u.gender] || '—'}</td><td>${HOUSE_LABEL[u.household_size] || '—'}</td><td class="num">${u.items}</td><td class="num">${u.searches ?? 0}</td><td>${u.devices ? '🔔' : '—'}</td><td>${u.id === o.me ? '<span class="small muted">you</span>' : `<button class="btn small ghost" data-u="${esc(u.id)}">Manage</button>`}</td></tr>`).join('')}</table></div>
      ${o.removed.length ? `<div class="card small stack" style="margin-top:10px"><div><b>Removed</b> <span class="muted">These names cannot sign in.</span></div>
        ${o.removed.map((r) => `<div class="row"><span style="flex:1">${esc(r.name)} <span class="muted">removed ${ago(r.removed_at)}</span></span><button class="btn small ghost" data-back="${esc(r.id)}">Allow back</button></div>`).join('')}</div>` : ''}
      <h2>Possible matches <span class="small muted">${o.pending.matches} pending${o.pending.reported ? ` · ${o.pending.reported} reported by testers` : ''}</span></h2>
      <div class="stack">${mt.matches.length ? mt.matches.map((m) => `<div class="card"><div class="pair">
        <div><span class="ret ${m.a_retailer}">${RET[m.a_retailer]}</span><div class="small">${esc(m.a_name)} ${esc(m.a_size || '')}</div><b class="num">${money(m.a_price)}</b></div>
        <div><span class="ret ${m.b_retailer}">${RET[m.b_retailer]}</span><div class="small">${esc(m.b_name)} ${esc(m.b_size || '')}</div><b class="num">${money(m.b_price)}</b></div></div>
        <div class="row" style="margin-top:8px"><span class="small muted">${m.status === 'reported' ? '<b class="hot">A tester says these are different</b> · now linked' : `score ${m.score}`}</span><span class="spacer"></span><button class="btn small danger" data-m="${m.id}" data-a="reject">Different</button><button class="btn small" data-m="${m.id}" data-a="approve">Same product</button></div></div>`).join('') : '<p class="small muted">Nothing to review.</p>'}</div>
      <h2>Data runs</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>When</th><th>Job</th><th>Status</th><th>Items</th><th>$</th><th>Note</th></tr>
        ${o.runs.map((r) => `<tr><td>${ago(r.started_at)}</td><td>${r.mode} ${RET[r.retailer] || r.retailer || ''}${r.provider && r.provider !== 'apify' ? ` <span class="muted">${esc(r.provider)}</span>` : ''}</td><td>${r.status}</td><td class="num">${r.items ?? ''}</td><td class="num">${(r.cost_usd || 0).toFixed(2)}</td><td class="small">${esc((r.message || '').slice(0, 140))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No runs yet</td></tr>'}</table></div>`;
    app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/matches/${b.dataset.m}`, { method: 'POST', body: { action: b.dataset.a } }); toast('Saved'); views.admin(); }));
    app.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => testerSheet(o.users.find((u) => u.id === b.dataset.u), o.users.filter((u) => u.id !== b.dataset.u))));
    app.querySelectorAll('[data-back]').forEach((b) => (b.onclick = async () => { await api('/api/admin/users', { method: 'POST', body: { action: 'restore', id: b.dataset.back } }); toast('They can sign in again'); views.admin(); }));
    $('#csv').onclick = () => downloadTesters(o.users);
  } catch (e) { fail(e); }
};

/** Admin: remove a tester, or merge two names used by the same person. Both ask for confirmation. */
function testerSheet(u, others) {
  const main = () => sheet(`<h3>${esc(u.name)}</h3>
    <p class="small muted" style="margin-top:-6px">Joined ${ago(u.created_at) || '—'} · last active ${ago(u.last_active_at) || '—'} · watching ${u.items} item${u.items === 1 ? '' : 's'}</p>
    ${others.length ? `<div class="field"><label for="into">Same person as another tester? Move this tester's lists and alerts to</label>
      <select id="into"><option value="">Choose a tester…</option>${others.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
      <button class="btn ghost" id="merge" style="width:100%;margin-top:8px">Merge into the chosen tester</button>` : ''}
    <div class="err" id="e"></div>
    <button class="btn danger" id="rm" style="width:100%;margin-top:14px">Remove from the beta</button>`, (s, close) => {
    const run = async (body, done) => { try { await api('/api/admin/users', { method: 'POST', body }); close(); toast(done); views.admin(); } catch (e) { close(); toast(e.message); } };
    const ask = (title, note, yes, body, done) => sheet(`<h3>${esc(u.name)}</h3><div class="confirm"><b>${title}</b><span class="small muted">${note}</span>
      <div class="row"><button class="btn light" id="no" style="flex:1">Cancel</button><button class="btn danger-solid" id="yes" style="flex:1">${yes}</button></div></div>`, (c) => {
      $('#no', c).onclick = main;
      $('#yes', c).onclick = () => run(body, done);
    });
    if ($('#merge', s)) $('#merge', s).onclick = () => {
      const into = others.find((x) => x.id === $('#into', s).value);
      if (!into) { $('#e', s).textContent = 'Choose the tester to merge into'; return; }
      ask(`Merge ${esc(u.name)} into ${esc(into.name)}?`, `${esc(into.name)} keeps everything from both. The name "${esc(u.name)}" is deleted and is signed out. This cannot be undone.`,
        'Merge', { action: 'merge', id: u.id, into: into.id }, `Merged into ${into.name}`);
    };
    $('#rm', s).onclick = () => ask(`Remove ${esc(u.name)} from the beta?`, 'Their lists and alerts are deleted and they are signed out straight away. They cannot sign in again with this name unless you allow it.',
      'Remove', { action: 'remove', id: u.id }, `${u.name} removed`);
  });
  main();
}

/** Admin: the tester table as a CSV file (opens in Excel or Numbers). */
function downloadTesters(users) {
  const day = (iso) => (iso ? iso.slice(0, 10) : '');
  const favs = (u) => { try { return (JSON.parse(u.fav_categories || '[]') || []).join('; '); } catch { return ''; } };
  const rows = [['Name', 'Admin', 'Design review', 'Joined', 'Last active', 'Age', 'Gender', 'Household', 'Favourite categories', 'Items watched', 'Searches', 'Alert devices'],
    ...users.map((u) => [u.name, u.is_admin ? 'yes' : '', u.is_design ? 'yes' : '', day(u.created_at), day(u.last_active_at), AGE_LABEL[u.age_range] || '', GENDER_LABEL[u.gender] || '', HOUSE_LABEL[u.household_size] || '', favs(u), u.items, u.searches ?? 0, u.devices])];
  // Quote every cell; a leading ' stops spreadsheet apps treating a typed name as a formula.
  const cell = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const csv = '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `fair-whack-testers-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- router ----------
// ----- Pages are kept, not reloaded -----
// Going back to a page you saw in the last 15 minutes shows it as it was (scroll included), with no new
// requests. Home is handled the same way (keptHome). A change (list, alerts, settings…) drops the kept
// pages whose content depends on it; store, specials and search pages only need their hearts updated.
const KEEP_MS = 15 * 60000;
const KEEPABLE = /^#\/(p\/|same\/|deals\/|browse\/[a-z]|search\?|lists$|more$)/;
const LIST_INDEPENDENT = /^#\/(deals\/|browse\/|search\?)/;
const keptPages = new Map(); // hash -> { nodes, y, rails, at }
let leftHash = null, shownHash = null;
function keepPage(hash) {
  if (!hash || !KEEPABLE.test(hash) || hash.split('?')[0] !== shownHash || !app.childNodes.length) return;
  keptPages.delete(hash);
  keptPages.set(hash, { nodes: [...app.childNodes], y: keptHome.lastPageY, rails: [...app.querySelectorAll('.rail, .store-grid, .chips')].map((r) => [r, r.scrollLeft]), at: Date.now() });
  while (keptPages.size > 12) keptPages.delete(keptPages.keys().next().value);
}
function restorePage(hash) {
  const k = keptPages.get(hash);
  if (!k) return false;
  keptPages.delete(hash);
  if (Date.now() - k.at > KEEP_MS) return false;
  app.replaceChildren(...k.nodes);
  refreshHearts();
  for (const [r, x] of k.rails) r.scrollLeft = x;
  requestAnimationFrame(() => { window.scrollTo(0, k.y || 0); for (const [r, x] of k.rails) r.scrollLeft = x; });
  return true;
}
function pagesChanged() { for (const h of [...keptPages.keys()]) if (!LIST_INDEPENDENT.test(h)) keptPages.delete(h); }
// Away from the app for 15 minutes or more: everything is loaded fresh when you come back.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt >= KEEP_MS) {
    keptPages.clear(); keptHome.nodes = null;
    const name = (location.hash.slice(1) || '/').split('?')[0].split('/').filter(Boolean)[0] || 'home';
    if (name === 'home' && state.me) route(); // Home on screen: reload it
  }
  hiddenAt = 0;
});

const keptHome = { nodes: null, y: 0, lastY: 0, at: 0, leaving: false, dirty: false, digest: '' };
/** Re-draw part of Home without losing how far each swipe row was scrolled. */
async function keepRails(draw) {
  const pos = [...app.querySelectorAll('.rail, .store-grid')].map((r) => [r.closest('[id]')?.id, r.scrollLeft]);
  await draw();
  for (const [id, x] of pos) { const r = id && document.getElementById(id)?.querySelector('.rail, .store-grid'); if (r) r.scrollLeft = x; }
}
addEventListener('scroll', () => { if (keptHome.leaving) keptHome.lastY = scrollY; keptHome.lastPageY = scrollY; }, { passive: true });
// The Me menu marks the page it was opened on (…?me=1), so going back from a page opened from the menu
// (Friends, My account, My profile…) shows the menu again instead of leaving it.
const withoutMe = (h) => h.replace(/([?&])me=1(&|$)/, (m, a, b) => (b ? a : '')).replace(/[?&]$/, '') || '#/';
const withMe = (h) => (/[?&]me=1\b/.test(h) ? h : `${h || '#/'}${h.includes('?') ? '&' : '?'}me=1`);
function markMe(on) { history.replaceState(history.state, '', on ? withMe(location.hash) : withoutMe(location.hash)); }
// The 5 tab pages (Home, Browse, Search, My List, More) are the top level. The app never adds entries to the
// browser's history (every move replaces the current one), so on a tab page there is nothing to swipe back or
// forward to: the phone's edge swipe simply does nothing. Pages inside a tab keep their own way back here
// (fw.back in sessionStorage), used by the back arrow in the top bar and by a swipe from the left edge.
const TAB_ROOTS = ['home', 'browse', 'search', 'lists', 'more'];
function isTabRoot(hash = location.hash) {
  const parts = withoutMe(hash || '#/').slice(1).split('?')[0].split('/').filter(Boolean);
  const name = parts[0] || 'home';
  return TAB_ROOTS.includes(name) && parts.length <= 1;
}
const TAB_HOME = { home: '#/', browse: '#/browse', search: '#/search', lists: '#/lists', more: '#/more' };
const backStack = () => { try { return JSON.parse(sessionStorage.getItem('fw.back')) || []; } catch { return []; } };
const saveBack = (a) => { try { sessionStorage.setItem('fw.back', JSON.stringify(a.slice(-40))); } catch {} };
/** Go to a page without adding to the browser's history. replace: true = this move is not a step to come back to. */
function fwGo(to, { replace = false } = {}) {
  to = String(to || '#/');
  if (to.startsWith('/#')) to = to.slice(1);
  const cur = location.hash || '#/';
  if (isTabRoot(to)) saveBack([]);
  else if (!replace && to !== cur) saveBack([...backStack(), cur]);
  if (to === cur || (to === '#/' && cur === '')) { route(); return; }
  location.replace(to);
}
/** One step back from a page inside a tab: where it came from, or else its tab page. */
function fwBack() {
  const a = backStack();
  const prev = a.pop();
  saveBack(a);
  const tab = document.querySelector('#tabs a.on')?.dataset.tab || 'home';
  location.replace(prev || TAB_HOME[tab] || '#/');
}
window.fwGo = fwGo; window.fwBack = fwBack;
// Every link to an app page goes through fwGo (no history). data-replace links (tabs inside a page) don't add a step back.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"], a[href="#"]');
  if (!a || a.getAttribute('href') === '#' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  fwGo(a.getAttribute('href'), { replace: a.hasAttribute('data-replace') });
});
// Back arrow (top left) and a swipe from the left edge: only on pages inside a tab.
function updateBackBtn() { document.body.classList.toggle('sub-page', !!state.me && !isTabRoot() && !/^#\/(login|welcome)/.test(location.hash)); }
$('#back-btn')?.addEventListener('click', () => fwBack());
let edge = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  edge = document.body.classList.contains('sub-page') && e.touches.length === 1 && t.clientX < 28 && $('#sheet').hidden ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!edge) return;
  const t = e.changedTouches[0];
  if (t.clientX - edge.x > 70 && Math.abs(t.clientY - edge.y) < 60) fwBack();
  edge = null;
}, { passive: true });
// A notification tapped while the app is open: the service worker asks the page to go there (no new history entry).
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.fwGo) fwGo(e.data.fwGo); });

async function route() {
  if (/[?&]me=1\b/.test(location.hash)) {
    history.replaceState(history.state, '', withoutMe(location.hash));
    if (state.me) setTimeout(() => soc().then((m) => m.meSheet()).catch(() => {}), 0);
  }
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const q = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  if (!state.me && parts[0] !== 'login') {
    try {
      const r = await api('/api/me');
      state.me = r.user; state.profile = r.profile; state.needsProfile = r.needsProfile; state.vapid = r.vapidPublicKey;
      [state.meta] = await Promise.all([api('/api/meta').catch(() => null), loadSaved().catch(() => {})]);
      applyStores(state.meta);
    } catch { return; } // api() sends to login
  }
  if (state.me) document.body.classList.remove('anon');
  const name = parts[0] || 'home';
  // Profile is required during the beta.
  if (state.me && state.needsProfile && name !== 'welcome' && name !== 'login') { fwGo('#/welcome'); return; }
  document.body.classList.toggle('onboarding', name === 'welcome' && state.needsProfile);
  document.body.classList.toggle('on-search', name === 'search');
  updateBackBtn();
  const tab = { home: 'home', digest: 'home', deals: 'home', brand: 'home', brands: 'home', browse: 'browse', search: 'search', p: 'search', lists: 'lists', same: 'lists' }[name] || 'more';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('#sheet').hidden = true;
  // Friend requests badge: checked at most once a minute, not on every page.
  if (state.me && !state.needsProfile && Date.now() - (route.badgeAt || 0) > 60000) { route.badgeAt = Date.now(); soc().then((m) => m.refreshBadge()).catch(() => {}); }
  const isHome = !parts.length || name === 'home';
  if (keptHome.leaving) {
    keptHome.nodes = [...app.childNodes]; keptHome.y = keptHome.lastY; keptHome.at = Date.now();
    // Swipe rows lose their position when taken off the page: note it now, put it back on return.
    keptHome.rails = [...app.querySelectorAll('.rail, .store-grid')].map((r) => [r, r.scrollLeft]);
  }
  keptHome.leaving = false;
  keepPage(leftHash); leftHash = null;
  // Home stays exactly as you left it (scroll positions included) until you close the app.
  // Only after a change (list, alerts, settings, shares) does it quietly update the parts that changed.
  if (isHome && keptHome.nodes && Date.now() - keptHome.at < KEEP_MS && !q.toString()) {
    app.replaceChildren(...keptHome.nodes);
    keptHome.nodes = null; keptHome.leaving = true;
    refreshHearts();
    for (const [r, x] of keptHome.rails || []) r.scrollLeft = x;
    requestAnimationFrame(() => { window.scrollTo(0, keptHome.y || 0); for (const [r, x] of keptHome.rails || []) r.scrollLeft = x; });
    if (keptHome.dirty) {
      keptHome.dirty = false;
      api('/api/digest').then((d) => { if ($('#mine') && JSON.stringify(d) !== keptHome.digest) { keptHome.digest = JSON.stringify(d); keepRails(() => renderMine($('#mine'), d)); } }).catch(() => {});
      soc().then((m) => keepRails(() => m.homeRail($('#sharedrail')))).catch(() => {});
      if ($('#brandzone')) brd().then((m) => keepRails(() => m.homeRail($('#brandzone')))).catch(() => {});
    }
    return;
  }
  if (isHome) keptHome.nodes = null;
  if (!isHome && restorePage(location.hash)) { shownHash = location.hash.split('?')[0]; return; }
  shownHash = location.hash.split('?')[0];
  if (!q.get('store') && !q.get('cat') && !q.get('sort')) window.scrollTo(0, 0);
  if (isHome) keptHome.leaving = true;
  try {
    if (name === 'login') return views.login(q);
    if (name === 'p') return await views.product(q, decodeURIComponent(parts.slice(1).join('/')));
    if (name === 'browse') return await views.browse(q, parts[1]);
    if (name === 'digest') return await views.home(q);
    if (name === 'profile') return await views.profile(q, parts[1]);
    if (name === 'deals') return await views.deals(q, parts[1]);
    if (name === 'same') return await views.same(q, decodeURIComponent(parts[1] || ''));
    if (name === 'brand' || name === 'admincampaign') return await views[name](q, decodeURIComponent(parts[1] || ''));
    if (name === 'add') return await (await soc()).addPage(decodeURIComponent(parts[1] || ''));
    return await (views[name] || views.home)(q);
  } catch (e) { fail(e); }
}

$('#me-btn').onclick = async () => { if (state.me) (await soc()).meSheet().catch((e) => toast(e.message)); };
// "Same product in other stores" on My List opens the comparison for that item (one listener for the app).
document.addEventListener('click', (e) => {
  const t = e.target.closest('.listcard [data-same]');
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  fwGo(`#/same/${encodeURIComponent(t.dataset.same)}`);
}, true);
addEventListener('hashchange', (e) => { leftHash = withoutMe(new URL(e.oldURL).hash || '#/'); route(); });
// Tabs inside a page (Fuel: Nearby/Route/Saved, Bills: Electricity/Gas) are data-replace links: fwGo with replace.
// Keep the app at its own size: no pinch zoom (iPhone ignores user-scalable=no in Safari).
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
// If iPhone did zoom in on a field, settle back once the field is left.
document.addEventListener('focusout', () => { if (window.visualViewport && visualViewport.scale > 1) window.scrollTo(window.scrollX, window.scrollY); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
