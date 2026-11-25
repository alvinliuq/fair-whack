// Fair Whack beta — single-page app (no build step).
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
// Store names and the stores shown: filled from /api/meta (stores that have products). These are the fallbacks.
const RET = { woolworths: 'Woolworths', coles: 'Coles', aldi: 'ALDI', jbhifi: 'JB Hi-Fi', costco: 'Costco', kmart: 'Kmart', bunnings: 'Bunnings', petbarn: 'Petbarn', bigw: 'BIG W', chemistwarehouse: 'Chemist Warehouse', thegoodguys: 'The Good Guys', target: 'Target', officeworks: 'Officeworks', ebgames: 'EB Games', peto: 'PetO', decathlon: 'Decathlon' };
const STORES = ['woolworths', 'coles'];
function applyStores(meta) {
  if (!meta || !Array.isArray(meta.stores) || !meta.stores.length) return;
  for (const s of meta.stores) RET[s.id] = s.name;
  STORES.splice(0, STORES.length, ...meta.stores.map((s) => s.id));
}
// Store logos (88×88, supplied by Alvin 25 Nov): public/icons/stores/<id>.png. A store without one shows a coloured badge.
const STORE_LOGOS = Object.fromEntries(['woolworths', 'coles', 'aldi', 'jbhifi', 'costco', 'kmart', 'bunnings', 'petbarn', 'bigw', 'chemistwarehouse',
  'thegoodguys', 'target', 'officeworks', 'ebgames', 'peto', 'decathlon'].map((r) => [r, `/icons/stores/${r}.png`]));
const storeLogo = (r, cls = '') => `<span class="slogo ${r} ${cls} ${STORE_LOGOS[r] ? 'has-img' : ''}" aria-hidden="true">${STORE_LOGOS[r] ? `<img src="${STORE_LOGOS[r]}" alt="" width="88" height="88">` : `<b>${(RET[r] || '?')[0]}</b>`}</span>`;
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
  if (res.status === 401 && !path.startsWith('/api/login')) { state.me = null; location.hash = '#/login'; throw new Error('Please sign in'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
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
const heartState = (id) => { const s = state.saved.get(id); return !s ? '' : s.alert_mode === 'off' ? 'quiet' : 'alert'; };
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
  if (w) { const on = state.saved.has(w.dataset.pid); w.textContent = on ? '♥ On your list' : '♡ Add to my list'; w.classList.toggle('ghost', on); }
}
async function loadSaved() {
  const { saved } = await api('/api/saved');
  state.saved = new Map(saved.map((s) => [s.product_id, s]));
  refreshHearts();
}
async function onHeart(id) {
  const p = state.products.get(id) || { id, name: 'this product' };
  const saved = state.saved.get(id);
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
    </div>
    ${heart(p)}
  </a>`;
}

function offerRow(o, best) {
  const save = o.saving ? `<span class="note">Save ${money(o.saving)}</span>` : '';
  return `<a class="offer ${best ? 'best' : ''}" href="#/p/${encodeURIComponent(o.id)}">
    <div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span>${badges(o)}${best ? '<span class="tag-best">Cheapest</span>' : ''}</div>
    <div class="p num">${money(o.effective)}</div>
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

views.login = () => {
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
      await api('/api/login', { method: 'POST', body: { name: fd.get('name'), code: fd.get('code') } });
      state.me = null; // route() reloads the profile
      document.body.classList.remove('anon');
      if (location.hash === '#/') route(); else location.hash = '#/';
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
      location.hash = pr.done ? '#/profile' : '#/';
    } catch (err) { $('#err').textContent = err.message; }
  };
};

// ----- Home: your list (list picker + stores) · Shared with you · Bargains (store tiles) · Top 20 -----
const HOME_PICK = 'fw.homePick';
function homePick() { try { return JSON.parse(localStorage.getItem(HOME_PICK)) || {}; } catch { return {}; } }
function saveHomePick(v) { try { localStorage.setItem(HOME_PICK, JSON.stringify(v)); } catch {} }

function renderMine(el, d) {
  const lists = d.lists || [];
  const pick = homePick();
  const listId = lists.some((l) => l.id === pick.list) ? pick.list : lists[0]?.id;
  const inList = (d.byStore || []).filter((o) => o.listId === listId);
  const stores = STORES.filter((r) => inList.some((o) => o.retailer === r));
  const sel = (pick.stores || []).filter((r) => stores.includes(r)); // empty = All stores
  let pool;
  if (sel.length) pool = inList.filter((o) => sel.includes(o.retailer)).sort((a, b) => (b.saving || 0) - (a.saving || 0));
  else { // All stores: the cheapest store for each item
    const best = new Map();
    for (const o of inList) { const p = best.get(o.itemId); if (!p || o.effective < p.effective) best.set(o.itemId, o); }
    pool = [...best.values()].sort((a, b) => (b.saving || 0) - (a.saving || 0));
  }
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
  el.innerHTML = toggles + (inList.length ? `<p class="sec-sub" style="margin-top:0">${pool.length} on special${sel.length ? '' : ' · cheapest store for each'}</p>` : '') + body;
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
    <h1>G'day ${esc(state.me.name.split(' ')[0])}</h1>
    <p class="lead small">${upd ? `Prices updated: ${upd}` : 'Waiting for the first price update.'}</p>
    ${!standalone && /iPhone|iPad/.test(navigator.userAgent) ? `<a class="notice info" style="display:block;text-decoration:none" href="#/install"><b>Add Fair Whack to your Home Screen</b> to get special alerts on iPhone →</a>` : ''}
    <div class="sec-head"><h2>On special from your list</h2><span id="minepick"></span></div>
    <div id="mine"><div class="skeleton" style="height:120px"></div></div>
    <div id="sharedrail"></div>
    <div class="sec-head" id="deals"><h2>Bargains you're missing</h2></div>
    <p class="sec-sub">Tap a store to see all its specials</p>
    <div id="bargains"><div class="skeleton" style="height:230px"></div></div>
    <div id="top20"></div>`;
  api('/api/digest').then((d) => renderMine($('#mine'), d)).catch((e) => fail(e, $('#mine')));
  soc().then((m) => m.homeRail($('#sharedrail'))).catch(() => {});
  api('/api/bargains/stores').then((d) => bargainTiles($('#bargains'), d.stores.filter((s) => STORES.includes(s.id)))).catch((e) => fail(e, $('#bargains')));
  api('/api/top20').then((d) => topTwenty($('#top20'), d)).catch(() => {});
};

// ----- One store's specials (from a Bargains tile) -----
views.deals = async (q, store) => {
  if (!STORES.includes(store)) { location.hash = '#/'; return; }
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
  const remember = () => history.replaceState(null, '', link({}));
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
  ['Groceries', ['woolworths', 'coles', 'aldi', 'costco']],
  ['Department Stores', ['kmart', 'bigw', 'target']],
  ['Electronics', ['jbhifi', 'thegoodguys']],
  ['Tools & Home', ['bunnings']],
  ['Health & Beauty', ['chemistwarehouse']],
  ['Pets', ['petbarn', 'peto']],
  ['Office', ['officeworks']],
  ['Sports & Gaming', ['decathlon', 'ebgames']],
];
const BROWSE_SORTS = [['popular', 'Most popular'], ['new', null], ['special', 'On special'], ['mine', 'On my list']];

views.browse = async (q, store) => {
  if (!STORES.includes(store)) {
    const meta = state.meta || {};
    const count = (r) => (meta.retailers || []).find((x) => x.retailer === r)?.products || 0;
    const grouped = new Set(STORE_GROUPS.flatMap(([, ids]) => ids));
    const groups = [...STORE_GROUPS, ['More stores', STORES.filter((r) => !grouped.has(r))]]
      .map(([g, ids]) => [g, ids.filter((r) => STORES.includes(r))]).filter(([, ids]) => ids.length);
    app.innerHTML = `<h1>Browse</h1><p class="lead">Walk the aisles of each store, see what's new, and tap ♡ to track prices on anything.</p>
      ${groups.map(([g, ids]) => `<div class="sec-head"><h2>${esc(g)}</h2></div>
        <div class="store-row">${ids.map((r) => `<a class="store-tile" href="#/browse/${r}">${storeLogo(r, 'big')}<span class="st-name">${esc(RET[r])}</span><span class="st-count">${count(r).toLocaleString('en-AU')} products</span></a>`).join('')}</div>`).join('')}`;
    return;
  }
  const newLabel = state.meta?.newLabel || 'New this week';
  const f = { cat1: q.get('cat1') || '', cat2: q.get('cat2') || '', sort: BROWSE_SORTS.some(([k]) => k === q.get('sort')) ? q.get('sort') : 'popular' };
  const link = (patch) => `#/browse/${store}${qs({ ...f, ...patch })}`;
  const total = (state.meta?.retailers || []).find((x) => x.retailer === store)?.products || 0;
  app.innerHTML = `<a class="back" href="#/browse">‹ Browse</a>
    <div class="store-head">${storeLogo(store, 'big')}<div><h1>${esc(RET[store])}</h1><p class="lead small">${total.toLocaleString('en-AU')} products</p></div></div>
    <div id="c1"><div class="chips"><span class="chip">Loading aisles…</span></div></div><div id="c2"></div>
    <div class="chips sorts">${BROWSE_SORTS.map(([k, l]) => `<a class="chip ${k === 'new' ? 'ticket' : ''} ${f.sort === k ? 'on' : ''}" href="${link({ sort: k })}">${esc(l || newLabel)}</a>`).join('')}</div>
    <p class="small muted" id="blabel" style="margin:0 0 8px"></p>
    <div id="res"></div>`;
  api(`/api/categories${qs({ retailer: store })}`).then((c) => {
    $('#c1').innerHTML = chips(c.categories, f.cat1, (name) => link({ cat1: name, cat2: '' }), { all: 'All aisles' });
    const top = c.categories.find((x) => x.name === f.cat1);
    if (top && top.children.length > 1) $('#c2').innerHTML = chips(top.children, f.cat2, (name) => link({ cat2: name }), { all: `All ${f.cat1}`, cls: 'sub' });
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
  const go = (v) => { v = v.trim(); if (!v) return; list.hidden = true; input.blur(); location.hash = `#/search?q=${encodeURIComponent(v)}`; };
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
  body.innerHTML = `<div class="chips sorts">${SEARCH_SORTS.map(([k, l]) => `<a class="chip ${sort === k ? 'on' : ''}" href="#/search?q=${encodeURIComponent(term)}&sort=${k}">${l}</a>`).join('')}</div><div id="res"><div class="skeleton"></div></div>`;
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
  const card = (r) => `<a class="web-card" href="${esc(r.link || '#')}" target="_blank" rel="noopener noreferrer">
      <span class="wc-img">${r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<b>?</b>'}</span>
      <span class="wc-store">${esc(r.store || 'Online shop')}${r.used ? ' · used' : ''}</span>
      <span class="wc-name">${esc(r.title)}</span>
      <span class="wc-price num">${money(r.priceCents)}${r.wasCents && r.wasCents > r.priceCents ? `<small>${money(r.wasCents)}</small>` : ''}</span>
      ${r.delivery ? `<span class="wc-note">${esc(r.delivery)}</span>` : ''}
    </a>`;
  el.innerHTML = `<div class="sec-head"><h2>Elsewhere online</h2><span class="small muted">Google Shopping</span></div>
    <div class="rail web-rail" tabindex="0" aria-label="Prices at other online shops, swipe for more">${rows.map(card).join('')}</div>
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
      location.hash = `#/search?q=${encodeURIComponent(r.query)}`;
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
    $('#nf', s).onsubmit = (e) => { e.preventDefault(); const v = $('#nfq', s).value.trim(); if (!v) return; close(); location.hash = `#/search?q=${encodeURIComponent(v)}`; };
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
      if (r.found && r.productId) { close(); location.hash = `#/p/${encodeURIComponent(r.productId)}`; return; }
      if (r.found && r.query) { close(); state.via = { kind: 'barcode', code, query: r.query, label: r.label }; location.hash = `#/search?q=${encodeURIComponent(r.query)}`; return; }
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
    const on = state.saved.has(p.id);
    app.innerHTML = `
      <div class="hero">${thumb(p)}<div><span class="ret ${p.retailer}">${RET[p.retailer]}</span><h1>${esc(p.name)}</h1><div class="small muted">${esc(p.size || '')}${p.brand ? ` · ${esc(p.brand)}` : ''}</div>${badges(p, { stale: false })}</div></div>
      <div class="facts">
        <div class="fact"><b class="num">${money(p.effective)}</b><span>${p.was ? `was ${money(p.was)}` : 'Current price'}${p.multibuy ? ` · ${esc(p.promoText)}` : ''}</span></div>
        <div class="fact"><b class="num">${esc(unitText(p) || '—')}</b><span>Unit price</span></div>
        ${p.perUse ? `<div class="fact"><b class="num">${money(p.perUse)}</b><span>Per use (${p.uses} uses)</span></div>` : ''}
        ${p.low12 ? `<div class="fact"><b class="num">${money(p.low12)}</b><span>Lowest in ${p.historyWeeks || 12} weeks</span></div>` : ''}
      </div>
      <p class="small muted">Checked ${ago(p.checkedAt)}${p.stale ? ' — may have changed' : ''}. ${p.anomaly ? '<b>Unusual price change, being checked.</b>' : ''}</p>
      <div class="row" style="margin:12px 0;gap:8px"><button class="btn ${on ? 'ghost' : ''}" id="watch" data-pid="${esc(p.id)}" style="flex:1;white-space:nowrap">${on ? '♥ On your list' : '♡ Add to my list'}</button><button class="btn light icon-btn" id="share" aria-label="Share with friends"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l4.5 4.5-1.4 1.4L13 6.8V15h-2V6.8L8.9 8.9 7.5 7.5zM5 13h2v6h10v-6h2v8H5z"/></svg></button>${p.url ? `<a class="btn light" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="View at ${RET[p.retailer]}">${RET[p.retailer]} ↗</a>` : ''}</div>
      ${d.offers.length > 1 ? `<h2>Same product, other store</h2><div class="group">${d.offers.map((o, i) => offerRow(o, i === 0 && (d.offers[1].effective ?? 1e12) > (o.effective ?? 0))).join('')}</div>` : ''}
      <h2>Price history</h2><div class="card">${sparkline(d.history)}</div>
      ${d.sizes.length ? `<h2>Other sizes</h2><div class="group">${d.sizes.map((o) => `<a class="offer" href="#/p/${encodeURIComponent(o.id)}"><div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span><span class="small">${esc(o.size || o.name)}</span></div><div class="p num">${money(o.effective)}</div><div></div><div class="u num">${esc(unitText(o))}</div></a>`).join('')}</div>` : ''}
      ${d.similar.length ? `<h2>Similar items, by unit price</h2><div class="grid">${d.similar.slice(0, 6).map(tile).join('')}</div>` : ''}`;
    $('#watch').onclick = () => onHeart(p.id).catch((e) => toast(e.message));
    $('#share').onclick = async () => (await soc()).shareSheet(p).catch((e) => toast(e.message));
  } catch (e) { fail(e); }
};

// ----- sheets -----
function sheet(html, onMount) {
  const s = $('#sheet');
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
  const close = () => { s.hidden = true; s.innerHTML = ''; };
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

/** Store buttons for a list: "All stores" or any mix of single stores (never both). */
function storeButtons(listId, stores, sel) {
  if (stores.length < 2) return '';
  return `<div class="toggles list-stores" data-for="${listId}" role="group" aria-label="Stores">
    <button type="button" class="toggle all" data-ls="" aria-pressed="${!sel.length}"><span class="tick" aria-hidden="true">✓</span>All stores</button>
    ${stores.map((r) => `<button type="button" class="toggle ${r}" data-ls="${r}" aria-pressed="${sel.includes(r)}"><span class="tick" aria-hidden="true">✓</span>${RET[r]}</button>`).join('')}</div>`;
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

function listBody(l) {
  const stores = STORES.filter((r) => l.items.some((i) => i.offers.some((o) => o.retailer === r)));
  const sel = (listStores()[l.id] || []).filter((r) => stores.includes(r));
  const rows = l.items.map((i) => itemRow(i, sel)).filter(Boolean);
  return storeButtons(l.id, stores, sel) + (l.items.length
    ? (rows.length ? `<div class="list-rows">${rows.join('')}</div>` : `<div class="empty" style="padding:14px">Nothing on this list at ${sel.map((r) => RET[r]).join(' or ')}.</div>`)
    : '<div class="empty" style="padding:14px">Empty. Tap ♡ on any product to add it here.</div>');
}

views.lists = async () => {
  loading(2);
  try {
    const { lists } = await api('/api/lists');
    app.innerHTML = `<div class="title-row"><h1>My List</h1><span class="spacer"></span>
        ${lists.length > 1 ? '<button class="round-btn" id="reorder" aria-label="Change the order of lists"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3l4 4H8v7H6V7H3zm10 18l-4-4h3v-7h2v7h3z"/></svg></button>' : ''}
        <button class="round-btn primary" id="newlist" aria-label="New list"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg></button></div>
      <p class="lead small">Prices are the cheapest matching offer at the stores you pick. ${HEART_KEY}</p>
      ${lists.map((l, idx) => {
        const open = state.listOpen[l.id] ?? idx === 0;
        const onSpecial = l.items.filter((i) => i.best.special).length;
        return `<details class="card listcard" data-list="${l.id}" ${open ? 'open' : ''}>
        <summary><span class="chev">›</span><div class="t"><b>${esc(l.name)}</b><span class="small muted">${l.items.length} item${l.items.length === 1 ? '' : 's'}${onSpecial ? ` · <span class="hot">${onSpecial} on special</span>` : ''}</span></div><button class="btn small light" data-edit="${l.id}">Edit</button></summary>
        <div class="list-body">${listBody(l)}</div>
      </details>`; }).join('')}
      <div id="pushbox" style="margin-top:14px"></div>`;
    app.querySelectorAll('details[data-list]').forEach((d) => d.addEventListener('toggle', () => { state.listOpen[d.dataset.list] = d.open; }));
    app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); listSheet(lists.find((l) => l.id === b.dataset.edit), lists.length); }));
    // "Same product in other stores" opens the comparison for that item.
    app.addEventListener('click', (e) => {
      const t = e.target.closest('[data-same]');
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      location.hash = `#/same/${encodeURIComponent(t.dataset.same)}`;
    }, true);
    // Store buttons: "All stores" clears the others; any single store clears "All stores".
    app.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ls]');
      if (!b) return;
      const box = b.closest('[data-for]'), id = box.dataset.for;
      const cur = listStores()[id] || [];
      const r = b.dataset.ls;
      const next = !r ? [] : cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
      setListStores(id, next);
      const l = lists.find((x) => x.id === id);
      box.closest('.list-body').innerHTML = listBody(l);
    });
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

/** Change the order of lists: drag by ≡, or use the arrows. */
function reorderSheet(lists) {
  let order = lists.map((l) => ({ id: l.id, name: l.name }));
  sheet(`<h3>Order of lists</h3><p class="small muted" style="margin-top:-4px">Drag ≡ or use the arrows.</p><div class="card list-rows reorder" id="ro"></div><button class="btn block" id="ok">Done</button>`, (s, close) => {
    const box = $('#ro', s);
    const draw = () => {
      box.innerHTML = order.map((l, i) => `<div class="r ro-row" data-i="${i}"><span class="grip" aria-hidden="true">≡</span><span class="n"><b>${esc(l.name)}</b></span>
        <button class="linkbtn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="linkbtn" data-down="${i}" ${i < order.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button></div>`).join('');
    };
    const move = (from, to) => { if (to < 0 || to >= order.length || from === to) return; const [x] = order.splice(from, 1); order.splice(to, 0, x); draw(); };
    draw();
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.up) move(+b.dataset.up, +b.dataset.up - 1);
      if (b.dataset.down) move(+b.dataset.down, +b.dataset.down + 1);
    });
    // Drag by the grip (touch and mouse).
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('.grip');
      if (!g) return;
      e.preventDefault();
      const row = g.closest('.ro-row');
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
  app.innerHTML = `<a class="back" href="#/lists">‹ My List</a>
    <div class="hero">${thumb(p)}<div><h1>${esc(p.name)}</h1><div class="small muted">${esc(p.size || '')}${p.brand ? ` · ${esc(p.brand)}` : ''} · on ${esc(d.item.listName)}</div></div></div>
    <p class="small muted">Same product at ${d.offers.length} store${d.offers.length === 1 ? '' : 's'}, cheapest first. Tap ♡ to add a store's one to a list; tap “Not the same” if we've matched the wrong product.</p>
    <div class="group same-list">${d.offers.map((o) => `<div class="offer same-row ${o.id === cheapest.id ? 'best' : ''}">
        <a class="same-main" href="#/p/${encodeURIComponent(o.id)}">${thumb(o)}<span class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span>${badges(o)}${o.id === cheapest.id && d.offers.length > 1 ? '<span class="tag-best">Cheapest</span>' : ''}
          <span class="small">${esc(o.name)}${o.size && !o.name.toLowerCase().includes(String(o.size).toLowerCase()) ? ` · ${esc(o.size)}` : ''}</span>${o.id === p.id ? '<span class="small muted">On your list</span>' : ''}</span></a>
        <span class="p num">${money(o.effective)}${o.was ? `<small class="muted">was ${money(o.was)}</small>` : ''}<small class="muted">${esc(unitText(o))}</small></span>
        <span class="acts">${heart(o)}${o.id === p.id ? '' : `<button class="linkbtn small" data-notsame="${esc(o.id)}">Not the same</button>`}</span>
      </div>`).join('')}</div>
    ${d.offers.length === 1 ? '<div class="empty">No other store has this product right now.</div>' : ''}`;
  app.querySelectorAll('[data-notsame]').forEach((b) => (b.onclick = async () => {
    const o = d.offers.find((x) => x.id === b.dataset.notsame);
    if (!confirm(`Not the same product?\n\n${o.name} (${RET[o.retailer]}) will no longer show with this item for you, and we'll check the match.`)) return;
    try { await api(`/api/items/${encodeURIComponent(itemId)}/not-same`, { method: 'POST', body: { product_id: o.id } }); toast('Thanks, it won\'t show with this item again'); views.same(q, itemId); } catch (e) { toast(e.message); }
  }));
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
const logout = async () => { await api('/api/logout', { method: 'POST' }); state.me = null; state.saved = new Map(); location.hash = '#/login'; };
let profMod;
async function prof() {
  if (!profMod) { profMod = await import('/profile.js?v=10'); profMod.init({ api, esc, toast, app, state, logout, HOME_STORES }); }
  return profMod;
}
views.more = async () => (await prof()).more();
// Friends and sharing (Me button, top right on every page).
let socMod;
async function soc() {
  if (!socMod) { socMod = await import('/social.js?v=1'); socMod.init({ api, esc, toast, app, state, logout, sheet, RET, money, thumb, heart, ago, tile }); }
  return socMod;
}
views.friends = async () => (await soc()).friendsPage();
views.account = async () => (await soc()).accountPage();
views.shared = async () => (await soc()).sharedPage();
views.settings = () => {
  app.innerHTML = `<h1>Settings</h1><div class="card menu">
    <a href="#/alerts"><span class="ic">🔔</span><span>Alerts<span class="sub">Turn special alerts on or off for this device</span></span></a>
    <a href="#/install"><span class="ic">📲</span><span>Add to Home Screen<span class="sub">Install on iPhone or Android</span></span></a>
    <a href="#/about"><span class="ic">ℹ️</span><span>About the prices<span class="sub">Where they come from and how often</span></span></a></div>`;
};
views.profile = async (q, section) => (section ? (await prof()).editor(section) : (await prof()).hub());
views.bills = async (q) => (await prof()).modulePage('bills', q);
views.fueltest = async () => (await prof()).modulePage('fueltest');
let fuelMod;
views.fuel = async (q) => {
  if (!fuelMod) { fuelMod = await import('/fuel.js?v=5'); fuelMod.init({ api, esc, toast, app, state, sheet, profileChanged: () => profMod?.invalidate() }); }
  return fuelMod.page(q);
};

views.alerts = () => { app.innerHTML = '<h1>Alerts</h1><p class="lead">Around 8am on Wednesdays and Saturdays: one summary of how many items on your list are on special, plus a notification of its own for each 💜🔔 item (with a bell) that goes on special (💜 items without a bell only count in the summary). At most 5 a day. Friends\' requests and shared products arrive straight away.</p><div id="pb"></div>'; renderPushBox($('#pb')); };

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
    app.innerHTML = `<h1>Admin</h1>
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
async function route() {
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
  if (state.me && state.needsProfile && name !== 'welcome' && name !== 'login') { location.hash = '#/welcome'; return; }
  document.body.classList.toggle('onboarding', name === 'welcome' && state.needsProfile);
  document.body.classList.toggle('on-search', name === 'search');
  const tab = { home: 'home', digest: 'home', deals: 'home', browse: 'browse', search: 'search', p: 'search', lists: 'lists', same: 'lists' }[name] || 'more';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('#sheet').hidden = true;
  if (state.me && !state.needsProfile) soc().then((m) => m.refreshBadge()).catch(() => {});
  if (!q.get('store') && !q.get('cat') && !q.get('sort')) window.scrollTo(0, 0);
  try {
    if (name === 'login') return views.login();
    if (name === 'p') return await views.product(q, decodeURIComponent(parts.slice(1).join('/')));
    if (name === 'browse') return await views.browse(q, parts[1]);
    if (name === 'digest') return await views.home(q);
    if (name === 'profile') return await views.profile(q, parts[1]);
    if (name === 'deals') return await views.deals(q, parts[1]);
    if (name === 'same') return await views.same(q, decodeURIComponent(parts[1] || ''));
    if (name === 'add') return await (await soc()).addPage(decodeURIComponent(parts[1] || ''));
    return await (views[name] || views.home)(q);
  } catch (e) { fail(e); }
}

$('#me-btn').onclick = async () => { if (state.me) (await soc()).meSheet().catch((e) => toast(e.message)); };
addEventListener('hashchange', route);
// Tabs inside a page (Fuel: Nearby/Route/Saved, Bills: Electricity/Gas) don't add history,
// so the back swipe goes to the page above (More), not the previous tab.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-replace]');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  location.replace(a.getAttribute('href'));
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
